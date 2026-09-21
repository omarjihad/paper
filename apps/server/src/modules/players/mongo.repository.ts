import { MongoClient, type Collection, type Db } from 'mongodb';
import type { PlayerProfile } from '@riqaa/shared';
import { emptyProfile, type PlayerRepository, type UpsertPlayerInput } from './player.repository.js';

interface PlayerDocument extends PlayerProfile {
  _id: string;
}

/** تخزين دائم للملف الشخصي فقط — لا تُكتب حركة اللاعب هنا إطلاقًا. */
export class MongoPlayerRepository implements PlayerRepository {
  readonly kind = 'mongodb' as const;
  private readonly players: Collection<PlayerDocument>;

  private constructor(
    private readonly client: MongoClient,
    db: Db,
  ) {
    this.players = db.collection<PlayerDocument>('players');
  }

  static async connect(uri: string, dbName: string): Promise<MongoPlayerRepository> {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 4000 });
    await client.connect();
    const repository = new MongoPlayerRepository(client, client.db(dbName));
    await repository.players.createIndex({ lastSeen: -1 });
    return repository;
  }

  async upsertOnLogin(input: UpsertPlayerInput): Promise<PlayerProfile> {
    const now = new Date().toISOString();
    const base = emptyProfile(input, now);
    const result = await this.players.findOneAndUpdate(
      { _id: input.telegramId },
      {
        $set: {
          firstName: input.firstName,
          lastName: input.lastName,
          username: input.username,
          avatarUrl: input.avatarUrl,
          lastSeen: now,
        },
        $setOnInsert: {
          telegramId: base.telegramId,
          createdAt: now,
          stats: base.stats,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    return toProfile(result ?? { ...base, _id: base.telegramId });
  }

  async findById(telegramId: string): Promise<PlayerProfile | null> {
    const document = await this.players.findOne({ _id: telegramId });
    return document ? toProfile(document) : null;
  }

  async touch(telegramId: string): Promise<void> {
    await this.players.updateOne({ _id: telegramId }, { $set: { lastSeen: new Date().toISOString() } });
  }

  async recordRoundResult(telegramId: string, areaPercent: number): Promise<PlayerProfile> {
    const now = new Date().toISOString();
    const result = await this.players.findOneAndUpdate(
      { _id: telegramId },
      {
        $inc: { 'stats.rounds': 1 },
        $max: { 'stats.bestAreaPercent': areaPercent },
        $set: { lastSeen: now },
      },
      { returnDocument: 'after' },
    );
    if (!result) throw new Error(`لاعب غير موجود: ${telegramId}`);
    return toProfile(result);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

function toProfile(document: PlayerDocument): PlayerProfile {
  return {
    telegramId: document.telegramId ?? document._id,
    firstName: document.firstName,
    lastName: document.lastName ?? null,
    username: document.username ?? null,
    avatarUrl: document.avatarUrl ?? null,
    createdAt: document.createdAt,
    lastSeen: document.lastSeen,
    stats: {
      rounds: document.stats?.rounds ?? 0,
      bestAreaPercent: document.stats?.bestAreaPercent ?? 0,
    },
  };
}
