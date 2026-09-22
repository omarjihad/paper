import type { FastifyInstance } from 'fastify';
import type { AuthRequest, AuthResponse, PlayerProfile } from '@riqaa/shared';
import type { Env } from '../../core/env.js';
import { notFound, unauthorized } from '../../core/errors.js';
import type { PlayerRepository } from '../players/player.repository.js';
import { issueToken, verifyToken } from './session.js';
import { summarizeInitData, verifyInitData } from './telegram.js';

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
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw unauthorized('token_missing', 'الجلسة غير موجودة، أعد فتح اللعبة من تيليجرام');
    }
    const payload = verifyToken(header.slice(7), env.sessionSecret);
    request.playerId = payload.sub;
  };
}

export async function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): Promise<void> {
  const { env, players } = deps;

  app.post('/api/auth/telegram', async (request): Promise<AuthResponse> => {
    const body = (request.body ?? {}) as AuthRequest;

    if (body.initData) {
      let user;
      try {
        const verified = verifyInitData(body.initData, env.telegramBotToken, env.initDataMaxAge);
        user = verified.user;
        request.log.debug(`تحقق ناجح من initData (صيغة ${verified.variant})`);
      } catch (error) {
        // بلا هذا السطر يكون فشل التحقق صامتًا تمامًا في سجلات الاستضافة.
        request.log.warn(
          `فشل التحقق من initData: ${(error as Error).message} | ${summarizeInitData(body.initData, env.telegramBotToken)}`,
        );
        throw error;
      }
      const profile = await players.upsertOnLogin({
        telegramId: String(user.id),
        firstName: user.first_name,
        lastName: user.last_name ?? null,
        username: user.username ?? null,
        avatarUrl: user.photo_url ?? null,
      });
      return {
        token: issueToken(profile.telegramId, 'telegram', env.sessionSecret),
        player: profile,
        source: 'telegram',
      };
    }

    // مسار التطوير فقط: فتح اللعبة في متصفح عادي خارج تيليجرام.
    if (body.guest && env.devAllowGuest) {
      const profile = await players.upsertOnLogin(guestIdentity(body.guestId));
      return {
        token: issueToken(profile.telegramId, 'guest', env.sessionSecret),
        player: profile,
        source: 'guest',
      };
    }

    throw unauthorized(
      'telegram_required',
      'هذه اللعبة تُفتح من داخل تيليجرام فقط',
    );
  });

  app.get('/api/me', { preHandler: requireAuth(env) }, async (request): Promise<PlayerProfile> => {
    const player = await players.findById(request.playerId!);
    if (!player) throw notFound('player_not_found', 'لم يتم العثور على اللاعب');
    await players.touch(player.telegramId);
    return player;
  });
}

function guestIdentity(guestId: string | undefined) {
  const safe = (guestId ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  const id = safe || Math.random().toString(36).slice(2, 12);
  return {
    telegramId: `guest:${id}`,
    firstName: 'ضيف التطوير',
    lastName: null,
    username: null,
    avatarUrl: null,
  };
}
