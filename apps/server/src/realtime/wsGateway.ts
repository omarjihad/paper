import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  MULTIPLAYER,
  REALTIME_PATH,
  type RegionId,
  type ServerMessage,
} from '@riqaa/shared';
import {
  ProtocolRouter,
  type ClientLink,
  type PlayerRepository,
  type ProtocolSession,
  type RoomManager,
} from '@riqaa/server-core';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Env } from '../core/env.js';

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

interface Session extends ProtocolSession {
  socket: WebSocket;
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
 * بوابة اللعب اللحظي على Node.
 *
 * هذا الملف غلافُ مقبسٍ لا أكثر: يترجم أحداث ws إلى جلسة بروتوكول، ويقيس
 * زمن الذهاب والإياب من نبضة المقبس. كل قواعد الثقة والبروتوكول في
 * ProtocolRouter المشترك، كي يسري الحرف نفسه على أي وقت تشغيل آخر.
 */
export function attachRealtime(server: Server, deps: GatewayDeps): () => void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const sessions = new Set<Session>();
  const router = new ProtocolRouter({
    sessionSecret: deps.env.sessionSecret,
    players: deps.players,
    rooms: deps.rooms,
    serverRegion: deps.serverRegion,
    log: deps.log,
  });

  const onUpgrade = (request: { url?: string }, socket: Duplex, head: Buffer): void => {
    const path = (request.url ?? '').split('?')[0];
    if (path !== REALTIME_PATH) return;
    wss.handleUpgrade(request as never, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  };
  server.on('upgrade', onUpgrade);

  wss.on('connection', (socket: WebSocket) => {
    const link: ClientLink = {
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
        link.send({ t: 'error', code, message: reason });
        socket.close(4000, code);
      },
    };
    const session: Session = { socket, link, playerId: null, lastSeen: Date.now(), pingAt: 0, rtt: 0 };
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
      void router.handleRaw(session, String(raw));
    });

    socket.on('close', () => {
      sessions.delete(session);
      router.disconnect(session);
    });

    socket.on('error', () => socket.terminate());
  });

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
