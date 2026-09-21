import type { FastifyInstance } from 'fastify';
import type { MatchResultRequest, MatchResultResponse, MatchStartResponse } from '@riqaa/shared';
import type { Env } from '../../core/env.js';
import { badRequest, notFound } from '../../core/errors.js';
import { requireAuth } from '../auth/auth.routes.js';
import type { PlayerRepository } from '../players/player.repository.js';
import type { MatchService } from './match.service.js';

export interface MatchDeps {
  env: Env;
  players: PlayerRepository;
  matches: MatchService;
}

export async function registerMatchRoutes(app: FastifyInstance, deps: MatchDeps): Promise<void> {
  const { env, players, matches } = deps;
  const auth = { preHandler: requireAuth(env) };

  app.post('/api/match/start', auth, async (request): Promise<MatchStartResponse> => {
    const player = await players.findById(request.playerId!);
    if (!player) throw notFound('player_not_found', 'لم يتم العثور على اللاعب');
    const name = [player.firstName, player.lastName].filter(Boolean).join(' ') || 'لاعب';
    return matches.start(player.telegramId, name);
  });

  app.post('/api/match/result', auth, async (request): Promise<MatchResultResponse> => {
    const body = (request.body ?? {}) as MatchResultRequest;
    if (typeof body.matchId !== 'string') {
      throw badRequest('match_id_required', 'معرّف الجولة مطلوب');
    }
    const areaPercent = clampPercent(body.areaPercent);
    const rank = Number.isFinite(body.rank) ? Math.max(1, Math.floor(body.rank)) : 1;

    matches.finish(body.matchId, request.playerId!);
    const player = await players.recordRoundResult(request.playerId!, areaPercent);

    return {
      areaPercent,
      rank,
      bestAreaPercent: player.stats.bestAreaPercent,
      rounds: player.stats.rounds,
    };
  });
}

function clampPercent(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(100, Math.round(number * 100) / 100);
}
