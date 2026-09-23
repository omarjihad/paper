import {
  MULTIPLAYER,
  type LobbyServer,
  type MatchState,
  type RegionId,
  type RoomDescriptor,
} from '@riqaa/shared';
import type { PlayerRepository } from '../players/player.repository.js';
import { Room, type ClientLink, type RoomSeat } from './room.js';

export interface ManagerLog {
  (message: string): void;
}

/**
 * مدير السيرفرات.
 *
 * عدد ثابت من السيرفرات المعلنة، لا طابور خفيّ: اللاعب يرى أين يجلس
 * الآخرون فيجلس معهم. المطابقة التلقائية كانت تفتح لكلٍّ غرفةً على حدة
 * فلا يلتقي اثنان إلا بمصادفة نادرة.
 *
 * كل الأرقام من MULTIPLAYER في الحزمة المشتركة — لا رقم مبعثر في الكود.
 */
export class RoomManager {
  private readonly rooms: Room[] = [];
  /** السيرفر الذي يجلس فيه كل لاعب — أساس إعادة الاتصال. */
  private readonly playerRoom = new Map<string, string>();
  /** من يتابع قائمة السيرفرات الآن. */
  private readonly watchers = new Map<string, ClientLink>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = Date.now();

  constructor(
    private readonly players: PlayerRepository,
    private readonly log: ManagerLog,
    private readonly region: RegionId = 'eu',
  ) {
    for (let i = 0; i < MULTIPLAYER.LOBBY_COUNT; i++) {
      this.rooms.push(new Room(i, region, this.hooks()));
    }
  }

  private hooks() {
    return {
      onPlayerResult: (playerId: string, areaPercent: number) =>
        this.players.recordRoundResult(playerId, areaPercent).then((profile) => ({
          bestAreaPercent: profile.stats.bestAreaPercent,
          rounds: profile.stats.rounds,
        })),
      onClosed: (closed: Room) => {
        for (const playerId of closed.playerIds) {
          if (this.playerRoom.get(playerId) === closed.id) this.playerRoom.delete(playerId);
        }
      },
      log: this.log,
    };
  }

  start(): void {
    if (this.timer) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.pump(), Math.round(1000 / MULTIPLAYER.TICK_HZ));
    // unref موجود في Node وحده — يمنع المؤقّت من إبقاء العملية حيّة.
    (this.timer as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get stats(): { rooms: number; players: number; playing: number } {
    let players = 0;
    let playing = 0;
    for (const room of this.rooms) {
      players += room.humanCount;
      if (room.state === 'PLAYING' || room.state === 'COUNTDOWN') playing++;
    }
    return { rooms: this.rooms.length, players, playing };
  }

  // ------------------------------------------------------------- القائمة

  /** لقطة القائمة كما تُعرض: البشر فقط، بلا البوتات التي تملأ الشاغر لاحقًا. */
  listServers(): LobbyServer[] {
    return this.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      flag: room.flag,
      region: room.region,
      players: room.humanCount,
      capacity: MULTIPLAYER.MAX_PLAYERS_PER_ROOM,
      state: room.state,
      joinable: room.joinable,
    }));
  }

  watch(playerId: string, link: ClientLink): void {
    this.watchers.set(playerId, link);
    this.sendLobby(playerId, link);
  }

  unwatch(playerId: string): void {
    this.watchers.delete(playerId);
  }

  private sendLobby(playerId: string, link: ClientLink): void {
    link.send({
      t: 'lobby',
      servers: this.listServers(),
      yourServerId: this.playerRoom.get(playerId) ?? null,
      serverRegion: this.region,
    });
  }

  /** أي تغيّر في المقاعد أو الحالة يصل إلى كل من يتفرّج على القائمة. */
  private broadcastLobby(): void {
    for (const [playerId, link] of this.watchers) this.sendLobby(playerId, link);
  }

  // ------------------------------------------------------------ الانضمام

  /** يعيد وصف الغرفة إذا كان اللاعب داخل جولة قائمة (إعادة اتصال). */
  resume(playerId: string, link: ClientLink): RoomDescriptor | null {
    const room = this.roomOf(playerId);
    if (!room || room.finished || room.state === 'WAITING') return null;
    const descriptor = room.attach(playerId, link);
    if (descriptor) this.log(`عاد ${playerId.slice(0, 8)} إلى ${room.name}`);
    return descriptor;
  }

  /**
   * يجلس اللاعب في سيرفر مختار.
   *
   * إن كانت جولته جارية دخل فورًا على مقعد شاغر بدل أن يُردّ حتى تنتهي:
   * من مات يعود إلى أصحابه في الحال، ولا ينتظر موت الجميع.
   */
  join(seat: RoomSeat, roomId: string): { ok: true; live: boolean } | { ok: false; reason: string } {
    const room = this.rooms.find((candidate) => candidate.id === roomId);
    if (!room) return { ok: false, reason: 'هذا السيرفر غير موجود' };
    if (room.finished) return { ok: false, reason: 'انتهت الجولة في هذا السيرفر، اختر غيره' };
    if (!room.joinable) return { ok: false, reason: 'السيرفر ممتلئ' };

    if (room.state !== 'WAITING') {
      this.leaveSeat(seat.playerId);
      const descriptor = room.joinLive(seat);
      if (!descriptor) return { ok: false, reason: 'السيرفر ممتلئ' };
      this.playerRoom.set(seat.playerId, room.id);
      seat.link.send({ t: 'room', room: descriptor });
      this.broadcastLobby();
      return { ok: true, live: true };
    }

    this.leaveSeat(seat.playerId);
    if (!room.seat(seat)) return { ok: false, reason: 'السيرفر ممتلئ' };
    this.playerRoom.set(seat.playerId, room.id);
    this.broadcastLobby();
    return { ok: true, live: false };
  }

  /** يبدأ الجولة في سيرفر اللاعب — بضغطته هو. */
  begin(playerId: string): { ok: true } | { ok: false; reason: string } {
    const room = this.roomOf(playerId);
    if (!room) return { ok: false, reason: 'اختر سيرفرًا أولًا' };
    if (room.state !== 'WAITING') return { ok: false, reason: 'الجولة بدأت بالفعل' };
    if (!room.begin()) return { ok: false, reason: 'تعذّر بدء الجولة' };
    this.log(`${room.name} انطلق بـ${room.humanCount} لاعبًا بشريًا`);
    this.broadcastLobby();
    return { ok: true };
  }

  input(playerId: string, heading: number, throttle: number): void {
    this.roomOf(playerId)?.applyInput(playerId, heading, throttle);
  }

  leave(playerId: string): void {
    const room = this.roomOf(playerId);
    if (room && room.state !== 'WAITING') room.leave(playerId);
    else this.leaveSeat(playerId);
    this.playerRoom.delete(playerId);
    this.broadcastLobby();
  }

  /** انقطاع مؤقّت: تبدأ مهلة العودة، وفي الانتظار يُخلى المقعد فورًا. */
  disconnect(playerId: string): void {
    this.unwatch(playerId);
    const room = this.roomOf(playerId);
    if (!room) return;
    if (room.state === 'WAITING') {
      this.leaveSeat(playerId);
      this.playerRoom.delete(playerId);
    } else {
      room.detach(playerId);
    }
    this.broadcastLobby();
  }

  stateOf(playerId: string): MatchState | null {
    return this.roomOf(playerId)?.state ?? null;
  }

  private leaveSeat(playerId: string): void {
    const previous = this.roomOf(playerId);
    previous?.unseat(playerId);
  }

  private roomOf(playerId: string): Room | undefined {
    const roomId = this.playerRoom.get(playerId);
    return roomId ? this.rooms.find((room) => room.id === roomId) : undefined;
  }

  // ------------------------------------------------------------- المؤقّت

  /** نبضة واحدة تحرّك كل السيرفرات. يقودها كل وقت تشغيل بمؤقّته. */
  pump(): void {
    const now = Date.now();
    const delta = now - this.lastTick;
    this.lastTick = now;
    let changed = false;

    for (const room of this.rooms) {
      const before = room.state;
      try {
        room.tick(delta);
      } catch (error) {
        this.log(`خطأ في ${room.name}: ${(error as Error).message}`);
      }

      // مجموعة اكتملت ولم يضغط أحد: تنطلق بعد المهلة كي لا ينتظروا إلى الأبد.
      if (
        room.state === 'WAITING' &&
        room.quorumSince > 0 &&
        now - room.quorumSince >= MULTIPLAYER.MATCHMAKING_TIMEOUT
      ) {
        room.begin();
      }
      // وسيرفر امتلأ بالبشر ينطلق بلا انتظار.
      if (room.state === 'WAITING' && room.humanCount >= MULTIPLAYER.MAX_PLAYERS_PER_ROOM) {
        room.begin();
      }

      if (room.expired) room.recycle();
      if (room.state !== before) changed = true;
    }

    if (changed) this.broadcastLobby();
  }
}
