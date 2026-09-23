import type { PlayerProfile } from '@riqaa/shared';
import { emptyProfile, type PlayerRepository, type UpsertPlayerInput } from './player.repository.js';

/**
 * تخزين في الذاكرة — يجعل المشروع قابلًا للتشغيل فورًا بدون MongoDB.
 * البيانات تضيع عند إعادة التشغيل، وهذا مقصود للتطوير فقط.
 */
export class MemoryPlayerRepository implements PlayerRepository {
  readonly kind = 'memory' as const;
  private readonly players = new Map<string, PlayerProfile>();

  async upsertOnLogin(input: UpsertPlayerInput): Promise<PlayerProfile> {
    const now = new Date().toISOString();
    const existing = this.players.get(input.telegramId);
    if (!existing) {
      const created = emptyProfile(input, now);
      this.players.set(created.telegramId, created);
      return { ...created, stats: { ...created.stats } };
    }
    existing.firstName = input.firstName;
    existing.lastName = input.lastName;
    existing.username = input.username;
    existing.avatarUrl = input.avatarUrl;
    existing.lastSeen = now;
    return { ...existing, stats: { ...existing.stats } };
  }

  async findById(telegramId: string): Promise<PlayerProfile | null> {
    const player = this.players.get(telegramId);
    return player ? { ...player, stats: { ...player.stats } } : null;
  }

  async touch(telegramId: string): Promise<void> {
    const player = this.players.get(telegramId);
    if (player) player.lastSeen = new Date().toISOString();
  }

  async recordRoundResult(telegramId: string, areaPercent: number): Promise<PlayerProfile> {
    const player = this.players.get(telegramId);
    if (!player) throw new Error(`لاعب غير موجود: ${telegramId}`);
    player.stats.rounds += 1;
    player.stats.bestAreaPercent = Math.max(player.stats.bestAreaPercent, areaPercent);
    player.lastSeen = new Date().toISOString();
    return { ...player, stats: { ...player.stats } };
  }

  async close(): Promise<void> {
    this.players.clear();
  }
}
