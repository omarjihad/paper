import type { FastifyInstance } from 'fastify';
import type { AuthRequest, AuthResponse, PlayerProfile } from '@riqaa/shared';
import {
  login,
  playerIdFromHeader,
  profileOf,
  type PlayerRepository,
  type RuntimeConfig,
} from '@riqaa/server-core';
import type { Env } from '../../core/env.js';

declare module 'fastify' {
  interface FastifyRequest {
    playerId?: string;
  }
}

export interface AuthDeps {
  env: Env;
  players: PlayerRepository;
}

/** يقرأ رمز الجلسة من الترويسة ويضع معرّف اللاعب على الطلب. */
export function requireAuth(env: Env) {
  return async function authGuard(request: { headers: Record<string, unknown>; playerId?: string }) {
    const header = request.headers['authorization'];
    request.playerId = playerIdFromHeader(typeof header === 'string' ? header : null, env.sessionSecret);
  };
}

/**
 * مسارات المصادقة على Fastify — غلافٌ رقيق.
 * المنطق كلّه في @riqaa/server-core كي يسري الحرف نفسه على Cloudflare Worker.
 */
export async function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): Promise<void> {
  const { env, players } = deps;
  const config: RuntimeConfig = env;

  app.post('/api/auth/telegram', async (request): Promise<AuthResponse> =>
    login((request.body ?? {}) as AuthRequest, {
      config,
      players,
      log: {
        info: (message) => request.log.info(message),
        warn: (message) => request.log.warn(message),
      },
    }),
  );

  app.get('/api/me', { preHandler: requireAuth(env) }, async (request): Promise<PlayerProfile> =>
    profileOf(request.playerId!, players),
  );
}
