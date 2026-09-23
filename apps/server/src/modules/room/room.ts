import { randomUUID } from 'node:crypto';
import {
  ACTOR_COLORS,
  DEFAULT_MATCH_CONFIG,
  KILL_REWARD_COINS,
  MULTIPLAYER,
  type MatchParticipant,
  type MatchState,
  type NetEvent,
  type NetFeedItem,
  type NetLeaderEntry,
  type NetRoundResult,
  type RegionId,
  type RoomDescriptor,
  type RoundOutcome,
  type ServerMessage,
} from '@riqaa/shared';
import { buildWorld, encodeKeyframe, packActor, type World } from '@riqaa/game-core';
import type { GameEvent } from '@riqaa/game-core';

/** وصلة عميل واحد — مجرّدة عن مكتبة WebSocket كي تبقى الغرفة قابلة للاختبار. */
export interface ClientLink {
  send(message: ServerMessage): void;
  /** إرسال نص مُجهَّز مسبقًا — الرسالة الواحدة تُحوَّل مرة لا مرة لكل لاعب. */
  sendRaw(text: string): void;
  /**
   * زمن الذهاب والإياب كما يقيسه الخادم بنفسه من نبضات WebSocket.
   * لا نسأل العميل عنه: القياس هنا لا يُزوَّر، ويُبنى عليه قرار التخفيف.
   */
  rttMs(): number;
  /** هل تكدّس في مخزن الإرسال ما يكفي ليعني أن الوصلة لا تلحق؟ */
  saturated(): boolean;
  close(code: string, reason: string): void;
}

/**
 * لاعب داخل الغرفة.
 * كل حقل هنا اشتقّه الخادم من جلسة موقَّعة أو من المحاكاة — لا شيء منه
 * يأتي من رسائل العميل. العميل لا يرسل إلا زاوية ونسبة سرعة.
 */
export interface RoomPlayer {
  playerId: string;
  actorId: number;
  name: string;
  avatarUrl: string | null;
  link: ClientLink | null;
  disconnectedAt: number;
  coins: number;
  kills: number;
  eliminated: boolean;
  /** آخر إدخال مقبول — يُطبَّق على وحدة تحكّم المحرك عند كل خطوة. */
  reported: boolean;
  /** عدّاد تخفيف اللقطات: يتخطّى بعضها على الوصلات الضعيفة. */
  snapshotSkip: number;
}

export interface RoomSeat {
  playerId: string;
  name: string;
  avatarUrl: string | null;
  link: ClientLink;
}

export interface RoomHooks {
  /** يُستدعى مرة واحدة لكل لاعب بشري عند انتهاء جولته. */
  onPlayerResult(playerId: string, areaPercent: number): Promise<{ bestAreaPercent: number; rounds: number }>;
  onClosed(room: Room): void;
  log(message: string): void;
}

const SNAPSHOT_INTERVAL_MS = 1000 / MULTIPLAYER.SNAPSHOT_HZ;
const KEYFRAME_INTERVAL_MS = 1000 / MULTIPLAYER.KEYFRAME_HZ;
/** مهلة بقاء الغرفة بعد انتهائها قبل إزالتها. */
const LINGER_MS = 15000;

/**
 * غرفة واحدة: عالم مستقل تمامًا بمعرّفه وبمشاركيه وبمؤقّته ولوحة صدارته.
 * عدة غرف تعمل في اللحظة نفسها بلا أي حالة مشتركة بينها سوى المؤقّت العام.
 */
export class Room {
  readonly id = randomUUID();
  readonly seed = (Math.random() * 0xffffffff) >>> 0;
  readonly config = DEFAULT_MATCH_CONFIG;
  readonly createdAt = Date.now();

  state: MatchState = 'WAITING';
  private stateSince = Date.now();
  private world: World;
  private readonly participants: MatchParticipant[] = [];
  private readonly players = new Map<string, RoomPlayer>();
  private readonly byActor = new Map<number, RoomPlayer>();

  private tickAccumulator = 0;
  private snapshotClock = 0;
  private keyframeClock = 0;
  private tickCount = 0;
  private closedAt = 0;
  private readonly eventBuffer: GameEvent[] = [];

  constructor(
    readonly region: RegionId,
    seats: readonly RoomSeat[],
    private readonly hooks: RoomHooks,
  ) {
    let actorId = 1;
    for (const seat of seats) {
      this.participants.push({
        kind: 'human',
        actorId,
        name: seat.name,
        colorIndex: (actorId - 1) % ACTOR_COLORS.length,
        avatarUrl: seat.avatarUrl,
      });
      const player: RoomPlayer = {
        playerId: seat.playerId,
        actorId,
        name: seat.name,
        avatarUrl: seat.avatarUrl,
        link: seat.link,
        disconnectedAt: 0,
        coins: 0,
        kills: 0,
        eliminated: false,
        reported: false,
        snapshotSkip: 0,
      };
      this.players.set(seat.playerId, player);
      this.byActor.set(actorId, player);
      actorId++;
    }

    if (MULTIPLAYER.BOT_FILL_ENABLED) {
      let botNumber = 1;
      while (this.participants.length < MULTIPLAYER.MAX_PLAYERS_PER_ROOM) {
        this.participants.push(makeBot(actorId, botNumber));
        actorId++;
        botNumber++;
      }
    }

    this.world = buildWorld({
      config: this.config,
      seed: this.seed,
      participants: this.participants,
      // الخادم هو المرجع، وموت لاعب لا ينهي الغرفة بل يُخرجه منها وحده.
      authoritative: true,
      endOnHumanDeath: false,
    });

    this.setState('COUNTDOWN');
  }

  // ------------------------------------------------------------ الاستعلام

  get humanCount(): number {
    return this.players.size;
  }

  get playerIds(): string[] {
    return [...this.players.keys()];
  }

  get finished(): boolean {
    return this.state === 'FINISHED';
  }

  get expired(): boolean {
    return this.closedAt > 0 && Date.now() - this.closedAt > LINGER_MS;
  }

  has(playerId: string): boolean {
    return this.players.has(playerId);
  }

  descriptorFor(playerId: string): RoomDescriptor | null {
    const player = this.players.get(playerId);
    if (!player) return null;
    return {
      roomId: this.id,
      region: this.region,
      seed: this.seed,
      config: this.config,
      participants: this.participants,
      youActorId: player.actorId,
      state: this.state,
      startsInMs: this.startsInMs(),
      humans: this.players.size,
    };
  }

  private startsInMs(): number {
    if (this.state !== 'COUNTDOWN') return 0;
    return Math.max(0, MULTIPLAYER.COUNTDOWN_MS - (Date.now() - this.stateSince));
  }

  // ------------------------------------------------------------- الاتصال

  /** إدخال اللاعب: زاوية ونسبة سرعة فقط، ويُرفض بعد خروجه من الجولة. */
  applyInput(playerId: string, heading: number, throttle: number): void {
    const player = this.players.get(playerId);
    if (!player || player.eliminated || this.state !== 'PLAYING') return;
    if (!Number.isFinite(heading) || !Number.isFinite(throttle)) return;
    const controller = this.world.humans.get(player.actorId);
    controller?.setIntent(heading, clamp01(throttle));
  }

  attach(playerId: string, link: ClientLink): RoomDescriptor | null {
    const player = this.players.get(playerId);
    if (!player) return null;
    player.link = link;
    player.disconnectedAt = 0;
    const descriptor = this.descriptorFor(playerId);
    if (descriptor) {
      link.send({ t: 'room', room: descriptor });
      this.sendKeyframe(player);
    }
    return descriptor;
  }

  detach(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.link = null;
    player.disconnectedAt = Date.now();
    this.hooks.log(`انقطع ${shortId(playerId)} عن الغرفة ${shortId(this.id)} — مهلة العودة ${MULTIPLAYER.RECONNECT_GRACE_MS}ms`);
  }

  /**
   * خروج نهائي بطلب اللاعب.
   * الوصلة تبقى مفتوحة عمدًا: من ينسحب يستحق أن تصله نتيجة جولته،
   * وإغلاقها هنا يعني أن رسالة النتيجة تُرسل إلى العدم.
   */
  leave(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    this.eliminate(player);
  }

  // -------------------------------------------------------------- الدورة

  /** خطوة زمنية واحدة للغرفة. `deltaMs` هو الزمن الحقيقي المنقضي. */
  tick(deltaMs: number): void {
    switch (this.state) {
      case 'COUNTDOWN':
        if (Date.now() - this.stateSince >= MULTIPLAYER.COUNTDOWN_MS) this.setState('PLAYING');
        return;
      case 'PLAYING':
        this.simulate(deltaMs);
        return;
      default:
        return;
    }
  }

  private simulate(deltaMs: number): void {
    const engine = this.world.engine;
    const tick = this.config.tickSeconds;
    this.tickAccumulator += Math.min(deltaMs, 250) / 1000;

    let steps = 0;
    while (this.tickAccumulator >= tick && steps < 8) {
      engine.step(tick);
      this.tickAccumulator -= tick;
      this.tickCount++;
      steps++;
    }
    if (steps === 8) this.tickAccumulator = 0;

    this.dispatchEvents();
    this.expireDisconnected();

    this.snapshotClock += deltaMs;
    if (this.snapshotClock >= SNAPSHOT_INTERVAL_MS) {
      this.snapshotClock = 0;
      this.broadcastSnapshot();
    }
    this.keyframeClock += deltaMs;
    if (this.keyframeClock >= KEYFRAME_INTERVAL_MS) {
      this.keyframeClock = 0;
      this.broadcastKeyframe();
    }

    if (engine.status === 'ended' || this.roundOver()) this.setState('FINISHED');
  }

  /** الجولة تنتهي حين لا يبقى بشر فاعلون، أو حين يبقى مشارك واحد فقط. */
  private roundOver(): boolean {
    let activeHumans = 0;
    for (const player of this.players.values()) {
      if (!player.eliminated) activeHumans++;
    }
    if (activeHumans === 0) return true;

    // البوت الميت الذي له موعد عودة ليس خارجًا من الجولة.
    // عدُّه خارجًا كان ينهي الجولة بعد ثوانٍ من بدايتها: استحواذٌ واسع مبكّر
    // يمحو أرض عدة بوتات دفعةً واحدة، فيبقى اللاعب وحده «واقفًا» لثوانٍ
    // حتى تحين عودتهم — فتُعلَن نهاية الجولة بلا سبب يراه اللاعب.
    let standing = 0;
    for (const actor of this.world.engine.actors) {
      if (actor.alive || actor.respawnAt >= 0) standing++;
    }
    return standing <= 1;
  }

  /**
   * ترجمة أحداث المحرك إلى أحداث شبكة.
   * كل ما يراه اللاعب من نتائج يمر من هنا — المكافأة لا تُمنح إلا بعد أن
   * يؤكّد المحرك الموثوق وقوع الإخراج.
   */
  private dispatchEvents(): void {
    const engine = this.world.engine;
    if (engine.events.length === 0) return;

    this.eventBuffer.length = 0;
    engine.drainEvents(this.eventBuffer);

    const items: NetEvent[] = [];
    const feed: NetFeedItem[] = [];
    const coinUpdates = new Set<RoomPlayer>();
    /** من أخرج مَن في هذه الدفعة — المحرك يصدر القطع قبل الموت مباشرة. */
    const killedBy = new Map<number, { killerId: number; x: number; y: number }>();

    for (const event of this.eventBuffer) {
      if (event.type === 'kill') {
        killedBy.set(event.victimId, { killerId: event.killerId, x: event.x, y: event.y });
        items.push({
          e: 'kill',
          killerActorId: event.killerId,
          victimActorId: event.victimId,
          x: event.x,
          y: event.y,
        });
        feed.push({
          k: 'kill',
          killer: this.nameOf(event.killerId),
          victim: this.nameOf(event.victimId),
          killerActorId: event.killerId,
          victimActorId: event.victimId,
        });
        const killer = this.byActor.get(event.killerId);
        if (killer) {
          killer.kills++;
          killer.coins += KILL_REWARD_COINS;
          coinUpdates.add(killer);
        }
      } else if (event.type === 'death') {
        const victim = this.byActor.get(event.actorId);
        if (victim && !victim.eliminated) {
          victim.eliminated = true;
          feed.push({ k: 'out', victim: victim.name, victimActorId: victim.actorId });
        }
        // من أخرجه ولماذا وأين: بلا هذه الثلاثة لا يعرف اللاعب إن ظُلم أم أخطأ.
        const blame = killedBy.get(event.actorId);
        items.push({
          e: 'death',
          actorId: event.actorId,
          eliminated: Boolean(victim),
          cause: event.cause,
          killerActorId: blame?.killerId ?? null,
          x: blame?.x ?? this.world.engine.actorById(event.actorId)?.x ?? 0,
          y: blame?.y ?? this.world.engine.actorById(event.actorId)?.y ?? 0,
        });
      } else if (event.type === 'respawn') {
        items.push({ e: 'respawn', actorId: event.actorId });
      } else if (event.type === 'capture' && event.gained > 0) {
        items.push({ e: 'capture', actorId: event.actorId, gained: event.gained });
      }
    }

    if (items.length > 0 || feed.length > 0) {
      this.broadcast({ t: 'events', items, feed });
    }
    // رصيد العملات يخص صاحبه وحده.
    for (const player of coinUpdates) {
      player.link?.send({
        t: 'events',
        items: [{ e: 'coins', total: player.coins, gained: KILL_REWARD_COINS }],
        feed: [],
      });
    }
  }

  private nameOf(actorId: number): string {
    return this.world.engine.actorById(actorId)?.name ?? 'مشارك';
  }

  /** انتهاء مهلة العودة يعني إخراج اللاعب من الغرفة فعليًا. */
  private expireDisconnected(): void {
    const now = Date.now();
    for (const player of this.players.values()) {
      if (player.link || player.eliminated || player.disconnectedAt === 0) continue;
      if (now - player.disconnectedAt < MULTIPLAYER.RECONNECT_GRACE_MS) continue;
      this.hooks.log(`انتهت مهلة عودة ${shortId(player.playerId)} — أُخرج من الغرفة ${shortId(this.id)}`);
      this.eliminate(player);
    }
  }

  /**
   * إخراج لاعب من الجولة.
   * لا نضع علامة الخروج هنا بل ندع حدث الموت يضعها، كي يمر الخروج بالمسار
   * نفسه دائمًا: حدث للجميع، سطر في الشريط، وتحديث للوحة الصدارة.
   */
  private eliminate(player: RoomPlayer): void {
    if (player.eliminated) return;
    const actor = this.world.engine.actorById(player.actorId);
    if (actor?.alive) this.world.engine.applyDeath(player.actorId, 'trail');
    else player.eliminated = true;

    // قد يقع الخروج خارج دورة المحاكاة (انسحاب أثناء العد التنازلي مثلًا).
    this.dispatchEvents();
    if (this.state !== 'FINISHED' && this.roundOver()) this.setState('FINISHED');
  }

  // --------------------------------------------------------------- البث

  private setState(next: MatchState): void {
    if (this.state === next) return;
    this.state = next;
    this.stateSince = Date.now();
    this.broadcast({ t: 'state', state: next, startsInMs: this.startsInMs() });
    this.hooks.log(`الغرفة ${shortId(this.id)} [${this.region}] → ${next}`);

    if (next === 'PLAYING') {
      this.broadcastSnapshot();
      this.broadcastKeyframe();
    }
    if (next === 'FINISHED') void this.settle();
  }

  private broadcast(message: ServerMessage): void {
    // تحويل واحد للنص ثم إرساله كما هو للجميع.
    const text = JSON.stringify(message);
    for (const player of this.players.values()) player.link?.sendRaw(text);
  }

  /**
   * بث اللقطة مع مراعاة قوة وصلة كل لاعب.
   *
   * دفعُ خمس عشرة لقطة في الثانية إلى وصلة بطيئة لا يجعلها أسرع: الحزم
   * تتكدّس في الطريق فيزداد التأخير ثم تنقطع الوصلة. فمن كانت وصلته ضعيفة
   * يأخذ حصة أقل — وهي حصة تكفي تمامًا لأن الجهاز يستوفي ما بينها.
   */
  private broadcastSnapshot(): void {
    const engine = this.world.engine;
    const actors = engine.actors.map((actor) => packActor(actor, engine.areaPercent(actor)));
    const lb = this.leaderboard();
    const text = JSON.stringify({
      t: 'snap',
      tick: this.tickCount,
      elapsed: engine.elapsed,
      actors,
      lb,
    } satisfies ServerMessage);

    for (const player of this.players.values()) {
      const link = player.link;
      if (!link) continue;

      // مخزن الإرسال ممتلئ: الوصلة لا تلحق أصلًا، وإضافة حزمة تزيد الطين بلّة.
      if (link.saturated()) continue;

      const every = snapshotDivisor(link.rttMs());
      if (every > 1) {
        player.snapshotSkip = (player.snapshotSkip + 1) % every;
        if (player.snapshotSkip !== 0) continue;
      }
      link.sendRaw(text);
    }
  }

  private sendKeyframe(player: RoomPlayer): void {
    if (!player.link) return;
    player.link.sendRaw(this.keyframeText());
  }

  private broadcastKeyframe(): void {
    const text = this.keyframeText();
    for (const player of this.players.values()) player.link?.sendRaw(text);
  }

  /** الإطار المفتاحي يُرمَّز مرة واحدة للغرفة، لا مرة لكل لاعب فيها. */
  private keyframeText(): string {
    const engine = this.world.engine;
    const frame = encodeKeyframe(engine);
    return JSON.stringify({
      t: 'key',
      tick: this.tickCount,
      owner: frame.owner,
      trail: frame.trail,
      actors: engine.actors.map((actor) => packActor(actor, engine.areaPercent(actor))),
    } satisfies ServerMessage);
  }

  /** لوحة الصدارة يبنيها الخادم بالكامل: الترتيب والمساحة وحالة الخروج. */
  private leaderboard(): NetLeaderEntry[] {
    const engine = this.world.engine;
    return engine.ranking().map((actor) => {
      const player = this.byActor.get(actor.id);
      return {
        actorId: actor.id,
        name: actor.name,
        kind: actor.kind,
        colorIndex: actor.colorIndex,
        areaPercent: Number(engine.areaPercent(actor).toFixed(2)),
        eliminated: player ? player.eliminated : !actor.alive && actor.respawnAt < 0,
        avatarUrl: player?.avatarUrl ?? null,
      };
    });
  }

  /** حصاد النتائج: يُحفظ في قاعدة البيانات ثم يُرسل لكل لاعب نتيجته. */
  private async settle(): Promise<void> {
    this.closedAt = Date.now();
    const engine = this.world.engine;
    const lb = this.leaderboard();

    for (const player of this.players.values()) {
      if (player.reported) continue;
      player.reported = true;

      const actor = engine.actorById(player.actorId);
      const areaPercent = actor ? Number(engine.areaPercent(actor).toFixed(2)) : 0;
      const rank = lb.findIndex((row) => row.actorId === player.actorId) + 1 || lb.length;
      const outcome: RoundOutcome = player.eliminated
        ? 'eliminated'
        : engine.endReason === 'timeup'
          ? 'timeup'
          : 'survived';

      let bestAreaPercent = areaPercent;
      let rounds = 0;
      try {
        const saved = await this.hooks.onPlayerResult(player.playerId, areaPercent);
        bestAreaPercent = saved.bestAreaPercent;
        rounds = saved.rounds;
      } catch (error) {
        this.hooks.log(`تعذّر حفظ نتيجة ${shortId(player.playerId)}: ${(error as Error).message}`);
      }

      const result: NetRoundResult = {
        outcome,
        rank,
        participants: this.participants.length,
        areaPercent,
        coins: player.coins,
        kills: player.kills,
        leaderboard: lb,
        matchId: this.id,
        bestAreaPercent,
        rounds,
      };
      player.link?.send({ t: 'over', result });
    }
    this.hooks.onClosed(this);
  }
}

/**
 * بوت معلَن.
 * الاسم يبدأ بكلمة «بوت» دائمًا — لا يُسمح بأي اسم يوحي بأنه حساب تيليجرام.
 */
function makeBot(actorId: number, number: number): MatchParticipant {
  const difficulties = ['easy', 'medium', 'medium', 'hard'] as const;
  const behaviors = ['explorer', 'defensive', 'aggressive', 'opportunist', 'balanced'] as const;
  return {
    kind: 'bot',
    actorId,
    name: `بوت ${number}`,
    colorIndex: (actorId - 1) % ACTOR_COLORS.length,
    difficulty: difficulties[number % difficulties.length],
    behavior: behaviors[number % behaviors.length],
  };
}

/**
 * كم لقطة نتخطّى لكل لقطة نرسلها، حسب زمن الاستجابة المقاس.
 * الوصلة الجيدة تأخذ كل شيء، والضعيفة تأخذ ما تستطيع هضمه.
 */
function snapshotDivisor(rttMs: number): number {
  if (rttMs >= MULTIPLAYER.POOR_LINK_RTT_MS) return 3;
  if (rttMs >= MULTIPLAYER.WEAK_LINK_RTT_MS) return 2;
  return 1;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function shortId(value: string): string {
  return value.slice(0, 8);
}
