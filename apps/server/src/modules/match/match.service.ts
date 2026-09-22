import { randomUUID } from 'node:crypto';
import {
  ACTOR_COLORS,
  BOT_BEHAVIORS,
  DEFAULT_MATCH_CONFIG,
  type BotDifficulty,
  type MatchParticipant,
  type MatchStartResponse,
} from '@riqaa/shared';
import { badRequest } from '../../core/errors.js';

interface ActiveMatch {
  matchId: string;
  playerId: string;
  seed: number;
  startedAt: number;
  participants: number;
}

/** توزيع صعوبات البوتات في الجولة الواحدة. */
const BOT_LINEUP: readonly BotDifficulty[] = [
  'easy',
  'easy',
  'easy',
  'medium',
  'medium',
  'medium',
  'medium',
  'hard',
  'hard',
];

const MATCH_TTL_MS = 30 * 60 * 1000;

/**
 * الجولة الفردية المحلية: الخادم يصدر وصفها والجهاز يحاكيها.
 * تبقى كمسار احتياطي حين يتعذّر الوصول إلى خادم اللعب الجماعي اللحظي،
 * أما اللعب الجماعي الموثوق فمكانه modules/room.
 */
export class MatchService {
  private readonly active = new Map<string, ActiveMatch>();

  start(playerId: string, playerName: string): MatchStartResponse {
    this.sweep();

    const matchId = randomUUID();
    const seed = (Math.random() * 0xffffffff) >>> 0;

    const participants: MatchParticipant[] = [
      { kind: 'human', actorId: 1, name: playerName, colorIndex: 0 },
    ];
    BOT_LINEUP.forEach((difficulty, index) => {
      participants.push({
        kind: 'bot',
        actorId: index + 2,
        // الاسم يوضّح صراحةً أن هذا بوت — لا تمويه بأسماء تبدو كلاعبين حقيقيين.
        name: `بوت ${index + 1}`,
        colorIndex: (index + 1) % ACTOR_COLORS.length,
        difficulty,
        behavior: BOT_BEHAVIORS[index % BOT_BEHAVIORS.length],
      });
    });

    this.active.set(matchId, {
      matchId,
      playerId,
      seed,
      startedAt: Date.now(),
      participants: participants.length,
    });

    return { matchId, seed, config: DEFAULT_MATCH_CONFIG, participants };
  }

  /** يتحقق أن الجولة تخص هذا اللاعب ثم يغلقها. */
  finish(matchId: string, playerId: string): ActiveMatch {
    const match = this.active.get(matchId);
    if (!match || match.playerId !== playerId) {
      throw badRequest('match_unknown', 'الجولة غير معروفة أو انتهت صلاحيتها');
    }
    this.active.delete(matchId);
    return match;
  }

  private sweep(): void {
    const cutoff = Date.now() - MATCH_TTL_MS;
    for (const [id, match] of this.active) {
      if (match.startedAt < cutoff) this.active.delete(id);
    }
  }
}
