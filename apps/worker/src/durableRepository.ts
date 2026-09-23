import type { PlayerProfile } from '@riqaa/shared';
import { emptyProfile, type PlayerRepository, type UpsertPlayerInput } from '@riqaa/server-core';

const KEY_PREFIX = 'player:';

/**
 * ملفّات اللاعبين داخل تخزين الـDurable Object.
 *
 * التخزين هنا دائم ومكانه مع الغرف نفسها، فقراءة ملفّ لاعب أثناء الجولة لا
 * تعبر الشبكة. نحتفظ بنسخة في الذاكرة لأن الحلقة تقرأ الاسم كثيرًا، ونكتب
 * إلى التخزين في كل تعديل كي لا يضيع شيء عند إعادة تشغيل الكائن.
 */
export class DurablePlayerRepository implements PlayerRepository {
  readonly kind = 'durable' as const;
  private readonly cache = new Map<string, PlayerProfile>();

  constructor(private readonly storage: DurableObjectStorage) {}

  async upsertOnLogin(input: UpsertPlayerInput): Promise<PlayerProfile> {
    const now = new Date().toISOString();
    const existing = await this.read(input.telegramId);
    const profile: PlayerProfile = existing
      ? {
          ...existing,
          firstName: input.firstName,
          lastName: input.lastName,
          username: input.username,
          avatarUrl: input.avatarUrl,
          lastSeen: now,
        }
      : emptyProfile(input, now);
    await this.write(profile);
    return clone(profile);
  }

  async findById(telegramId: string): Promise<PlayerProfile | null> {
    const profile = await this.read(telegramId);
    return profile ? clone(profile) : null;
  }

  async touch(telegramId: string): Promise<void> {
    const profile = await this.read(telegramId);
    if (!profile) return;
    await this.write({ ...profile, lastSeen: new Date().toISOString() });
  }

  async recordRoundResult(telegramId: string, areaPercent: number): Promise<PlayerProfile> {
    const profile = await this.read(telegramId);
    if (!profile) throw new Error(`لاعب غير موجود: ${telegramId}`);
    const updated: PlayerProfile = {
      ...profile,
      lastSeen: new Date().toISOString(),
      stats: {
        rounds: profile.stats.rounds + 1,
        bestAreaPercent: Math.max(profile.stats.bestAreaPercent, areaPercent),
      },
    };
    await this.write(updated);
    return clone(updated);
  }

  async close(): Promise<void> {
    this.cache.clear();
  }

  private async read(telegramId: string): Promise<PlayerProfile | null> {
    const cached = this.cache.get(telegramId);
    if (cached) return cached;
    const stored = await this.storage.get<PlayerProfile>(KEY_PREFIX + telegramId);
    if (stored) this.cache.set(telegramId, stored);
    return stored ?? null;
  }

  private async write(profile: PlayerProfile): Promise<void> {
    this.cache.set(profile.telegramId, profile);
    await this.storage.put(KEY_PREFIX + profile.telegramId, profile);
  }
}

function clone(profile: PlayerProfile): PlayerProfile {
  return { ...profile, stats: { ...profile.stats } };
}
