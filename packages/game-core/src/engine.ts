import type { BotDifficulty, MatchConfig } from '@riqaa/shared';
import { CaptureSolver } from './capture.js';
import { Grid } from './grid.js';
import { Rng } from './rng.js';
import {
  DX,
  DY,
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

  constructor(options: EngineOptions) {
    this.config = options.config;
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

  /** إحداثيات الرسم المنعّمة بين خليتين. */
  renderX(actor: Actor): number {
    return actor.blocked ? actor.cx : actor.cx + DX[actor.dir] * actor.progress;
  }

  renderY(actor: Actor): number {
    return actor.blocked ? actor.cy : actor.cy + DY[actor.dir] * actor.progress;
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
      cx: 0,
      cy: 0,
      dir: 0,
      nextDir: 0,
      progress: 0,
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
    if (spec.kind === 'human') this.humanId = actor.id;
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

    const distance = dt * this.config.speedCellsPerSecond;
    for (const actor of this.actors) {
      if (!actor.alive) {
        if (actor.respawnAt >= 0 && this.elapsed >= actor.respawnAt) this.respawn(actor);
        continue;
      }
      this.advance(actor, distance);
    }

    this.resolveCollisions();

    if (this.status === 'running' && this.config.roundSeconds > 0 && this.elapsed >= this.config.roundSeconds) {
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

  private advance(actor: Actor, distance: number): void {
    actor.progress += distance;
    let guard = 0;
    while (actor.progress >= 1 && actor.alive && guard++ < 8) {
      actor.progress -= 1;
      this.stepCell(actor);
    }
    if (!actor.alive) actor.progress = 0;
  }

  private stepCell(actor: Actor): void {
    const grid = this.grid;
    const controller = this.controllers.get(actor.id);
    if (controller) {
      const wanted = controller.decide(this, actor);
      if (wanted !== null) actor.nextDir = wanted;
    }

    // الاستدارة 180 درجة مسموحة فقط إن لم تكن انتحارًا فوريًا على المسار الذاتي.
    // (المنع المطلق كان يُعلِّق اللاعب لو ظهر متجهًا عكس أول إدخال منه.)
    if (actor.nextDir !== ((actor.dir + 2) & 3)) {
      actor.dir = actor.nextDir;
    } else {
      const bx = actor.cx + DX[actor.nextDir];
      const by = actor.cy + DY[actor.nextDir];
      if (grid.inBounds(bx, by) && grid.trail[grid.index(bx, by)] !== actor.id) {
        actor.dir = actor.nextDir;
      }
    }

    const fromIndex = grid.index(actor.cx, actor.cy);
    const nx = actor.cx + DX[actor.dir];
    const ny = actor.cy + DY[actor.dir];

    if (!grid.inBounds(nx, ny)) {
      // الحدود تمنع الحركة ولا تقتل — أرحم بكثير على شاشة الهاتف.
      // نُبقي التقدّم قرب الحافة كي تُعاد المحاولة في الإطار التالي مباشرة.
      actor.blocked = true;
      actor.progress = 0.99;
      return;
    }
    actor.blocked = false;

    const targetIndex = grid.index(nx, ny);
    const trailOwner = grid.trail[targetIndex];

    if (trailOwner === actor.id) {
      this.killActor(actor, 'self');
      return;
    }
    if (trailOwner !== 0) {
      const victim = this.byId.get(trailOwner);
      if (victim && victim.alive) {
        actor.kills++;
        this.events.push({ type: 'kill', killerId: actor.id, victimId: victim.id });
        this.killActor(victim, 'trail');
      }
    }

    actor.cx = nx;
    actor.cy = ny;

    if (grid.owner[targetIndex] === actor.id) {
      if (actor.outside) this.closeLoop(actor);
      return;
    }

    if (!actor.outside) {
      actor.outside = true;
      actor.exitCell = fromIndex;
    }
    grid.trail[targetIndex] = actor.id;
    actor.trail.push(targetIndex);
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

  private killActor(actor: Actor, cause: 'self' | 'trail' | 'collision' | 'wiped'): void {
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
      actor.respawnAt = this.elapsed + this.config.botRespawnSeconds;
    } else {
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
    actor.dir = this.rng.int(0, 3) as Dir;
    actor.nextDir = actor.dir;
    actor.progress = 0;
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
