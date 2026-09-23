import {
  applyKeyframe,
  buildWorld,
  placeAt,
  reconcileLocal,
  reviveActor,
  unpackActor,
  type Actor,
  type GameEvent,
  type World,
} from '@riqaa/game-core';
import {
  ACTOR_COLORS,
  KILL_REWARD_COINS,
  LINK_GRADE_LABEL,
  gradeLink,
  type MatchConfig,
  type MatchParticipant,
  type DeathCause,
  type MatchState,
  type NetActor,
  type NetRoundResult,
  type RoundOutcome,
} from '@riqaa/shared';
import type { RealtimeClient } from '../net/realtime.js';
import { haptic, onViewportChange, requestLandscape } from '../telegram.js';
import { h } from '../ui/dom.js';
import { Leaderboard, type LeaderRow } from '../ui/leaderboard.js';
import { DeathCam, DeathRecorder, type DeathReplay } from './deathcam.js';
import { EliminationFeed } from './feed.js';
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
  /** نتيجة الخادم الموثوقة في الجولات الجماعية، أو null في الجولة المحلية. */
  server: NetRoundResult | null;
}

/** وصف الجولة كما تحتاجه الشاشة، أيًّا كان مصدره. */
export interface RoundSource {
  matchId: string;
  seed: number;
  config: MatchConfig;
  participants: MatchParticipant[];
  localActorId: number;
  /** null = جولة محلية ضد بوتات على الجهاز. */
  net: RealtimeClient | null;
  state: MatchState;
  startsInMs: number;
}

const HUD_INTERVAL_MS = 100;
const MAX_STEPS_PER_FRAME = 5;
/** فارق الموضع الذي يُصحَّح عنده لاعب بعيد قفزًا. */
const REMOTE_SNAP_CELLS = 4;

/**
 * شاشة اللعب.
 *
 * لها وضعان:
 *  • محلي: المحرك على الجهاز هو المرجع (جولة احتياطية ضد بوتات).
 *  • جماعي: الخادم هو المرجع، والمحرك هنا «مرآة» للرسم فقط — يتحرك بسلاسة
 *    بين اللقطات، ويُصحَّح عند كل لقطة، ويُعاد ضبطه كليًا عند كل إطار مفتاحي.
 *    لا تُحتسب هنا نتيجة ولا عملة ولا إخراج: كلها تصل مؤكَّدة من الخادم.
 */
export class GameScreen {
  private readonly world: World;
  private readonly renderer: Renderer;
  private readonly input: InputController;
  private readonly canvas: HTMLCanvasElement;
  private readonly element: HTMLElement;
  private readonly net: RealtimeClient | null;
  private readonly localActorId: number;

  private readonly areaChip: HTMLElement;
  private readonly rankChip: HTMLElement;
  private readonly timeChip: HTMLElement;
  private readonly coinChip: HTMLElement;
  private readonly coinValue: HTMLElement;
  private readonly pingChip: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly leaderboard = new Leaderboard();
  private readonly feed = new EliminationFeed();
  private readonly recorder: DeathRecorder;
  private readonly deathCam = new DeathCam();
  private readonly leaderRows: LeaderRow[] = [];

  private stopViewportWatch: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly unbind: (() => void)[] = [];
  private coins = 0;

  private readonly eventBuffer: GameEvent[] = [];
  private frameHandle = 0;
  private lastFrame = 0;
  private accumulator = 0;
  private hudClock = 0;
  private startedAt = 0;
  private finished = false;

  private state: MatchState;
  private startsAt = 0;
  private serverElapsed = 0;
  /** لوحة الصدارة الموثوقة — تحلّ محل الترتيب المحلي في الوضع الجماعي. */
  private serverBoard: LeaderRow[] | null = null;
  private serverRank = 1;
  private serverArea = 0;
  private eliminated = false;
  /** true أثناء محاولة العودة بعد انقطاع — يُعرض للاعب ولا يوقف الرسم. */
  private reconnecting = false;
  /** نافذة استقراء الخصوم الحالية بالثواني — تتبع قوة الوصلة. */
  private extrapolationWindow = 0.4;
  /** آخر قطع مسار رُصد — يربط حدث الموت بمن تسبّب فيه في الجولة المحلية. */
  private lastKill: { killerId: number; victimId: number; x: number; y: number } | null = null;
  /**
   * نتيجة وصلت والإعادة ما زالت معروضة.
   * موتُ اللاعب الوحيد ينهي الجولة فورًا، فتصل النتيجة بعد جزء من الثانية
   * وتمسح شاشة الإعادة قبل أن يراها أحد. تُحجز هنا حتى يضغط «متابعة».
   */
  private heldResult: NetRoundResult | null = null;
  private camOpen = false;

  /** لقطة آخر حالة حيّة — لأن الأرض تُحرَّر لحظة الخروج من الجولة. */
  private snapshotArea = 0;
  private snapshotRank = 1;

  constructor(
    private readonly source: RoundSource,
    private readonly onFinish: (summary: RoundSummary) => void,
    private readonly onExit: () => void,
    /** صورة اللاعب من تيليجرام — تظهر في لوحة الصدارة. */
    private readonly avatarUrl: string | null = null,
  ) {
    this.net = source.net;
    this.localActorId = source.localActorId;
    this.state = source.state;
    this.startsAt = performance.now() + source.startsInMs;

    this.world = buildWorld({
      config: source.config,
      seed: source.seed,
      participants: source.participants,
      localActorId: source.localActorId,
      // في الوضع الجماعي هذه نسخة مرآة: لا تقتل ولا تنهي ولا تقرّر شيئًا.
      authoritative: this.net === null,
      endOnHumanDeath: this.net === null,
      networked: this.net !== null,
    });

    this.canvas = h('canvas', { id: 'board' });
    this.areaChip = h('div', { class: 'hud__chip' });
    this.rankChip = h('div', { class: 'hud__chip' });
    this.timeChip = h('div', { class: 'hud__chip' });
    this.pingChip = h('div', { class: 'hud__chip hud__chip--ping' });
    this.coinValue = h('span', { class: 'hud__coin-value', text: '0' });
    this.coinChip = h('div', { class: 'hud__chip hud__chip--coins' }, [
      h('img', { class: 'hud__coin', src: '/game-coin.svg', alt: 'عملات' }),
      this.coinValue,
    ]);
    this.hint = h('div', { class: 'hint', text: 'اسحب إصبعك في أي مكان للتحكم' });
    this.overlay = h('div', { class: 'go' });
    if (this.net) this.pingChip.style.display = '';
    else this.pingChip.style.display = 'none';

    const exitButton = h(
      'button',
      { class: 'hud__exit', type: 'button', 'aria-label': 'خروج', onclick: () => this.quit() },
      ['✕'],
    );

    this.recorder = new DeathRecorder(this.world.engine);

    this.element = h('div', { class: 'screen game' }, [
      this.canvas,
      h('div', { class: 'hud' }, [
        this.areaChip,
        this.rankChip,
        this.timeChip,
        this.coinChip,
        this.pingChip,
        exitButton,
      ]),
      this.leaderboard.element,
      this.feed.element,
      this.hint,
      this.overlay,
      this.deathCam.element,
    ]);

    this.renderer = new Renderer(this.canvas, this.world.engine);
    this.input = new InputController(this.canvas, {
      onIntent: (heading, throttle) => this.pushIntent(heading, throttle),
      onRelease: () => {
        this.world.localController?.release();
        const actor = this.world.local;
        if (actor) this.net?.sendIntent(actor.heading, 1);
      },
    });
  }

  // -------------------------------------------------------------- الدورة

  mount(root: HTMLElement): void {
    root.append(this.element);
    // محاولة أخيرة للعرض إن لم ينجح التسلسل عند الإقلاع أو عند الضغط.
    requestLandscape();

    this.renderer.resize();
    this.input.attach();
    this.stopViewportWatch = onViewportChange(this.onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.renderer.resize());
      this.resizeObserver.observe(this.canvas);
    }

    this.bindNetwork();
    this.updateOverlay();
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
    for (const off of this.unbind) off();
    this.unbind.length = 0;
    this.feed.destroy();
    this.deathCam.destroy();
    // لا نفك القفل: التطبيق كله يعمل بالعرض، لا الجولة وحدها.
    this.element.remove();
  }

  /** خروج اللاعب يدويًا. */
  quit(): void {
    if (this.finished) {
      this.onExit();
      return;
    }
    if (this.net) {
      // الخادم هو من ينهي الجولة ويحسب النتيجة؛ نعلن الانسحاب وننتظر رده.
      this.net.leave();
      this.finishLocal('quit');
      return;
    }
    this.world.engine.end('quit');
  }

  private onResize = (): void => {
    this.renderer.resize();
  };

  private pushIntent(heading: number, throttle: number): void {
    if (this.eliminated) return;
    this.world.localController?.setIntent(heading, throttle);
    this.net?.sendIntent(heading, throttle);
    this.hideHint();
  }

  private frame = (time: number): void => {
    this.frameHandle = requestAnimationFrame(this.frame);

    const engine = this.world.engine;
    const tick = engine.config.tickSeconds;
    const delta = Math.min((time - this.lastFrame) / 1000, 0.25);
    this.lastFrame = time;

    // المرآة لا تتقدّم إلا بعد انطلاق الجولة فعلًا على الخادم.
    if (!this.net || this.state === 'PLAYING') {
      this.accumulator += delta;
      let steps = 0;
      while (this.accumulator >= tick && steps < MAX_STEPS_PER_FRAME) {
        engine.step(tick);
        this.accumulator -= tick;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }

    this.consumeEvents();
    this.recorder.sample(delta);
    this.renderer.draw(this.input.joystick, delta);

    if (time - this.hudClock >= HUD_INTERVAL_MS) {
      this.hudClock = time;
      this.updateHud();
      this.updateOverlay();
    }

    if (!this.net && engine.status === 'ended' && !this.finished) this.finishLocal(null);
  };

  /**
   * أحداث المحرك المحلي.
   * في الوضع الجماعي تُستهلك وتُهمل: المرآة قد ترى أشياء لم يقرّها الخادم،
   * وعرضها يعني إظهار قتلى أو مكاسب لا وجود لها.
   */
  private consumeEvents(): void {
    const engine = this.world.engine;
    if (engine.events.length === 0) return;

    this.eventBuffer.length = 0;
    engine.drainEvents(this.eventBuffer);
    if (this.net) return;

    for (const event of this.eventBuffer) {
      if (event.type === 'capture' && event.actorId === this.localActorId && event.gained > 0) {
        haptic('light');
      } else if (event.type === 'death' && event.actorId === this.localActorId) {
        haptic('error');
        const blame = this.lastKill;
        this.openDeathCam(
          event.cause,
          blame && blame.victimId === this.localActorId ? blame.killerId : null,
          blame?.x ?? this.world.local?.x ?? 0,
          blame?.y ?? this.world.local?.y ?? 0,
        );
      } else if (event.type === 'kill') {
        this.lastKill = { killerId: event.killerId, victimId: event.victimId, x: event.x, y: event.y };
        this.showKill(event.killerId, event.victimId, event.x, event.y);
        if (event.killerId === this.localActorId) this.addCoins(this.coins + KILL_REWARD_COINS);
      }
    }
  }

  // ------------------------------------------------------------- الشبكة

  private bindNetwork(): void {
    const net = this.net;
    if (!net) return;

    this.unbind.push(
      net.on('state', (message) => {
        this.state = message.state;
        this.startsAt = performance.now() + message.startsInMs;
        this.updateOverlay();
      }),
      net.on('snap', (message) => {
        this.serverElapsed = message.elapsed;
        // لو ضاعت رسالة الحالة لأي سبب، وصولُ لقطة بزمن منقضٍ يكفي دليلًا
        // على أن الجولة انطلقت — بلا هذا يتجمّد العدّاد على الشاشة إلى الأبد.
        if (this.state === 'COUNTDOWN' && message.elapsed > 0) {
          this.state = 'PLAYING';
          this.updateOverlay();
        }
        this.applyActors(message.actors, false);
        this.applyBoard(message.lb);
      }),
      net.on('key', (message) => {
        applyKeyframe(this.world.engine, { owner: message.owner, trail: message.trail });
        this.applyActors(message.actors, true);
      }),
      net.on('events', (message) => {
        for (const item of message.items) this.applyEvent(item);
        for (const item of message.feed) this.feed.push(item, this.localActorId);
      }),
      net.on('over', (message) => this.finishFromServer(message.result)),
      net.on('error', (message) => {
        if (message.code === 'disconnected') {
          this.hint.style.opacity = '1';
          this.hint.textContent = 'انقطع الاتصال بالخادم';
        }
      }),
      net.watchLink((state) => {
        this.reconnecting = state === 'reconnecting';
        if (state === 'reconnecting') {
          this.hint.style.opacity = '1';
          this.hint.textContent = 'انقطع الاتصال — جارٍ العودة…';
        } else if (state === 'live' && this.hint.textContent?.includes('العودة')) {
          this.hint.textContent = 'عادت الجولة';
          this.hideHintSoon();
        }
      }),
      net.on('room', () => {
        // عودة بعد انقطاع: الإطار المفتاحي التالي يعيد بناء الأرض كاملة.
        this.hint.textContent = 'عادت الجولة';
        this.hideHintSoon();
      }),
    );
  }

  /** يطبّق لقطة المشاركين: تصحيح للمحلي، وقيادة للبعيدين. */
  private applyActors(actors: readonly NetActor[], hard: boolean): void {
    const engine = this.world.engine;
    const now = Date.now();

    // كلما ضعفت الوصلة تباعدت اللقطات، فتتّسع نافذة استقراء الخصوم بقدرها.
    const rtt = this.net?.pingMs ?? 0;
    const window = 0.15 + rtt / 1000;
    if (Math.abs(window - this.extrapolationWindow) > 0.05) {
      this.extrapolationWindow = window;
      for (const remote of this.world.remotes.values()) remote.setWindow(window);
    }

    for (const packed of actors) {
      const state = unpackActor(packed);
      const actor = engine.actorById(state.id);
      if (!actor) continue;

      if (!state.alive) {
        if (actor.alive) engine.applyDeath(actor.id, 'trail');
        continue;
      }
      if (!actor.alive) reviveActor(engine, actor, state);

      if (actor.id === this.localActorId) {
        this.serverArea = state.areaPercent;
        // مطابقة واعية بزمن الشبكة: اللقطة تصف ماضيًا، فمقارنتها بالحاضر
        // كما هي تخترع خطأً ليس موجودًا وتسحب اللاعب للخلف.
        reconcileLocal(actor, state, {
          speed: engine.config.speedCellsPerSecond,
          latencyMs: this.net?.pingMs ?? 0,
          // الإطار المفتاحي حقيقة كاملة: نشدّ إليه أقوى.
          deadZone: hard ? 0.4 : undefined,
          blend: hard ? 0.5 : undefined,
        });
        continue;
      }

      const drift = Math.hypot(state.x - actor.x, state.y - actor.y);
      if (hard || drift > REMOTE_SNAP_CELLS) placeAt(actor, state.x, state.y, state.heading);
      this.world.remotes.get(actor.id)?.setTarget(state.x, state.y, state.heading, 1, now);
    }
  }

  private applyEvent(event: { e: string } & Record<string, unknown>): void {
    switch (event.e) {
      case 'kill':
        this.showKill(
          Number(event.killerActorId),
          Number(event.victimActorId),
          Number(event.x),
          Number(event.y),
        );
        return;
      case 'death': {
        const actorId = Number(event.actorId);
        const cause = (event.cause as DeathCause) ?? 'trail';
        this.world.engine.applyDeath(actorId, cause);
        if (actorId === this.localActorId) {
          this.eliminated = true;
          haptic('error');
          this.hint.style.opacity = '1';
          this.hint.textContent = 'خرجت من الجولة — بانتظار النتيجة';
          // الحكم من الخادم، والصورة من تسجيل الجهاز.
          this.openDeathCam(
            cause,
            event.killerActorId === null ? null : Number(event.killerActorId),
            Number(event.x),
            Number(event.y),
          );
        }
        return;
      }
      case 'capture':
        if (Number(event.actorId) === this.localActorId) haptic('light');
        return;
      case 'coins':
        // الرصيد يصل مؤكَّدًا من الخادم، ولا يُجمع محليًا أبدًا.
        this.addCoins(Number(event.total));
        haptic('medium');
        return;
      default:
        return;
    }
  }

  private applyBoard(rows: readonly { actorId: number; name: string; colorIndex: number; areaPercent: number; eliminated: boolean; avatarUrl: string | null }[]): void {
    const board: LeaderRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const isHuman = row.actorId === this.localActorId;
      if (isHuman) {
        this.serverRank = i + 1;
        this.serverArea = row.areaPercent;
      }
      board.push({
        rank: i + 1,
        name: row.name,
        area: row.areaPercent,
        color: ACTOR_COLORS[row.colorIndex % ACTOR_COLORS.length],
        isHuman,
        eliminated: row.eliminated,
        avatarUrl: isHuman ? this.avatarUrl : row.avatarUrl,
      });
    }
    this.serverBoard = board;
  }

  // -------------------------------------------------------------- العرض

  /** يعرض للاعب كيف خرج من الجولة: آخر ثوانٍ مبطّأةً حول نقطة الحدث. */
  private openDeathCam(cause: DeathCause, killerActorId: number | null, x: number, y: number): void {
    const engine = this.world.engine;
    const frames = this.recorder.snapshot();
    if (frames.length < 2) return;

    const killer = killerActorId === null ? null : engine.actorById(killerActorId);
    const replay: DeathReplay = {
      victimActorId: this.localActorId,
      killerActorId: killer ? killer.id : null,
      victimName: engine.actorById(this.localActorId)?.name ?? 'أنت',
      killerName: killer ? killer.name : null,
      cause,
      x,
      y,
      frames,
      colorOf: (id) => ACTOR_COLORS[(engine.actorById(id)?.colorIndex ?? 0) % ACTOR_COLORS.length],
    };
    this.camOpen = true;
    this.deathCam.show(replay, () => {
      this.camOpen = false;
      this.hint.textContent = this.net ? 'خرجت من الجولة — بانتظار النتيجة' : 'انتهت جولتك';
      const held = this.heldResult;
      this.heldResult = null;
      if (held) this.finishFromServer(held);
      else if (!this.net && this.world.engine.status === 'ended') this.finishLocal(null);
    });
  }

  private showKill(killerId: number, victimId: number, x: number, y: number): void {
    const victim = this.world.engine.actorById(victimId);
    const color = ACTOR_COLORS[(victim?.colorIndex ?? 0) % ACTOR_COLORS.length];
    this.renderer.effects.spawnKill(x, y, color, KILL_REWARD_COINS, killerId === this.localActorId);
  }

  private addCoins(total: number): void {
    this.coins = total;
    this.coinValue.textContent = String(total);
    this.coinChip.classList.remove('hud__chip--pop');
    void this.coinChip.offsetWidth; // إعادة تشغيل الحركة
    this.coinChip.classList.add('hud__chip--pop');
  }

  private updateOverlay(): void {
    if (!this.net) return;
    if (this.state === 'COUNTDOWN') {
      const remaining = Math.max(0, this.startsAt - performance.now());
      const seconds = Math.ceil(remaining / 1000);
      this.overlay.textContent = seconds > 0 ? String(seconds) : 'ابدأ!';
      this.overlay.style.display = '';
      return;
    }
    if (this.overlay.style.display !== 'none') {
      this.overlay.textContent = '';
      this.overlay.style.display = 'none';
    }
  }

  private updateHud(): void {
    const engine = this.world.engine;
    const local = this.world.local;

    if (this.net) {
      this.snapshotArea = this.serverArea;
      this.snapshotRank = this.serverRank;
      this.pingChip.textContent = '';
      const grade = gradeLink(this.net.pingMs);
      this.pingChip.classList.toggle('hud__chip--down', this.reconnecting || grade === 'weak');
      setChip(
        this.pingChip,
        this.reconnecting ? 'الاتصال' : LINK_GRADE_LABEL[grade],
        this.reconnecting ? 'يعود…' : this.net.pingMs > 0 ? `${this.net.pingMs}م.ث` : '…',
      );
    } else if (local?.alive) {
      this.snapshotArea = engine.areaPercent(local);
      this.snapshotRank = engine.rankOf(local);
    }

    setChip(this.areaChip, 'المساحة', `${this.snapshotArea.toFixed(2)}٪`);
    setChip(this.rankChip, 'المركز', `${this.snapshotRank} / ${engine.actors.length}`);
    this.updateLeaderboard();

    // لا مؤقّت ينتهي: الجولة تنتهي بالسيطرة أو بالخروج، فالعدّاد يصعد
    // ليقول للاعب كم صمد لا كم بقي له.
    const total = engine.config.roundSeconds;
    const elapsed = this.net ? this.serverElapsed : engine.elapsed;
    const shown = total > 0 ? Math.max(0, total - elapsed) : elapsed;
    const minutes = Math.floor(shown / 60);
    const seconds = Math.floor(shown % 60);
    setChip(
      this.timeChip,
      total > 0 ? 'الوقت' : 'صمدت',
      `${minutes}:${String(seconds).padStart(2, '0')}`,
    );
  }

  /** الصدارة: من الخادم في الجولة الجماعية، ومن المحرك في الجولة المحلية. */
  private updateLeaderboard(): void {
    if (this.serverBoard) {
      this.leaderboard.update(this.serverBoard);
      return;
    }
    const engine = this.world.engine;
    const ranked = engine.ranking();

    this.leaderRows.length = 0;
    for (let i = 0; i < ranked.length; i++) {
      const actor = ranked[i];
      const isHuman = actor.id === this.localActorId;
      this.leaderRows.push({
        rank: i + 1,
        name: actor.name,
        area: engine.areaPercent(actor),
        color: ACTOR_COLORS[actor.colorIndex % ACTOR_COLORS.length],
        isHuman,
        eliminated: !actor.alive,
        avatarUrl: isHuman ? this.avatarUrl : null,
      });
    }
    this.leaderboard.update(this.leaderRows);
  }

  private hideHint(): void {
    if (this.hint.style.opacity === '0') return;
    this.hint.style.opacity = '0';
  }

  private hideHintSoon(): void {
    window.setTimeout(() => this.hideHint(), 1500);
  }

  // ------------------------------------------------------------- النهاية

  /** نتيجة الخادم: هي المصدر الوحيد للترتيب والمساحة والعملات. */
  private finishFromServer(result: NetRoundResult): void {
    if (this.finished) return;
    // الإعادة معروضة: نحتفظ بالنتيجة ونعرضها حين يفرغ اللاعب منها.
    if (this.camOpen) {
      this.heldResult = result;
      return;
    }
    this.finished = true;
    this.onFinish({
      matchId: result.matchId,
      areaPercent: result.areaPercent,
      rank: result.rank,
      participants: result.participants,
      durationMs: Math.round(performance.now() - this.startedAt),
      outcome: result.outcome,
      coins: result.coins,
      server: result,
    });
  }

  private finishLocal(forced: RoundOutcome | null): void {
    if (this.finished || this.camOpen) return;
    this.finished = true;
    const engine = this.world.engine;
    const local: Actor | null = this.world.local;
    if (local?.alive && !this.net) {
      this.snapshotArea = engine.areaPercent(local);
      this.snapshotRank = engine.rankOf(local);
    }

    this.onFinish({
      matchId: this.source.matchId,
      areaPercent: Number(this.snapshotArea.toFixed(2)),
      rank: this.snapshotRank,
      participants: engine.actors.length,
      durationMs: Math.round(performance.now() - this.startedAt),
      outcome: forced ?? toOutcome(engine.endReason),
      coins: this.coins,
      server: null,
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
