import {
  MULTIPLAYER,
  type MatchState,
  type RegionId,
  type RoomDescriptor,
} from '@riqaa/shared';
import type { PlayerRepository } from '../players/player.repository.js';
import { Room, type ClientLink, type RoomSeat } from './room.js';

interface QueueEntry extends RoomSeat {
  since: number;
}

export interface JoinResult {
  descriptor: RoomDescriptor;
  reconnected: boolean;
}

export interface ManagerLog {
  (message: string): void;
}

/**
 * مدير الغرف والمطابقة.
 *
 * طابور لكل منطقة، وغرف مستقلة تعمل في اللحظة نفسها.
 * كل الأرقام (سعة الغرفة، الحد الأدنى للبدء، مهلة البحث، ملء البوتات)
 * تُقرأ من MULTIPLAYER في الحزمة المشتركة — لا رقم مبعثر في الكود.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  /** الغرفة الحالية لكل لاعب — أساس إعادة الاتصال. */
  private readonly playerRoom = new Map<string, string>();
  private readonly queues = new Map<RegionId, QueueEntry[]>();
  private timer: NodeJS.Timeout | null = null;
  private lastTick = Date.now();

  constructor(
    private readonly players: PlayerRepository,
    private readonly log: ManagerLog,
  ) {}

  start(): void {
    if (this.timer) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.pump(), Math.round(1000 / MULTIPLAYER.TICK_HZ));
    // المؤقّت وحده لا يمنع الخادم من الإغلاق عند الإيقاف.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get stats(): { rooms: number; players: number; queued: number } {
    let queued = 0;
    for (const queue of this.queues.values()) queued += queue.length;
    let players = 0;
    for (const room of this.rooms.values()) players += room.humanCount;
    return { rooms: this.rooms.size, players, queued };
  }

  // -------------------------------------------------------------- المطابقة

  /** يعيد وصف الغرفة إذا كان اللاعب داخل غرفة قائمة (إعادة اتصال). */
  resume(playerId: string, link: ClientLink): RoomDescriptor | null {
    const roomId = this.playerRoom.get(playerId);
    if (!roomId) return null;
    const room = this.rooms.get(roomId);
    if (!room || room.finished) {
      this.playerRoom.delete(playerId);
      return null;
    }
    const descriptor = room.attach(playerId, link);
    if (descriptor) this.log(`عاد ${playerId.slice(0, 8)} إلى الغرفة ${roomId.slice(0, 8)}`);
    return descriptor;
  }

  enqueue(seat: RoomSeat, region: RegionId): { waiting: number; needed: number } {
    this.dequeue(seat.playerId);
    const queue = this.queueFor(region);
    queue.push({ ...seat, since: Date.now() });
    this.matchRegion(region);
    return {
      waiting: queue.length,
      needed: Math.max(0, MULTIPLAYER.MIN_PLAYERS_TO_START - queue.length),
    };
  }

  dequeue(playerId: string): void {
    for (const [region, queue] of this.queues) {
      const index = queue.findIndex((entry) => entry.playerId === playerId);
      if (index >= 0) {
        queue.splice(index, 1);
        if (queue.length === 0) this.queues.delete(region);
        return;
      }
    }
  }

  input(playerId: string, heading: number, throttle: number): void {
    this.roomOf(playerId)?.applyInput(playerId, heading, throttle);
  }

  leave(playerId: string): void {
    this.dequeue(playerId);
    const room = this.roomOf(playerId);
    room?.leave(playerId);
    this.playerRoom.delete(playerId);
  }

  /** انقطاع مؤقّت: تبدأ مهلة العودة ولا يُحذف اللاعب من الغرفة. */
  disconnect(playerId: string): void {
    this.dequeue(playerId);
    this.roomOf(playerId)?.detach(playerId);
  }

  stateOf(playerId: string): MatchState | null {
    return this.roomOf(playerId)?.state ?? null;
  }

  private roomOf(playerId: string): Room | undefined {
    const roomId = this.playerRoom.get(playerId);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  private queueFor(region: RegionId): QueueEntry[] {
    let queue = this.queues.get(region);
    if (!queue) {
      queue = [];
      this.queues.set(region, queue);
    }
    return queue;
  }

  /**
   * تُفتح الغرفة في حالتين:
   * امتلاء المقاعد البشرية، أو اكتمال الحد الأدنى؛ وإن طال الانتظار
   * فوق MATCHMAKING_TIMEOUT تُفتح بمن حضر وتُملأ الباقي ببوتات معلنة.
   */
  private matchRegion(region: RegionId): void {
    const queue = this.queues.get(region);
    if (!queue || queue.length === 0) return;

    const capacity = MULTIPLAYER.MAX_PLAYERS_PER_ROOM;
    const oldest = queue[0];
    const waited = Date.now() - oldest.since;
    const ready =
      queue.length >= capacity ||
      queue.length >= MULTIPLAYER.MIN_PLAYERS_TO_START ||
      (waited >= MULTIPLAYER.MATCHMAKING_TIMEOUT && MULTIPLAYER.BOT_FILL_ENABLED);

    if (!ready) return;

    const seats = queue.splice(0, capacity).map<RoomSeat>((entry) => ({
      playerId: entry.playerId,
      name: entry.name,
      avatarUrl: entry.avatarUrl,
      link: entry.link,
    }));
    if (queue.length === 0) this.queues.delete(region);
    this.openRoom(region, seats);
  }

  private openRoom(region: RegionId, seats: readonly RoomSeat[]): Room {
    const room = new Room(region, seats, {
      onPlayerResult: (playerId, areaPercent) =>
        this.players
          .recordRoundResult(playerId, areaPercent)
          .then((profile) => ({
            bestAreaPercent: profile.stats.bestAreaPercent,
            rounds: profile.stats.rounds,
          })),
      onClosed: (closed) => {
        for (const playerId of closed.playerIds) {
          if (this.playerRoom.get(playerId) === closed.id) this.playerRoom.delete(playerId);
        }
      },
      log: this.log,
    });

    this.rooms.set(room.id, room);
    for (const seat of seats) {
      this.playerRoom.set(seat.playerId, room.id);
      const descriptor = room.descriptorFor(seat.playerId);
      if (descriptor) seat.link.send({ t: 'room', room: descriptor });
    }
    this.log(
      `غرفة جديدة ${room.id.slice(0, 8)} [${region}] — ${seats.length} لاعب بشري، السعة ${MULTIPLAYER.MAX_PLAYERS_PER_ROOM}`,
    );
    return room;
  }

  // ------------------------------------------------------------- المؤقّت

  /** نبضة واحدة تحرّك كل الغرف وتراجع الطوابير. */
  private pump(): void {
    const now = Date.now();
    const delta = now - this.lastTick;
    this.lastTick = now;

    for (const room of this.rooms.values()) {
      try {
        room.tick(delta);
      } catch (error) {
        this.log(`خطأ في الغرفة ${room.id.slice(0, 8)}: ${(error as Error).message}`);
      }
      if (room.expired) this.rooms.delete(room.id);
    }

    for (const region of [...this.queues.keys()]) this.matchRegion(region);
  }
}
