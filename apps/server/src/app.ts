import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { APP_VERSION, MULTIPLAYER } from '@riqaa/shared';
import type { Env } from './core/env.js';
import { AppError } from '@riqaa/server-core';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { registerBotRoutes } from './modules/bot/bot.routes.js';
import { registerClientErrorRoute } from './modules/diagnostics/client-error.routes.js';
import type { TelegramBot } from '@riqaa/server-core';
import { registerMatchRoutes } from './modules/match/match.routes.js';
import { MatchService } from './modules/match/match.service.js';

import { regionCatalog, RoomManager, type PlayerRepository } from '@riqaa/server-core';
import { attachRealtime } from './realtime/wsGateway.js';

export interface AppDeps {
  env: Env;
  players: PlayerRepository;
  /** بوت تيليجرام — null يعني أن مسار الـwebhook معطّل. */
  bot?: TelegramBot | null;
}

const here = dirname(fileURLToPath(import.meta.url));
/** مجلد بناء الواجهة — يُقدَّم من نفس الخادم في الإنتاج. */
const MINIAPP_DIST = resolve(here, '../../miniapp/dist');

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    trustProxy: true,
  });

  await app.register(cors, {
    origin: deps.env.corsOrigin === '*' ? true : deps.env.corsOrigin.split(','),
    credentials: false,
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({ error: error.code, message: error.message });
      return;
    }
    request.log.error(error);
    reply.status(500).send({ error: 'internal_error', message: 'حدث خطأ غير متوقع في الخادم' });
  });

  // ---------------------------------------------------- اللعب الجماعي اللحظي
  const rooms = new RoomManager(
    deps.players,
    (message) => app.log.info(`[سيرفرات] ${message}`),
    deps.env.serverRegion,
  );
  rooms.start();
  const detachRealtime = attachRealtime(app.server, {
    env: deps.env,
    players: deps.players,
    rooms,
    serverRegion: deps.env.serverRegion,
    log: (message) => app.log.warn(`[لحظي] ${message}`),
  });
  app.addHook('onClose', async () => {
    detachRealtime();
    rooms.stop();
  });

  app.get('/api/health', async () => ({
    ok: true,
    version: APP_VERSION,
    storage: deps.players.kind,
    telegram: deps.env.telegramBotToken ? 'configured' : 'missing',
    bot: deps.bot ? 'enabled' : 'disabled',
    realtime: rooms.stats,
    region: deps.env.serverRegion,
  }));

  /** قائمة المناطق — المستضافة منها واحدة، والباقي معروضة بلا قياس. */
  app.get('/api/regions', async () => ({
    regions: regionCatalog(deps.env.serverRegion),
    serverRegion: deps.env.serverRegion,
    config: {
      lobbyCount: MULTIPLAYER.LOBBY_COUNT,
      maxPlayersPerRoom: MULTIPLAYER.MAX_PLAYERS_PER_ROOM,
      minPlayersToStart: MULTIPLAYER.MIN_PLAYERS_TO_START,
      matchmakingTimeout: MULTIPLAYER.MATCHMAKING_TIMEOUT,
      botFillEnabled: MULTIPLAYER.BOT_FILL_ENABLED,
    },
    servers: rooms.listServers(),
  }));

  const matches = new MatchService();
  await registerAuthRoutes(app, { env: deps.env, players: deps.players });
  await registerMatchRoutes(app, { env: deps.env, players: deps.players, matches });
  await registerBotRoutes(app, {
    bot: deps.bot ?? null,
    secretToken: deps.env.telegramWebhookSecret,
  });
  await registerClientErrorRoute(app);

  if (existsSync(MINIAPP_DIST)) {
    await app.register(fastifyStatic, { root: MINIAPP_DIST, index: ['index.html'] });
    // أي مسار غير معروف خارج /api يعيد صفحة اللعبة.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api')) {
        reply.status(404).send({ error: 'not_found', message: 'المسار غير موجود' });
        return;
      }
      reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((request, reply) => {
      reply.status(404).send({
        error: 'not_found',
        message: request.url.startsWith('/api')
          ? 'المسار غير موجود'
          : 'واجهة اللعبة غير مبنية بعد — شغّل npm run build أو استخدم خادم التطوير',
      });
    });
  }

  return app;
}
