import { createMatch, type Actor, type GameEvent, type Match } from '@riqaa/game-core';
import { ACTOR_COLORS, KILL_REWARD_COINS, type MatchStartResponse, type RoundOutcome } from '@riqaa/shared';
import { enterLandscapeMode, exitLandscapeMode, haptic, onViewportChange } from '../telegram.js';
import { h } from '../ui/dom.js';
import { Leaderboard, type LeaderRow } from '../ui/leaderboard.js';
import { InputController } from './input.js';
import { Renderer } from './renderer.js';

export interface RoundSummary {
  matchId: string;
  areaPercent: number;
  rank: number;
  participants: number;
  durationMs: number;
  outcome: RoundOutcome;
  /** عملات هذه الجولة (من الإخراجات فقط). */
  coins: number;
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
  private readonly coinChip: HTMLElement;
  private readonly coinValue: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly leaderboard = new Leaderboard();
  private readonly leaderRows: LeaderRow[] = [];
  private stopViewportWatch: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private coins = 0;

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
    /** صورة اللاعب من تيليجرام — تظهر في لوحة الصدارة. */
    private readonly avatarUrl: string | null = null,
  ) {
    this.match = createMatch(descriptor);

    this.canvas = h('canvas', { id: 'board' });
    this.areaChip = h('div', { class: 'hud__chip' });
    this.rankChip = h('div', { class: 'hud__chip' });
    this.timeChip = h('div', { class: 'hud__chip' });
    this.coinValue = h('span', { class: 'hud__coin-value', text: '0' });
    this.coinChip = h('div', { class: 'hud__chip hud__chip--coins' }, [
      h('img', { class: 'hud__coin', src: '/game-coin.svg', alt: 'عملات' }),
      this.coinValue,
    ]);
    this.hint = h('div', { class: 'hint', text: 'اسحب إصبعك في أي مكان للتحكم' });

    const exitButton = h(
      'button',
      { class: 'hud__exit', type: 'button', 'aria-label': 'خروج', onclick: () => this.quit() },
      ['✕'],
    );

    this.element = h('div', { class: 'screen game' }, [
      this.canvas,
      h('div', { class: 'hud' }, [
        this.areaChip,
        this.rankChip,
        this.timeChip,
        this.coinChip,
        exitButton,
      ]),
      this.leaderboard.element,
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
    // اللعب بالعرض: ملء الشاشة وقفل الاتجاه إن كان العميل يدعمهما.
    enterLandscapeMode();

    this.renderer.resize();
    this.input.attach();
    this.stopViewportWatch = onViewportChange(this.onResize);
    // يلتقط أي تغيّر فعلي في أبعاد اللوحة مهما كان مصدره.
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.renderer.resize());
      this.resizeObserver.observe(this.canvas);
    }

    this.updateHud();
    this.startedAt = performance.now();
    this.lastFrame = this.startedAt;
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.frameHandle);
    this.input.detach();
    this.stopViewportWatch?.();
    this.stopViewportWatch = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    exitLandscapeMode();
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
    this.renderer.draw(this.input.joystick, delta);

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

    const humanId = this.match.human.id;
    for (const event of this.eventBuffer) {
      if (event.type === 'capture' && event.actorId === humanId && event.gained > 0) {
        haptic('light');
      } else if (event.type === 'death' && event.actorId === humanId) {
        haptic('error');
      } else if (event.type === 'kill') {
        const victim = engine.actorById(event.victimId);
        const color = ACTOR_COLORS[(victim?.colorIndex ?? 0) % ACTOR_COLORS.length];
        const byPlayer = event.killerId === humanId;
        if (byPlayer) {
          this.coins += KILL_REWARD_COINS;
          this.coinValue.textContent = String(this.coins);
          this.coinChip.classList.remove('hud__chip--pop');
          void this.coinChip.offsetWidth; // إعادة تشغيل الحركة
          this.coinChip.classList.add('hud__chip--pop');
          haptic('medium');
        }
        this.renderer.effects.spawnKill(event.x, event.y, color, KILL_REWARD_COINS, byPlayer);
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
    this.updateLeaderboard();

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

  /** يبني صفوف الصدارة من ترتيب الجولة الحالي. */
  private updateLeaderboard(): void {
    const engine = this.match.engine;
    const humanId = this.match.human.id;
    const ranked = engine.ranking();

    this.leaderRows.length = 0;
    for (let i = 0; i < ranked.length; i++) {
      const actor = ranked[i];
      const isHuman = actor.id === humanId;
      this.leaderRows.push({
        rank: i + 1,
        name: actor.name,
        area: engine.areaPercent(actor),
        color: ACTOR_COLORS[actor.colorIndex % ACTOR_COLORS.length],
        isHuman,
        avatarUrl: isHuman ? this.avatarUrl : null,
      });
    }
    this.leaderboard.update(this.leaderRows);
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
      coins: this.coins,
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
