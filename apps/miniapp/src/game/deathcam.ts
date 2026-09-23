import type { GameEngine } from '@riqaa/game-core';
import { DEATH_CAUSE_TEXT, type DeathCause } from '@riqaa/shared';
import { h } from '../ui/dom.js';

/** كم ثانية من الماضي تُحفظ للإعادة. */
const HISTORY_SECONDS = 3.5;
/** عدد اللقطات في الثانية داخل المسجّل — تكفي لخط سلس بلا ذاكرة تُذكر. */
const RECORD_HZ = 20;
const MAX_FRAMES = Math.ceil(HISTORY_SECONDS * RECORD_HZ);
/** سرعة الإعادة: نصف السرعة كي تُرى لحظة القطع. */
const PLAYBACK_RATE = 0.5;
/** أقل وأكثر عدد خلايا يظهر في الإطار — حدّان يمنعان تقريبًا مبالغًا أو بعيدًا. */
const MIN_VIEW_CELLS = 12;
const MAX_VIEW_CELLS = 44;

interface Frame {
  t: number;
  /** [id, x, y, alive] لكل مشارك. */
  actors: Float32Array;
}

/**
 * مسجّل آخر ثوانٍ من الجولة.
 *
 * يعمل على الجهاز لا على الشبكة: المواضع معروضة أصلًا على الشاشة، فحفظها
 * لا يكلّف حزمة واحدة. الخادم يرسل الحكم فقط (من أخرجك وأين ولماذا)،
 * والجهاز يعيد رسم ما رآه — فالحقيقة من الخادم والصورة من عندنا.
 */
export class DeathRecorder {
  private readonly frames: Frame[] = [];
  private clock = 0;

  constructor(private readonly engine: GameEngine) {}

  /** يُستدعى كل إطار رسم؛ يأخذ عيّنة بمعدل ثابت لا بمعدل الإطارات. */
  sample(dt: number): void {
    this.clock += dt;
    if (this.clock < 1 / RECORD_HZ) return;
    this.clock = 0;

    const actors = this.engine.actors;
    const data = new Float32Array(actors.length * 4);
    for (let i = 0; i < actors.length; i++) {
      const actor = actors[i];
      data[i * 4] = actor.id;
      data[i * 4 + 1] = actor.x;
      data[i * 4 + 2] = actor.y;
      data[i * 4 + 3] = actor.alive ? 1 : 0;
    }
    this.frames.push({ t: performance.now(), actors: data });
    while (this.frames.length > MAX_FRAMES) this.frames.shift();
  }

  /** نسخة مجمّدة من الشريط الحالي. */
  snapshot(): Frame[] {
    return this.frames.map((frame) => ({ t: frame.t, actors: frame.actors.slice() }));
  }
}

interface View {
  cell: number;
  offsetX: number;
  offsetY: number;
}

export interface DeathReplay {
  victimActorId: number;
  killerActorId: number | null;
  victimName: string;
  killerName: string | null;
  cause: DeathCause;
  x: number;
  y: number;
  frames: Frame[];
  colorOf: (actorId: number) => string;
}

/**
 * شاشة «كيف خرجتُ من الجولة».
 * تعيد آخر ثوانٍ مبطّأةً حول نقطة الحدث: مسارك، ومسار من قطعه، ونقطة
 * التقائهما. الغرض أن يرى اللاعب بعينه أنه لم يُظلم.
 */
export class DeathCam {
  readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly title: HTMLElement;
  private readonly reason: HTMLElement;
  private replay: DeathReplay | null = null;
  private frameHandle = 0;
  private startedAt = 0;
  private dpr = 1;
  private onClose: (() => void) | null = null;

  constructor() {
    this.canvas = h('canvas', { class: 'cam__canvas' });
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('تعذّر إنشاء سياق الرسم');
    this.ctx = context;

    this.title = h('div', { class: 'cam__title' });
    this.reason = h('div', { class: 'cam__reason' });
    this.element = h('div', { class: 'cam', hidden: 'hidden' }, [
      h('div', { class: 'cam__card' }, [
        this.title,
        this.canvas,
        this.reason,
        h(
          'button',
          { class: 'btn btn--ghost cam__close', type: 'button', onclick: () => this.close() },
          ['متابعة'],
        ),
      ]),
    ]);
  }

  show(replay: DeathReplay, onClose: () => void): void {
    this.replay = replay;
    this.onClose = onClose;

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

    this.element.removeAttribute('hidden');
    this.resize();
    this.startedAt = performance.now();
    cancelAnimationFrame(this.frameHandle);
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  close(): void {
    cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
    this.element.setAttribute('hidden', 'hidden');
    this.replay = null;
    const handler = this.onClose;
    this.onClose = null;
    handler?.();
  }

  destroy(): void {
    cancelAnimationFrame(this.frameHandle);
    this.element.remove();
  }

  private resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, this.canvas.offsetWidth);
    const height = Math.max(1, this.canvas.offsetHeight);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private frame = (now: number): void => {
    const replay = this.replay;
    if (!replay) return;
    this.frameHandle = requestAnimationFrame(this.frame);

    const frames = replay.frames;
    if (frames.length < 2) return;

    const span = frames[frames.length - 1].t - frames[0].t;
    const elapsed = (now - this.startedAt) * PLAYBACK_RATE;
    // وقفة قصيرة عند لحظة القطع ثم إعادة الكرّة.
    const cycle = span + 1400;
    const cursor = Math.min(span, elapsed % cycle);
    this.draw(replay, frames[0].t + cursor);
  };

  /**
   * يؤطّر المشهد على الخطّين المعنيين لا على نقطة الحدث وحدها.
   * تثبيتُ تقريبٍ واحد يجعل المسارين خطّين قصيرين في زاوية بينما تملأ
   * الشاشةَ رحلاتُ من لا علاقة لهم بالحدث.
   */
  private frameView(replay: DeathReplay, width: number, height: number): View {
    let minX = replay.x;
    let maxX = replay.x;
    let minY = replay.y;
    let maxY = replay.y;

    const slots = this.focusSlots(replay);
    for (const frame of replay.frames) {
      for (const slot of slots) {
        if (frame.actors[slot * 4 + 3] === 0) continue;
        const x = frame.actors[slot * 4 + 1];
        const y = frame.actors[slot * 4 + 2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    const span = Math.max(maxX - minX, maxY - minY) + 6;
    const cells = Math.min(MAX_VIEW_CELLS, Math.max(MIN_VIEW_CELLS, span));
    const cell = Math.min(width, height) / cells;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    return { cell, offsetX: width / 2 - centerX * cell, offsetY: height / 2 - centerY * cell };
  }

  private focusSlots(replay: DeathReplay): number[] {
    const focus = new Set<number>([replay.victimActorId]);
    if (replay.killerActorId !== null) focus.add(replay.killerActorId);
    const slots: number[] = [];
    const count = replay.frames[0].actors.length / 4;
    for (let slot = 0; slot < count; slot++) {
      if (focus.has(replay.frames[0].actors[slot * 4])) slots.push(slot);
    }
    return slots;
  }

  private draw(replay: DeathReplay, until: number): void {
    const { ctx } = this;
    const width = this.canvas.width / this.dpr;
    const height = this.canvas.height / this.dpr;
    const { cell, offsetX, offsetY } = this.frameView(replay, width, height);

    ctx.fillStyle = '#0a0f18';
    ctx.fillRect(0, 0, width, height);

    // شبكة خفيفة تعطي إحساس المسافة.
    if (cell >= 4) {
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let px = offsetX % cell; px < width; px += cell) {
        ctx.moveTo(Math.round(px) + 0.5, 0);
        ctx.lineTo(Math.round(px) + 0.5, height);
      }
      for (let py = offsetY % cell; py < height; py += cell) {
        ctx.moveTo(0, Math.round(py) + 0.5);
        ctx.lineTo(width, Math.round(py) + 0.5);
      }
      ctx.stroke();
    }

    const focus = new Set<number>([replay.victimActorId]);
    if (replay.killerActorId !== null) focus.add(replay.killerActorId);

    const count = replay.frames[0].actors.length / 4;
    const labels: { x: number; y: number; text: string; color: string }[] = [];

    // البقية تُرسم أولًا وباهتة كي لا تزاحم الخطّين المعنيين.
    for (const pass of [false, true]) {
      for (let slot = 0; slot < count; slot++) {
        const id = replay.frames[0].actors[slot * 4];
        const isFocus = focus.has(id);
        if (isFocus !== pass) continue;

        ctx.strokeStyle = replay.colorOf(id);
        ctx.globalAlpha = isFocus ? 1 : 0.14;
        ctx.lineWidth = isFocus ? 4.5 : 1.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();

        let started = false;
        let headX = 0;
        let headY = 0;
        for (const frame of replay.frames) {
          if (frame.t > until) break;
          if (frame.actors[slot * 4 + 3] === 0) continue;
          const px = offsetX + frame.actors[slot * 4 + 1] * cell;
          const py = offsetY + frame.actors[slot * 4 + 2] * cell;
          if (started) ctx.lineTo(px, py);
          else {
            ctx.moveTo(px, py);
            started = true;
          }
          headX = px;
          headY = py;
        }
        if (!started) {
          ctx.globalAlpha = 1;
          continue;
        }
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.fillStyle = replay.colorOf(id);
        const size = isFocus ? cell * 1.1 : cell * 0.6;
        ctx.fillRect(headX - size / 2, headY - size / 2, size, size);
        if (isFocus) {
          ctx.strokeStyle = 'rgba(8,12,20,0.9)';
          ctx.lineWidth = 2;
          ctx.strokeRect(headX - size / 2, headY - size / 2, size, size);
          labels.push({
            x: headX,
            y: headY,
            text: id === replay.victimActorId ? 'أنت' : (replay.killerName ?? ''),
            color: replay.colorOf(id),
          });
        }
      }
    }

    // نقطة القطع: تنبض كي تلفت العين إلى موضع الحدث بالضبط.
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 180);
    const cx = offsetX + replay.x * cell;
    const cy = offsetY + replay.y * cell;
    ctx.strokeStyle = `rgba(255,107,107,${pulse.toFixed(2)})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(10, cell * 1.6), 0, Math.PI * 2);
    ctx.stroke();

    // الأسماء فوق الرؤوس: من هو أيّ خط، بلا تخمين.
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    for (const label of labels) {
      if (!label.text) continue;
      // الاسم يُقصّ عند الحافة إن تُرك حرًّا، فنحصره داخل اللوحة.
      const half = ctx.measureText(label.text).width / 2 + 4;
      const x = Math.min(width - half, Math.max(half, label.x));
      const y = Math.max(14, label.y - Math.max(10, cell * 1.1));
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(8,12,20,0.9)';
      ctx.strokeText(label.text, x, y);
      ctx.fillStyle = label.color;
      ctx.fillText(label.text, x, y);
    }
  }
}
