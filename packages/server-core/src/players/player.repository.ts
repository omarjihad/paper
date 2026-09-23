import type { PlayerProfile } from '@riqaa/shared';

export interface UpsertPlayerInput {
  telegramId: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  avatarUrl: string | null;
}

/**
 * عقد تخزين اللاعبين. الطبقة الأعلى لا تعرف إن كان التخزين مونغو أم ذاكرة
 * أم تخزين Durable Object — لذلك تبديل قاعدة البيانات لا يمس منطق اللعبة.
 */
export interface PlayerRepository {
  readonly kind: 'mongodb' | 'memory' | 'durable';
  upsertOnLogin(input: UpsertPlayerInput): Promise<PlayerProfile>;
  findById(telegramId: string): Promise<PlayerProfile | null>;
  touch(telegramId: string): Promise<void>;
  recordRoundResult(telegramId: string, areaPercent: number): Promise<PlayerProfile>;
  close(): Promise<void>;
}

export function emptyProfile(input: UpsertPlayerInput, now: string): PlayerProfile {
  return {
    telegramId: input.telegramId,
    firstName: input.firstName,
    lastName: input.lastName,
    username: input.username,
    avatarUrl: input.avatarUrl,
    createdAt: now,
    lastSeen: now,
    stats: { rounds: 0, bestAreaPercent: 0 },
  };
}
