import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  APP_VERSION,
  MULTIPLAYER,
  NET_PROTOCOL_VERSION,
  REALTIME_PATH,
  type ClientMessage,
  type RegionId,
  type ServerMessage,
} from '@riqaa/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Env } from '../core/env.js';
import { verifyToken } from '../modules/auth/session.js';
import type { PlayerRepository } from '../modules/players/player.repository.js';
import { regionCatalog } from '../modules/room/regions.js';
import type { RoomManager } from '../modules/room/roomManager.js';
import type { ClientLink } from '../modules/room/room.js';

/** أقصى طول رسالة مقبول من العميل — الإدخال أسطر قصيرة لا غير. */
const MAX_MESSAGE_BYTES = 2048;
/**
 * فحص حيوية الوصلات وقياس زمنها.
 * النبضة هنا ليست للحياة فقط: منها يُشتق زمن الاستجابة الذي يقرّر حصة
 * اللاعب من اللقطات، فيجب أن تكون متقاربة بما يكفي ليواكب القرارُ الشبكةَ.
 */
const HEARTBEAT_MS = 4000;
/**
 * كم من الصمت يعني وصلة ميتة فعلًا.
 * المتصفح يخنق المؤقتات حين يُصغَّر التطبيق، فتتأخر نبضات العميل؛ قطعُ
 * الوصلة عند أول نبضة فائتة يعني طرد كل من صغّر تيليجرام لحظة.
 */
const SILENCE_LIMIT_MS = 70000;

interface Session {
  socket: WebSocket;
  link: ClientLink;
  playerId: string | null;
  /** آخر إشارة حياة من هذه الوصلة: نبضة أو رسالة. */
  lastSeen: number;
  /** متى أُرسلت آخر نبضة، لقياس زمن الذهاب والإياب من الرد عليها. */
  pingAt: number;
  /** متوسط متحرّك لزمن الاستجابة المقاس على الخادم. */
  rtt: number;
}

export interface GatewayDeps {
  env: Env;
  players: PlayerRepository;
  rooms: RoomManager;
  serverRegion: RegionId;
  log: (message: string) => void;
}

/**
 * بوابة اللعب اللحظي.
 *
 * قاعدة واحدة تحكم هذا الملف كله: العميل لا يرسل إلا نيّة حركة.
 * الاسم والصورة والهوية تُشتق من رمز الجلسة الموقَّع ومن قاعدة البيانات،
 * والنتائج والمساحات والعملات تُحسب في الغرفة على الخادم. أي حقل يرسله
 * العميل خارج (الزاوية، نسبة السرعة، المنطقة) يُتجاهل.
 */
export function attachRealtime(server: Server, deps: GatewayDeps): () => void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const sessions = new Set<Session>();
  /** وصلة واحدة فقط لكل لاعب — تمنع الجلسات المكرّرة. */
  const byPlayer = new Map<string, Session>();

  const onUpgrade = (request: { url?: string }, socket: Duplex, head: Buffer): void => {
    const path = (request.url ?? '').split('?')[0];
    if (path !== REALTIME_PATH) return;
    wss.handleUpgrade(request as never, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  };
  server.on('upgrade', onUpgrade);

  wss.on('connection', (socket: WebSocket) => {
    const session: Session = {
      socket,
      playerId: null,
      lastSeen: Date.now(),
      pingAt: 0,
      rtt: 0,
      link: {
        send(message: ServerMessage) {
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
        },
        sendRaw(text: string) {
          if (socket.readyState === socket.OPEN) socket.send(text);
        },
        rttMs() {
          return session.rtt;
        },
        saturated() {
          return socket.bufferedAmount > MULTIPLAYER.SEND_BUFFER_LIMIT;
        },
        close(code: string, reason: string) {
          session.link.send({ t: 'error', code, message: reason });
          socket.close(4000, code);
        },
      },
    };
    sessions.add(session);

    socket.on('pong', () => {
      session.lastSeen = Date.now();
      if (session.pingAt === 0) return;
      const sample = Date.now() - session.pingAt;
      session.pingAt = 0;
      // متوسط متحرّك: قرار التخفيف يجب ألّا يتأرجح مع كل قفزة عابرة.
      session.rtt = session.rtt === 0 ? sample : Math.round(session.rtt * 0.7 + sample * 0.3);
    });

    socket.on('message', (raw: unknown) => {
      session.lastSeen = Date.now();
      let message: ClientMessage;
      try {
        message = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return;
      }
      void handle(session, message).catch((error: Error) => {
        deps.log(`خطأ في معالجة رسالة لحظية: ${error.message}`);
      });
    });

    socket.on('close', () => {
      sessions.delete(session);
      if (session.playerId) {
        if (byPlayer.get(session.playerId) === session) byPlayer.delete(session.playerId);
        deps.rooms.disconnect(session.playerId);
      }
    });

    socket.on('error', () => socket.terminate());
  });

  async function handle(session: Session, message: ClientMessage): Promise<void> {
    switch (message.t) {
      case 'hello':
        await onHello(session, message.token, message.v);
        return;
      case 'ping':
        // قياس زمن حقيقي: العميل يوقّت الذهاب والإياب بنفسه.
        session.link.send({ t: 'pong', n: message.n });
        return;
      default:
        break;
    }

    if (!session.playerId) {
      session.link.close('unauthorized', 'الجلسة غير مُصادَقة');
      return;
    }

    switch (message.t) {
      case 'lobby':
        deps.rooms.watch(session.playerId, session.link);
        return;

      case 'join': {
        const profile = await deps.players.findById(session.playerId);
        if (!profile) {
          session.link.close('player_not_found', 'لم يتم العثور على اللاعب');
          return;
        }
        const result = deps.rooms.join(
          {
            playerId: session.playerId,
            // الاسم والصورة من قاعدة البيانات لا من رسالة العميل.
            name: displayName(profile.firstName, profile.lastName),
            avatarUrl: profile.avatarUrl,
            link: session.link,
          },
          String(message.id ?? ''),
        );
        if (!result.ok) session.link.send({ t: 'error', code: 'join_failed', message: result.reason });
        return;
      }

      case 'start': {
        const started = deps.rooms.begin(session.playerId);
        if (!started.ok) session.link.send({ t: 'error', code: 'start_failed', message: started.reason });
        return;
      }

      case 'input':
        deps.rooms.input(session.playerId, Number(message.h), Number(message.r));
        return;
      case 'leave':
        deps.rooms.leave(session.playerId);
        return;
      default:
        return;
    }
  }

  async function onHello(session: Session, token: string, version: number): Promise<void> {
    if (version !== NET_PROTOCOL_VERSION) {
      session.link.close('protocol_mismatch', 'نسخة اللعبة قديمة، أعد فتحها من تيليجرام');
      return;
    }
    let playerId: string;
    try {
      playerId = verifyToken(String(token ?? ''), deps.env.sessionSecret).sub;
    } catch {
      session.link.close('unauthorized', 'الجلسة غير صالحة، أعد فتح اللعبة');
      return;
    }

    const profile = await deps.players.findById(playerId);
    if (!profile) {
      session.link.close('player_not_found', 'لم يتم العثور على اللاعب');
      return;
    }

    // جلسة واحدة لكل لاعب: الوصلة القديمة تُغلق فورًا.
    const previous = byPlayer.get(playerId);
    if (previous && previous !== session) {
      previous.playerId = null;
      previous.link.close('duplicate_session', 'تم فتح اللعبة في مكان آخر');
    }

    session.playerId = playerId;
    byPlayer.set(playerId, session);

    session.link.send({
      t: 'welcome',
      v: NET_PROTOCOL_VERSION,
      version: APP_VERSION,
      regions: regionCatalog(deps.serverRegion),
      serverRegion: deps.serverRegion,
      name: displayName(profile.firstName, profile.lastName),
    });

    // إن كان داخل غرفة قائمة، تعود حالته كما هي ضمن مهلة السماح.
    deps.rooms.resume(playerId, session.link);
  }

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const session of sessions) {
      if (now - session.lastSeen > SILENCE_LIMIT_MS) {
        session.socket.terminate();
        continue;
      }
      try {
        session.pingAt = now;
        session.socket.ping();
      } catch {
        session.socket.terminate();
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  return () => {
    clearInterval(heartbeat);
    server.off('upgrade', onUpgrade);
    for (const session of sessions) session.socket.terminate();
    wss.close();
  };
}

function displayName(firstName: string, lastName: string | null): string {
  return [firstName, lastName].filter(Boolean).join(' ').trim() || 'لاعب';
}
