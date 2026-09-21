import type { Env } from '../core/env.js';
import { MemoryPlayerRepository } from '../modules/players/memory.repository.js';
import { MongoPlayerRepository } from '../modules/players/mongo.repository.js';
import type { PlayerRepository } from '../modules/players/player.repository.js';

/**
 * يختار التخزين المناسب: مونغو إن كان متاحًا، وإلا ذاكرة مؤقتة.
 * فشل الاتصال لا يُسقط اللعبة — يُسجَّل تحذير ويستمر التشغيل.
 */
export async function createPlayerRepository(
  env: Env,
  log: (message: string) => void,
): Promise<PlayerRepository> {
  if (!env.mongoUri) {
    log('MONGODB_URI غير مضبوط — التشغيل بتخزين مؤقت في الذاكرة (بيانات اللاعبين لن تبقى بعد إعادة التشغيل)');
    return new MemoryPlayerRepository();
  }
  try {
    const repository = await MongoPlayerRepository.connect(env.mongoUri, env.mongoDb);
    log(`متصل بـ MongoDB (قاعدة: ${env.mongoDb})`);
    return repository;
  } catch (error) {
    log(`تعذّر الاتصال بـ MongoDB (${(error as Error).message}) — التشغيل بتخزين مؤقت في الذاكرة`);
    return new MemoryPlayerRepository();
  }
}
