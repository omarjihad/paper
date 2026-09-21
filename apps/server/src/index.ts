import { buildApp } from './app.js';
import { loadEnv } from './core/env.js';
import { createPlayerRepository } from './infra/repository.factory.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const players = await createPlayerRepository(env, (message) => console.log(`[riqaa] ${message}`));
  const app = await buildApp({ env, players });

  if (!env.telegramBotToken) {
    app.log.warn(
      'TELEGRAM_BOT_TOKEN غير مضبوط: التحقق من هوية تيليجرام معطّل. اضبطه قبل النشر الحقيقي.',
    );
  }
  if (env.devAllowGuest) {
    app.log.warn('DEV_ALLOW_GUEST مفعّل: يُسمح بدخول ضيف خارج تيليجرام. أوقفه في الإنتاج.');
  }

  const shutdown = async (signal: string) => {
    app.log.info(`إيقاف الخادم (${signal})`);
    await app.close();
    await players.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.port, host: env.host });
}

main().catch((error) => {
  console.error('فشل إقلاع الخادم:', error);
  process.exit(1);
});
