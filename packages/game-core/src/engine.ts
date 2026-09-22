import type { BotDifficulty, MatchConfig } from '@riqaa/shared';
import { CaptureSolver } from './capture.js';
import { Grid } from './grid.js';
import { Rng } from './rng.js';
import {
  DX,
  DY,
  HALF_PI,
  dirToHeading,
  headingToDir,
  type Actor,
  type ActorController,
  type ActorKind,
  type Dir,
  type EndReason,
  type EngineOptions,
  type GameEvent,
  type GameStatus,
  type WorldView,
} from './types.js';

export interface ParticipantSpec {
  id: number;
  kind: ActorKind;
  name: string;
  colorIndex: number;
  difficulty?: BotDifficulty | null;
}

/**
 * محرك اللعبة: منطق خالص بخطوة زمنية ثابتة.
 * لا يعرف الـDOM ولا الشبكة ولا الرسم — لذلك يمكن تشغيله لاحقًا على الخادم كما هو.
 */
export class GameEngine implements WorldView {
  readonly config: MatchConfig;
  /** هل هذه النسخة هي المرجع؟ المرآة على جهاز اللاعب تضع false. */
  readonly authoritative: boolean;
  /** هل ينهي موتُ لاعبٍ بشري الجولةَ كلها؟ (لا في الغرف الجماعية) */
  readonly endOnHumanDeath: boolean;
  readonly grid: Grid;
  readonly rng: Rng;
  readonly actors: Actor[] = [];
  readonly events: GameEvent[] = [];

  elapsed = 0;
  status: GameStatus = 'running';
  endReason: EndReason | null = null;

  private readonly byId = new Map<number, Actor>();
  private readonly controllers = new Map<number, ActorController>();
  private readonly capture: CaptureSolver;
  private readonly pendingWipe: number[] = [];
  private humanId = 0;

  /**
   * الخلايا الأخيرة من المسار لا تقتل صاحبها.
   * بلا هذه النافذة يصبح أي التفاف حاد في حركة 360 درجة موتًا فوريًا.
   */
  private static readonly SELF_GRACE_CELLS = 3;
  /** أدنى نسبة سرعة كي لا يتجمّد اللاعب عند أقل لمسة. */
  private static readonly MIN_THROTTLE = 0.35;

  constructor(options: EngineOptions) {
    this.config = options.config;
    this.authoritative = options.authoritative ?? true;
    this.endOnHumanDeath = options.endOnHumanDeath ?? true;
    this.grid = new Grid(options.config.gridWidth, options.config.gridHeight);
    this.rng = new Rng(options.seed);
    this.capture = new CaptureSolver(this.grid);
  }

  // ---------------------------------------------------------------- القراءة

  get width(): number {
    return this.grid.width;
  }

  get height(): number {
    return this.grid.height;
  }

  get totalCells(): number {
    return this.grid.width * this.grid.height;
  }

  get human(): Actor | undefined {
    return this.byId.get(this.humanId);
  }

  /**
   * المشارك الذي تتبعه الكاميرا على هذا الجهاز.
   * في غرفة فيها أكثر من لاعب بشري لا يكفي «أول لاعب بشري»: كل جهاز
   * يجب أن يتابع صاحبه هو، وإلا رأى اللاعب الملعب من عيني خصمه.
   */
  focusActorId = 0;

  get focus(): Actor | undefined {
    return this.byId.get(this.focusActorId) ?? this.human ?? this.actors[0];
  }

  ownerAt(x: number, y: number): number {
    return this.grid.ownerAt(x, y);
  }

  trailAt(x: number, y: number): number {
    return this.grid.trailAt(x, y);
  }

  inBounds(x: number, y: number): boolean {
    return this.grid.inBounds(x, y);
  }

  actorById(id: number): Actor | undefined {
    return this.byId.get(id);
  }

  areaPercent(actor: Actor): number {
    return (actor.area / this.totalCells) * 100;
  }

  /** ترتيب تنازلي بالمساحة — يُعاد استخدام المصفوفة لتجنب التخصيص كل إطار. */
  private readonly rankingBuffer: Actor[] = [];
  ranking(): Actor[] {
    const buffer = this.rankingBuffer;
    buffer.length = 0;
    for (const actor of this.actors) buffer.push(actor);
    buffer.sort((a, b) => b.area - a.area);
    return buffer;
  }

  rankOf(actor: Actor): number {
    return this.ranking().indexOf(actor) + 1;
  }

  /** موضع الرسم = الموضع المستمر نفسه (مركز اللاعب بوحدة الخلية). */
  renderX(actor: Actor): number {
    return actor.x;
  }

  renderY(actor: Actor): number {
    return actor.y;
  }

  // ------------------------------------------------------------- الإعداد

  addParticipant(spec: ParticipantSpec): Actor {
    const actor: Actor = {
      id: spec.id,
      kind: spec.kind,
      name: spec.name,
      colorIndex: spec.colorIndex,
      difficulty: spec.difficulty ?? null,
      alive: false,
      x: 0,
      y: 0,
      heading: 0,
      cx: 0,
      cy: 0,
      dir: 0,
      trail: [],
      outside: false,
      exitCell: 0,
      area: 0,
      kills: 0,
      deaths: 0,
      respawnAt: -1,
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      blocked: false,
    };
    this.actors.push(actor);
    this.byId.set(actor.id, actor);
    if (spec.kind === 'human' && this.humanId === 0) this.humanId = actor.id;
    this.placeActor(actor);
    return actor;
  }

  setController(actorId: number, controller: ActorController): void {
    this.controllers.set(actorId, controller);
  }

  // ------------------------------------------------------------- المحاكاة

  /** خطوة محاكاة واحدة بزمن ثابت (dt بالثواني). */
  step(dt: number): void {
    if (this.status === 'ended') return;
    this.elapsed += dt;

    for (const actor of this.actors) {
      if (!actor.alive) {
        if (actor.respawnAt >= 0 && this.elapsed >= actor.respawnAt) this.respawn(actor);
        continue;
      }
      this.advance(actor, dt);
    }

    this.resolveCollisions();

    if (
      this.authoritative &&
      this.status === 'running' &&
      this.config.roundSeconds > 0 &&
      this.elapsed >= this.config.roundSeconds
    ) {
      this.end('timeup');
    }
  }

  /** ينهي الجولة يدويًا (خروج اللاعب مثلًا). */
  end(reason: EndReason): void {
    if (this.status === 'ended') return;
    this.status = 'ended';
    this.endReason = reason;
    this.events.push({ type: 'end', reason });
  }

  /** تُستهلك الأحداث مرة واحدة ثم تُفرَّغ. */
  drainEvents(sink: GameEvent[]): void {
    for (const event of this.events) sink.push(event);
    this.events.length = 0;
  }

  /**
   * حركة حرة: زاوية أي درجة وسرعة تناظرية.
   * الموضع عشري مستمر، والشبكة تُستخدم لاحتساب الأرض فقط.
   */
  private advance(actor: Actor, dt: number): void {
    const controller = this.controllers.get(actor.id);

    let throttle = 1;
    const intent = controller?.intent?.(this, actor) ?? null;
    if (intent) {
      actor.heading = intent.heading;
      actor.dir = headingToDir(intent.heading);
      throttle = clamp(intent.throttle, 0, 1);
      if (throttle > 0) throttle = Math.max(throttle, GameEngine.MIN_THROTTLE);
    }

    const distance = this.config.speedCellsPerSecond * throttle * dt;
    if (distance <= 0) return;

    const grid = this.grid;
    const targetX = clamp(actor.x + Math.cos(actor.heading) * distance, EDGE, grid.width - EDGE);
    const targetY = clamp(actor.y + Math.sin(actor.heading) * distance, EDGE, grid.height - EDGE);

    this.traverse(actor, actor.x, actor.y, targetX, targetY);
    if (!actor.alive) return;

    actor.x = targetX;
    actor.y = targetY;
  }

  /**
   * يمشي على كل خلية يعبرها المقطع، خطوةً على محور واحد في كل مرة.
   * هذا يضمن أن المسار متصل من أربع جهات حتى في الحركة القطرية،
   * وبدونه يتسرّب الملء من فتحات الأقطار فلا تُحتسب المساحة.
   */
  private traverse(actor: Actor, x0: number, y0: number, x1: number, y1: number): void {
    let cx = Math.floor(x0);
    let cy = Math.floor(y0);
    const endX = Math.floor(x1);
    const endY = Math.floor(y1);
    if (cx === endX && cy === endY) return;

    const dx = x1 - x0;
    const dy = y1 - y0;
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    let tMaxX = stepX === 0 ? Infinity : (stepX > 0 ? cx + 1 - x0 : x0 - cx) / absDx;
    let tMaxY = stepY === 0 ? Infinity : (stepY > 0 ? cy + 1 - y0 : y0 - cy) / absDy;
    const tDeltaX = stepX === 0 ? Infinity : 1 / absDx;
    const tDeltaY = stepY === 0 ? Infinity : 1 / absDy;

    let guard = 0;
    while ((cx !== endX || cy !== endY) && guard++ < 64) {
      if (tMaxX < tMaxY) {
        cx += stepX;
        tMaxX += tDeltaX;
      } else {
        cy += stepY;
        tMaxY += tDeltaY;
      }
      if (!this.enterCell(actor, cx, cy)) return;
    }
  }

  /** يعالج دخول خلية جديدة. يعيد false إذا خرج المشارك من الجولة. */
  private enterCell(actor: Actor, nx: number, ny: number): boolean {
    const grid = this.grid;
    if (!grid.inBounds(nx, ny)) return true;

    const index = grid.index(nx, ny);
    const trailOwner = grid.trail[index];

    if (trailOwner === actor.id) {
      if (!this.isRecentTrail(actor, index)) {
        this.killActor(actor, 'self');
        return false;
      }
    } else if (trailOwner !== 0) {
      const victim = this.byId.get(trailOwner);
      if (victim && victim.alive && this.authoritative) {
        actor.kills++;
        this.events.push({
          type: 'kill',
          killerId: actor.id,
          victimId: victim.id,
          x: nx + 0.5,
          y: ny + 0.5,
        });
        this.killActor(victim, 'trail');
      }
    }

    const fromIndex = grid.index(actor.cx, actor.cy);
    actor.cx = nx;
    actor.cy = ny;

    if (grid.owner[index] === actor.id) {
      if (actor.outside) this.closeLoop(actor);
    } else {
      if (!actor.outside) {
        actor.outside = true;
        actor.exitCell = fromIndex;
      }
      if (grid.trail[index] !== actor.id) {
        grid.trail[index] = actor.id;
        actor.trail.push(index);
      }
    }

    // البوتات تقرر عند كل خلية جديدة، تمامًا كما كانت.
    const wanted = this.controllers.get(actor.id)?.decide?.(this, actor) ?? null;
    if (wanted !== null && wanted !== actor.dir) {
      actor.dir = wanted;
      actor.heading = dirToHeading(wanted);
      // إبقاء المتحرك على محور الخلية كي تبقى مساراته مستقيمة.
      if (wanted === 0 || wanted === 2) actor.y = actor.cy + 0.5;
      else actor.x = actor.cx + 0.5;
    }
    return true;
  }

  /** هل الخلية من آخر خطوات المسار؟ (نافذة سماح للالتفاف الحاد) */
  private isRecentTrail(actor: Actor, index: number): boolean {
    const trail = actor.trail;
    const from = Math.max(0, trail.length - GameEngine.SELF_GRACE_CELLS);
    for (let i = trail.length - 1; i >= from; i--) {
      if (trail[i] === index) return true;
    }
    return false;
  }

  /** إغلاق المسار: المسار نفسه يصبح ملكًا، ثم يُملأ كل فراغ محاصَر. */
  private closeLoop(actor: Actor): void {
    const grid = this.grid;
    let gained = 0;

    for (const index of actor.trail) {
      grid.trail[index] = 0;
      const previous = grid.owner[index];
      if (previous !== actor.id) {
        grid.owner[index] = actor.id;
        this.transferCell(previous, actor);
        gained++;
      }
      this.growBox(actor, index);
    }
    actor.trail.length = 0;
    actor.outside = false;

    gained += this.capture.fill(actor.id, actor, (index, previous) => {
      this.transferCell(previous, actor);
      this.growBox(actor, index);
    });

    this.events.push({ type: 'capture', actorId: actor.id, gained });
    this.flushWipes();
  }

  private transferCell(previousOwner: number, actor: Actor): void {
    actor.area++;
    if (previousOwner === 0 || previousOwner === actor.id) return;
    const victim = this.byId.get(previousOwner);
    if (!victim) return;
    victim.area--;
    if (victim.area <= 0 && victim.alive && this.pendingWipe.indexOf(victim.id) === -1) {
      this.pendingWipe.push(victim.id);
    }
  }

  /** من فقد كامل أرضه يخرج من الجولة — يُنفَّذ بعد انتهاء الملء لا أثناءه. */
  private flushWipes(): void {
    while (this.pendingWipe.length > 0) {
      const id = this.pendingWipe.pop()!;
      const victim = this.byId.get(id);
      if (victim && victim.alive && victim.area <= 0) this.killActor(victim, 'wiped');
    }
  }

  private growBox(actor: Actor, index: number): void {
    const x = index % this.grid.width;
    const y = (index / this.grid.width) | 0;
    if (x < actor.minX) actor.minX = x;
    if (y < actor.minY) actor.minY = y;
    if (x > actor.maxX) actor.maxX = x;
    if (y > actor.maxY) actor.maxY = y;
  }

  private resolveCollisions(): void {
    const actors = this.actors;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < actors.length; j++) {
        const b = actors[j];
        if (!b.alive) continue;
        if (a.cx !== b.cx || a.cy !== b.cy) continue;
        // من كان خارج أرضه هو الخاسر؛ إن كان كلاهما خارجًا خسرا معًا.
        if (a.outside) this.killActor(a, 'collision');
        if (b.outside) this.killActor(b, 'collision');
      }
    }
  }

  /**
   * خروج مشارك من الجولة.
   * في المرآة لا يُنفَّذ أبدًا من المحاكاة المحلية — الخادم وحده يقرّر،
   * ثم يصل قراره عبر applyDeath. بلا هذا الفصل يخترع العميل قتلى لا وجود لهم.
   */
  private killActor(actor: Actor, cause: 'self' | 'trail' | 'collision' | 'wiped'): void {
    if (!this.authoritative) return;
    this.performKill(actor, cause);
  }

  /** تطبيق قرار موت صادر عن الخادم على نسخة المرآة. */
  applyDeath(actorId: number, cause: 'self' | 'trail' | 'collision' | 'wiped' = 'trail'): void {
    const actor = this.byId.get(actorId);
    if (actor) this.performKill(actor, cause);
  }

  private performKill(actor: Actor, cause: 'self' | 'trail' | 'collision' | 'wiped'): void {
    if (!actor.alive) return;
    actor.alive = false;
    actor.deaths++;
    actor.blocked = false;

    const grid = this.grid;
    for (const index of actor.trail) grid.trail[index] = 0;
    actor.trail.length = 0;
    actor.outside = false;

    // تُحرَّر أرضه للخريطة.
    const owner = grid.owner;
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] === actor.id) owner[i] = 0;
    }
    actor.area = 0;

    this.events.push({ type: 'death', actorId: actor.id, cause });
    this.controllers.get(actor.id)?.reset?.();

    if (actor.kind === 'bot') {
      // البوت يعود بعد مهلة؛ في المرآة يصل قرار العودة من الخادم لا من هنا.
      actor.respawnAt = this.authoritative ? this.elapsed + this.config.botRespawnSeconds : -1;
    } else if (this.endOnHumanDeath) {
      this.end('eliminated');
    }
  }

  private respawn(actor: Actor): void {
    actor.respawnAt = -1;
    this.placeActor(actor);
    this.controllers.get(actor.id)?.reset?.();
    this.events.push({ type: 'respawn', actorId: actor.id });
  }

  /** يضع المشارك في رقعة فارغة ويمنحه أرض البداية. */
  private placeActor(actor: Actor): void {
    const radius = this.config.startAreaRadius;
    const spot = this.findFreeSpot(radius);

    actor.cx = spot.x;
    actor.cy = spot.y;
    actor.x = spot.x + 0.5;
    actor.y = spot.y + 0.5;
    actor.dir = this.rng.int(0, 3) as Dir;
    actor.heading = dirToHeading(actor.dir);
    actor.trail.length = 0;
    actor.outside = false;
    actor.exitCell = this.grid.index(spot.x, spot.y);
    actor.alive = true;
    actor.blocked = false;
    actor.area = 0;
    actor.minX = spot.x;
    actor.minY = spot.y;
    actor.maxX = spot.x;
    actor.maxY = spot.y;

    const grid = this.grid;
    for (let y = spot.y - radius; y <= spot.y + radius; y++) {
      for (let x = spot.x - radius; x <= spot.x + radius; x++) {
        if (!grid.inBounds(x, y)) continue;
        const index = grid.index(x, y);
        const previous = grid.owner[index];
        grid.trail[index] = 0;
        grid.owner[index] = actor.id;
        this.transferCell(previous, actor);
        this.growBox(actor, index);
      }
    }
    this.flushWipes();
  }

  private findFreeSpot(radius: number): { x: number; y: number } {
    const grid = this.grid;
    const margin = radius + 2;
    for (let attempt = 0; attempt < 400; attempt++) {
      const x = this.rng.int(margin, grid.width - 1 - margin);
      const y = this.rng.int(margin, grid.height - 1 - margin);
      if (this.isAreaFree(x, y, radius + 1)) return { x, y };
    }
    // احتياط: أول موضع صالح مهما كان.
    for (let y = margin; y < grid.height - margin; y++) {
      for (let x = margin; x < grid.width - margin; x++) {
        if (this.isAreaFree(x, y, radius)) return { x, y };
      }
    }
    return { x: (grid.width / 2) | 0, y: (grid.height / 2) | 0 };
  }

  private isAreaFree(cx: number, cy: number, radius: number): boolean {
    const grid = this.grid;
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (!grid.inBounds(x, y)) return false;
        const index = grid.index(x, y);
        if (grid.owner[index] !== 0 || grid.trail[index] !== 0) return false;
      }
    }
    return true;
  }
}

/** هامش صغير يمنع الخروج من حدود الشبكة عند القصّ. */
const EDGE = 0.001;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
