import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { MULTIPLAYER, REALTIME_PATH, type RegionId, type ServerMessage } from '@riqaa/shared';
import {
  HEARTBEAT_MS,
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
 * هذا الملف غلافُ مقبسٍ لا أكثر: يترجم أحداث ws إلى جلسة بروتوكول. كل قواعد
 * الثقة والنبض وقياس الزمن في ProtocolRouter المشترك، كي يسري الحرف نفسه
 * داخل Cloudflare Worker حيث لا وصول إلى إطارات ping/pong في المقبس.
 */
export function attachRealtime(server: Server, deps: GatewayDeps): () => void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const sockets = new Set<WebSocket>();
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
    sockets.add(socket);
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
    const session: ProtocolSession = {
      link,
      playerId: null,
      lastSeen: Date.now(),
      pingAt: 0,
      rtt: 0,
      terminate: () => socket.terminate(),
    };
    router.open(session);

    socket.on('message', (raw: unknown) => void router.handleRaw(session, String(raw)));
    socket.on('close', () => {
      sockets.delete(socket);
      router.disconnect(session);
    });
    socket.on('error', () => socket.terminate());
  });

  const heartbeat = setInterval(() => router.heartbeat(), HEARTBEAT_MS);
  heartbeat.unref?.();

  return () => {
    clearInterval(heartbeat);
    server.off('upgrade', onUpgrade);
    for (const socket of sockets) socket.terminate();
    wss.close();
  };
}
