import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Env } from './core/env.js';
import { AppError } from './core/errors.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { registerMatchRoutes } from './modules/match/match.routes.js';
import { MatchService } from './modules/match/match.service.js';
import type { PlayerRepository } from './modules/players/player.repository.js';

export interface AppDeps {
  env: Env;
  players: PlayerRepository;
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

  app.get('/api/health', async () => ({
    ok: true,
    storage: deps.players.kind,
    telegram: deps.env.telegramBotToken ? 'configured' : 'missing',
  }));

  const matches = new MatchService();
  await registerAuthRoutes(app, { env: deps.env, players: deps.players });
  await registerMatchRoutes(app, { env: deps.env, players: deps.players, matches });

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
