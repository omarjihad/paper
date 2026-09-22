import { createMatch, type Actor, type GameEvent, type Match } from '@riqaa/game-core';
import type { MatchStartResponse, RoundOutcome } from '@riqaa/shared';
import { haptic } from '../telegram.js';
import { h } from '../ui/dom.js';
import { InputController } from './input.js';
import { Renderer } from './renderer.js';

export interface RoundSummary {
  matchId: string;
  areaPercent: number;
  rank: number;
  participants: number;
  durationMs: number;
  outcome: RoundOutcome;
}

const HUD_INTERVAL_MS = 100;
const MAX_STEPS_PER_FRAME = 5;

/**
 * شاشة اللعب: تربط المحرك بالرسم والإدخال.
 * المحاكاة بخطوة ثابتة مستقلة عن معدل الإطارات، والرسم يتبع.
 */
export class GameScreen {
  private readonly match: Match;
  private readonly renderer: Renderer;
  private readonly input: InputController;
  private readonly canvas: HTMLCanvasElement;
  private readonly element: HTMLElement;

  private readonly areaChip: HTMLElement;
  private readonly rankChip: HTMLElement;
  private readonly timeChip: HTMLElement;
  private readonly hint: HTMLElement;

  private readonly eventBuffer: GameEvent[] = [];
  private frameHandle = 0;
  private lastFrame = 0;
  private accumulator = 0;
  private hudClock = 0;
  private startedAt = 0;
  private finished = false;

  /** لقطة آخر حالة حيّة — لأن الأرض تُحرَّر لحظة الخروج من الجولة. */
  private snapshotArea = 0;
  private snapshotRank = 1;

  constructor(
    private readonly descriptor: MatchStartResponse,
    private readonly onFinish: (summary: RoundSummary) => void,
    private readonly onExit: () => void,
  ) {
    this.match = createMatch(descriptor);

    this.canvas = h('canvas', { id: 'board' });
    this.areaChip = h('div', { class: 'hud__chip' });
    this.rankChip = h('div', { class: 'hud__chip' });
    this.timeChip = h('div', { class: 'hud__chip' });
    this.hint = h('div', { class: 'hint', text: 'اسحب إصبعك في أي مكان للتحكم' });

    const exitButton = h(
      'button',
      { class: 'hud__exit', type: 'button', 'aria-label': 'خروج', onclick: () => this.quit() },
      ['✕'],
    );

    this.element = h('div', { class: 'screen game' }, [
      this.canvas,
      h('div', { class: 'hud' }, [this.areaChip, this.rankChip, this.timeChip, exitButton]),
      this.hint,
    ]);

    this.renderer = new Renderer(this.canvas, this.match.engine);
    this.input = new InputController(this.canvas, {
      onIntent: (heading, throttle) => {
        this.match.humanController.setIntent(heading, throttle);
        this.hideHint();
      },
      onRelease: () => this.match.humanController.release(),
    });
  }

  mount(root: HTMLElement): void {
    root.append(this.element);
    this.renderer.resize();
    this.input.attach();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);

    this.updateHud();
    this.startedAt = performance.now();
    this.lastFrame = this.startedAt;
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.frameHandle);
    this.input.detach();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    this.element.remove();
  }

  /** خروج اللاعب يدويًا: ينهي الجولة بنفس مسار النتيجة. */
  quit(): void {
    if (this.finished) {
      this.onExit();
      return;
    }
    this.match.engine.end('quit');
  }

  private onResize = (): void => {
    this.renderer.resize();
  };

  private frame = (time: number): void => {
    this.frameHandle = requestAnimationFrame(this.frame);

    const engine = this.match.engine;
    const tick = engine.config.tickSeconds;
    const delta = Math.min((time - this.lastFrame) / 1000, 0.25);
    this.lastFrame = time;
    this.accumulator += delta;

    let steps = 0;
    while (this.accumulator >= tick && steps < MAX_STEPS_PER_FRAME) {
      engine.step(tick);
      this.accumulator -= tick;
      steps++;
    }
    // تأخّر شديد (عودة من الخلفية مثلًا): نتجاهل الفارق بدل محاولة اللحاق.
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    this.consumeEvents();
    this.renderer.draw(this.input.joystick);

    if (time - this.hudClock >= HUD_INTERVAL_MS) {
      this.hudClock = time;
      this.updateHud();
    }

    if (engine.status === 'ended' && !this.finished) this.finish();
  };

  private consumeEvents(): void {
    const engine = this.match.engine;
    if (engine.events.length === 0) return;

    this.eventBuffer.length = 0;
    engine.drainEvents(this.eventBuffer);

    for (const event of this.eventBuffer) {
      if (event.type === 'capture' && event.actorId === this.match.human.id && event.gained > 0) {
        haptic('light');
      } else if (event.type === 'death' && event.actorId === this.match.human.id) {
        haptic('error');
      }
    }
  }

  private updateHud(): void {
    const engine = this.match.engine;
    const human = this.match.human;

    if (human.alive) {
      this.snapshotArea = engine.areaPercent(human);
      this.snapshotRank = engine.rankOf(human);
    }

    setChip(this.areaChip, 'المساحة', `${this.snapshotArea.toFixed(2)}٪`);
    setChip(this.rankChip, 'المركز', `${this.snapshotRank} / ${engine.actors.length}`);

    const total = engine.config.roundSeconds;
    if (total > 0) {
      const remaining = Math.max(0, total - engine.elapsed);
      const minutes = Math.floor(remaining / 60);
      const seconds = Math.floor(remaining % 60);
      setChip(this.timeChip, 'الوقت', `${minutes}:${String(seconds).padStart(2, '0')}`);
    } else {
      this.timeChip.style.display = 'none';
    }
  }

  private hideHint(): void {
    if (this.hint.style.opacity === '0') return;
    this.hint.style.opacity = '0';
  }

  private finish(): void {
    this.finished = true;
    const engine = this.match.engine;
    const human: Actor = this.match.human;
    if (human.alive) {
      this.snapshotArea = engine.areaPercent(human);
      this.snapshotRank = engine.rankOf(human);
    }

    this.onFinish({
      matchId: this.descriptor.matchId,
      areaPercent: Number(this.snapshotArea.toFixed(2)),
      rank: this.snapshotRank,
      participants: engine.actors.length,
      durationMs: Math.round(performance.now() - this.startedAt),
      outcome: toOutcome(engine.endReason),
    });
  }
}

function toOutcome(reason: string | null): RoundOutcome {
  switch (reason) {
    case 'eliminated':
      return 'eliminated';
    case 'timeup':
      return 'timeup';
    case 'lastStanding':
      return 'survived';
    default:
      return 'quit';
  }
}

function setChip(chip: HTMLElement, label: string, value: string): void {
  chip.textContent = value;
  chip.prepend(h('span', { text: label }));
}
