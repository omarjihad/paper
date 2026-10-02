import { GameEngine, type Actor } from '@riqaa/game-core';
import { DEATH_CAUSE_TEXT, type DeathCause, type MatchConfig, type MatchParticipant } from '@riqaa/shared';
import { h } from '../ui/dom.js';
import { Renderer } from './renderer.js';

/** كم ثانية من الماضي تُحفظ للإعادة. */
const HISTORY_SECONDS = 4;
/** عدد اللقطات في الثانية داخل المسجّل. */
const RECORD_HZ = 30;
const MAX_FRAMES = Math.ceil(HISTORY_SECONDS * RECORD_HZ);
/** سرعة الإعادة: أبطأ من اللعب كي تُرى لحظة القطع. */
const PLAYBACK_RATE = 0.55;
/** وقفة بعد نهاية المشهد قبل إعادته. */
const LOOP_PAUSE_MS = 1100;
/**
 * مستوى التقريب: **نفس اللعب تمامًا**.
 * توسيع المشهد كان يجعل الإعادة تبدو خريطةً لا جولة، واللاعب طلب أن يرى
 * ما رآه لحظتها بالضبط لا مشهدًا آخر يشبهه.
 */
const REPLAY_VIEW_CELLS = 30;

/**
 * لقطة واحدة من الماضي.
 *
 * الأرض تُحفظ فروقًا لا صورًا كاملة: الشبكة 150×150 لا تتغيّر إلا عند
 * استحواذ أو خروج، فحفظ نسخة منها ثلاثين مرة في الثانية يعني ميغابايتات
 * تُخصَّص وتُجمَع أثناء اللعب — وهذا وحده يصنع التقطّع الذي نحاربه.
 */
interface Frame {
  t: number;
  /** [x, y, heading, alive] لكل مشارك بترتيب المشاركين. */
  state: Float32Array;
  /** مسار كل مشارك (فهارس خلايا) — منه يُرسم الخط كما في اللعبة. */
  trails: Int32Array[];
  /** أزواج (فهرس، مالك جديد) تنقل الأرض من اللقطة السابقة إلى هذه. */
  ownerChanges: Int32Array;
}

/**
 * مسجّل آخر ثوانٍ من الجولة.
 *
 * يعمل على الجهاز لا على الشبكة: ما يُسجَّل هو ما رآه اللاعب على شاشته،
 * فحفظه لا يكلّف حزمة واحدة. الخادم يرسل الحكم فقط (من أخرجك وأين
 * ولماذا)، والجهاز يعيد عرض ما رآه — فالحقيقة من الخادم والصورة من هنا.
 */
export class DeathRecorder {
  private readonly frames: Frame[] = [];
  /** الأرض كما كانت عند أقدم لقطة محفوظة — نقطة انطلاق الإعادة. */
  private base: Uint8Array;
  /** آخر حالة أرض قيست، لاشتقاق الفروق منها. */
  private previous: Uint8Array;
  private clock = 0;

  constructor(private readonly engine: GameEngine) {
    this.base = engine.grid.owner.slice();
    this.previous = engine.grid.owner.slice();
  }

  /** يُستدعى كل إطار رسم؛ يأخذ عيّنة بمعدل ثابت لا بمعدل الإطارات. */
  sample(dt: number): void {
    this.clock += dt;
    if (this.clock < 1 / RECORD_HZ) return;
    this.clock = 0;

    const engine = this.engine;
    const actors = engine.actors;
    const state = new Float32Array(actors.length * 4);
    const trails: Int32Array[] = [];
    for (let i = 0; i < actors.length; i++) {
      const actor = actors[i];
      state[i * 4] = actor.x;
      state[i * 4 + 1] = actor.y;
      state[i * 4 + 2] = actor.heading;
      state[i * 4 + 3] = actor.alive ? 1 : 0;
      trails.push(Int32Array.from(actor.trail));
    }

    const owner = engine.grid.owner;
    const previous = this.previous;
    const changed: number[] = [];
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] === previous[i]) continue;
      changed.push(i, owner[i]);
      previous[i] = owner[i];
    }

    this.frames.push({ t: performance.now(), state, trails, ownerChanges: Int32Array.from(changed) });

    // اللقطة الخارجة تُطوى في الأساس كي تبقى نقطة الانطلاق صحيحة.
    while (this.frames.length > MAX_FRAMES) {
      const dropped = this.frames.shift();
      if (!dropped) break;
      const changes = dropped.ownerChanges;
      for (let i = 0; i < changes.length; i += 2) this.base[changes[i]] = changes[i + 1];
    }
  }

  /** الشريط الحالي كما هو — يُستهلك فورًا ولا يُحتفظ به. */
  take(): { base: Uint8Array; frames: Frame[] } | null {
    if (this.frames.length < 4) return null;
    return { base: this.base.slice(), frames: this.frames.slice() };
  }
}

export interface DeathReplay {
  victimActorId: number;
  killerActorId: number | null;
  killerName: string | null;
  cause: DeathCause;
  /** مكان القطع كما قرّره الخادم. */
  x: number;
  y: number;
  colorOf: (actorId: number) => string;
}

/**
 * شاشة «كيف خرجتُ من الجولة».
 *
 * ليست رسمًا مبسّطًا للحدث: هي اللعبة نفسها تُعاد. تُبنى نسخة صامتة من
 * المحرك ويُركَّب عليها **الراسم نفسه** الذي يرسم الجولة، ثم تُكتب فيها
 * لقطات الماضي واحدةً واحدة. فما يراه اللاعب في الإعادة هو ما رآه لحظتها
 * بالضبط — نفس الألوان ونفس الأرض ونفس الخطوط — لا رسمًا آخر يشبهه.
 */
export class DeathCam {
  readonly element: HTMLElement;
  private readonly title: HTMLElement;
  private readonly reason: HTMLElement;
  private readonly progress: HTMLElement;

  /** محرك صامت لا يُشغَّل أبدًا: يُكتب فيه الماضي ويُقرأ منه الرسم. */
  private readonly stage: GameEngine;
  private readonly renderer: Renderer;
  private readonly idle = { active: false, originX: 0, originY: 0, knobX: 0, knobY: 0 };
  private readonly ctx: CanvasRenderingContext2D;

  private replay: DeathReplay | null = null;
  private tape: { base: Uint8Array; frames: Frame[] } | null = null;
  private cursor = -1;
  private startedAt = 0;
  private lastDraw = 0;
  private onClose: (() => void) | null = null;

  constructor(
    /** لوحة اللعبة نفسها: الإعادة تحدث هنا لا في شاشة أخرى. */
    private readonly canvas: HTMLCanvasElement,
    config: MatchConfig,
    participants: readonly MatchParticipant[],
    seed: number,
  ) {
    this.stage = new GameEngine({ config, seed, authoritative: false, endOnHumanDeath: false });
    for (const participant of participants) {
      this.stage.addParticipant({
        id: participant.actorId,
        kind: participant.kind,
        name: participant.name,
        colorIndex: participant.colorIndex,
        difficulty: participant.kind === 'bot' ? participant.difficulty : null,
      });
    }
    // الأرض التي وزّعها البناء تُمحى: كل خلية ستأتي من التسجيل.
    this.stage.grid.owner.fill(0);
    this.renderer = new Renderer(canvas, this.stage, { chrome: false, visibleCells: REPLAY_VIEW_CELLS });
    const context = canvas.getContext('2d');
    if (!context) throw new Error('تعذّر إنشاء سياق الرسم');
    this.ctx = context;

    this.title = h('div', { class: 'cam__title' });
    this.reason = h('div', { class: 'cam__reason' });
    this.progress = h('div', { class: 'cam__bar' }, [h('i', { class: 'cam__bar-fill' })]);

    // طبقة رقيقة فوق الملعب لا بطاقة تحجبه: الملعب هو المشهد، وهذه
    // الطبقة تقول فقط ماذا نشاهد ومتى نخرج منه.
    this.element = h('div', { class: 'cam', hidden: 'hidden' }, [
      h('div', { class: 'cam__top' }, [
        h('div', { class: 'cam__badge' }, [h('span', { class: 'cam__rew', text: '◀◀' }), h('span', { text: 'إعادة' })]),
        this.title,
        this.reason,
      ]),
      h('div', { class: 'cam__bottom' }, [
        this.progress,
        h(
          'button',
          { class: 'btn btn--ghost cam__close', type: 'button', onclick: () => this.close() },
          ['متابعة'],
        ),
      ]),
    ]);
  }

  show(replay: DeathReplay, tape: { base: Uint8Array; frames: Frame[] }, onClose: () => void): void {
    this.replay = replay;
    this.tape = tape;
    this.onClose = onClose;
    this.cursor = -1;

    if (replay.killerName) {
      this.title.textContent = '';
      this.title.append(
        h('span', { text: 'أخرجك ' }),
        h('b', { text: replay.killerName, style: `color:${replay.colorOf(replay.killerActorId ?? 0)}` }),
      );
    } else {
      this.title.textContent = 'خرجت من الجولة';
    }
    this.reason.textContent = DEATH_CAUSE_TEXT[replay.cause];

    // الكاميرا تتبع من خرج، لا من تتبعه الجولة.
    this.stage.focusActorId = replay.victimActorId;
    // الخطّان المعنيّان وحدهما بكامل وضوحهما، وما عداهما يخفت.
    this.renderer.spotlight =
      replay.killerActorId === null
        ? [replay.victimActorId]
        : [replay.victimActorId, replay.killerActorId];

    this.element.removeAttribute('hidden');
    this.renderer.resize();
    this.renderer.snapCamera();
    this.startedAt = performance.now();
    this.lastDraw = this.startedAt;
  }

  /** هل الإعادة جارية الآن؟ */
  get active(): boolean {
    return this.tape !== null;
  }

  close(): void {
    this.element.setAttribute('hidden', 'hidden');
    this.replay = null;
    this.tape = null;
    const handler = this.onClose;
    this.onClose = null;
    handler?.();
  }

  destroy(): void {
    this.element.remove();
  }

  resize(): void {
    if (this.tape) this.renderer.resize();
  }

  /**
   * تُقاد من حلقة رسم اللعبة نفسها لا من حلقة خاصة بها: الإعادة ليست شاشةً
   * أخرى لها دورتها، بل هي الملعب نفسه وقد رجع بالزمن.
   */
  tick(now: number): void {
    const tape = this.tape;
    if (!tape) return;

    const frames = tape.frames;
    const span = frames[frames.length - 1].t - frames[0].t;
    if (span <= 0) return;

    const cycle = span / PLAYBACK_RATE + LOOP_PAUSE_MS;
    const position = (now - this.startedAt) % cycle;
    const target = frames[0].t + Math.min(span, position * PLAYBACK_RATE);

    let index = 0;
    while (index + 1 < frames.length && frames[index + 1].t <= target) index++;

    this.seek(tape, index);
    (this.progress.firstElementChild as HTMLElement).style.width =
      `${Math.round(((target - frames[0].t) / span) * 100)}%`;

    const dt = Math.min((now - this.lastDraw) / 1000, 0.1);
    this.lastDraw = now;
    this.renderer.draw(this.idle, dt);
    this.drawMarks(now);
  }

  /**
   * الأوسمة فوق المشهد.
   *
   * الإعادة وحدها لا تكفي: عشرة خطوط بألوان متقاربة على شاشة هاتف، فلا
   * يعرف اللاعب أيّها خطّه ولا من قطعه. هنا يُكتب على خطّه «خطك» وعلى
   * خصمه اسمه، وتُحلَّق نقطة القطع — فيرى بعينه ما جرى لا يخمّنه.
   */
  private drawMarks(now: number): void {
    const replay = this.replay;
    if (!replay) return;
    const ctx = this.ctx;
    const victim = this.stage.actorById(replay.victimActorId);
    const killer = replay.killerActorId === null ? null : this.stage.actorById(replay.killerActorId);

    if (victim) {
      const anchor = this.trailAnchor(victim) ?? { x: victim.x, y: victim.y };
      this.tag(anchor.x, anchor.y, 'خطك', replay.colorOf(victim.id), true);
    }
    if (killer && killer.alive) {
      this.tag(killer.x, killer.y, replay.killerName ?? 'الخصم', replay.colorOf(killer.id), false);
    }

    // نقطة القطع: حلقة نابضة باسم من قطع.
    // الحلقة وحدها تقول «هنا» ولا تقول «من»، والخصم قد يكون خارج الكادر
    // في هذه اللحظة من التسجيل — فاسمه يُكتب على الحلقة نفسها.
    if (replay.killerActorId !== null) {
      const p = this.renderer.project(replay.x, replay.y);
      const pulse = 0.5 + 0.5 * Math.sin(now / 260);
      const r = this.renderer.cellSize * (0.9 + pulse * 0.7);
      ctx.save();
      ctx.strokeStyle = `rgba(255,96,96,${0.45 + pulse * 0.45})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      this.tag(replay.x, replay.y, `${replay.killerName ?? 'الخصم'} قطعه هنا`, '#ff7a7a', true);
    }
  }

  /** منتصف المسار المرئي — أوضح مكان لوسم «خطك». */
  private trailAnchor(actor: Actor): { x: number; y: number } | null {
    if (actor.trail.length === 0) return null;
    const index = actor.trail[Math.floor(actor.trail.length / 2)];
    const width = this.stage.width;
    return { x: (index % width) + 0.5, y: Math.floor(index / width) + 0.5 };
  }

  /** وسم نصّي بقرص خلفه كي يُقرأ فوق أي لون. */
  private tag(worldX: number, worldY: number, text: string, color: string, below: boolean): void {
    const ctx = this.ctx;
    const p = this.renderer.project(worldX, worldY);
    ctx.save();
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const width = ctx.measureText(text).width + 18;
    const height = 22;
    const y = p.y + (below ? 26 : -26);
    ctx.fillStyle = 'rgba(8,12,20,0.82)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    roundedBox(ctx, p.x - width / 2, y - height / 2, width, height, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(text, p.x, y + 0.5);
    ctx.restore();
  }

  /** يضع المحرك الصامت على حالة اللقطة رقم `index` بالضبط. */
  private seek(tape: { base: Uint8Array; frames: Frame[] }, index: number): void {
    if (index === this.cursor) return;
    const owner = this.stage.grid.owner;

    // أول عرض أو رجوعٌ للخلف: نبدأ من الأساس ثم نتقدّم إليه.
    // بلا شرط البداية تبقى الأرض فارغة تمامًا فلا يرى اللاعب إلا خطًّا
    // معلّقًا في العدم — وهو أبعد ما يكون عن «مثل اللعبة بالضبط».
    if (index <= this.cursor || this.cursor < 0) {
      owner.set(tape.base);
      this.cursor = -1;
      this.renderer.snapCamera();
    }
    for (let i = this.cursor + 1; i <= index; i++) {
      const changes = tape.frames[i].ownerChanges;
      for (let c = 0; c < changes.length; c += 2) owner[changes[c]] = changes[c + 1];
    }
    this.cursor = index;

    const frame = tape.frames[index];
    const actors = this.stage.actors;
    for (let i = 0; i < actors.length && i * 4 + 3 < frame.state.length; i++) {
      const actor: Actor = actors[i];
      actor.x = frame.state[i * 4];
      actor.y = frame.state[i * 4 + 1];
      actor.heading = frame.state[i * 4 + 2];
      actor.alive = frame.state[i * 4 + 3] === 1;
      actor.cx = Math.floor(actor.x);
      actor.cy = Math.floor(actor.y);
      const trail = frame.trails[i];
      actor.trail.length = 0;
      for (let t = 0; t < trail.length; t++) actor.trail.push(trail[t]);
    }
  }
}

/** مستطيل بزوايا مستديرة — نرسمه بأنفسنا لأن roundRect غير متاح في كل متصفّح. */
function roundedBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}
