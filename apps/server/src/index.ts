import { buildApp } from './app.js';
import { assertProductionConfig, loadEnv, type Env } from './core/env.js';
import { createPlayerRepository } from './infra/repository.factory.js';
import { TelegramBot } from './modules/bot/bot.service.js';
import { TelegramApi } from './modules/bot/telegram.api.js';

/** مسار الـwebhook — ثابت ومعروف للطرفين. */
const WEBHOOK_PATH = '/api/telegram/webhook';

async function main(): Promise<void> {
  const env = loadEnv();

  const problems = assertProductionConfig(env);
  if (problems.length > 0) {
    console.error('\nتعذّر الإقلاع في وضع الإنتاج بسبب إعدادات ناقصة:');
    for (const problem of problems) console.error(`  • ${problem}`);
    console.error('\nاضبط هذه المتغيّرات في بيئة الاستضافة ثم أعد التشغيل.\n');
    process.exit(1);
  }

  const players = await createPlayerRepository(env, (message) => console.log(`[riqaa] ${message}`));

  // البوت اختياري: بدون توكن أو بدون عنوان عام يبقى مسار الـwebhook معطّلًا.
  const bot =
    env.telegramBotToken && env.publicUrl
      ? new TelegramBot(new TelegramApi(env.telegramBotToken), env.publicUrl, {
          info: (message) => console.log(`[riqaa] ${message}`),
          warn: (message) => console.warn(`[riqaa] ${message}`),
          error: (message) => console.error(`[riqaa] ${message}`),
        })
      : null;

  const app = await buildApp({ env, players, bot });

  if (!env.telegramBotToken) {
    app.log.warn(
      'TELEGRAM_BOT_TOKEN غير مضبوط: التحقق من هوية تيليجرام معطّل. اضبطه قبل النشر الحقيقي.',
    );
  }
  if (env.devAllowGuest) {
    app.log.warn(
      env.isProduction
        ? 'DEV_ALLOW_GUEST مفعّل في الإنتاج: أي شخص يستطيع الدخول بلا تيليجرام. أوقفه.'
        : 'DEV_ALLOW_GUEST مفعّل: يُسمح بدخول ضيف خارج تيليجرام. أوقفه في الإنتاج.',
    );
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

  // التسجيل بعد بدء الاستماع كي يكون المسار جاهزًا قبل أول تحديث من تيليجرام.
  await setupWebhook(env, bot, app.log);
}

/** يسجّل الـwebhook في الإنتاج فقط، وفشله لا يُسقط الخادم. */
async function setupWebhook(
  env: Env,
  bot: TelegramBot | null,
  log: { info(message: string): void; warn(message: string): void; error(message: string): void },
): Promise<void> {
  if (!env.isProduction) {
    log.info('تسجيل webhook تيليجرام يعمل في الإنتاج فقط — تم تخطّيه.');
    return;
  }
  if (!env.telegramBotToken) {
    log.warn('لا يمكن تسجيل webhook تيليجرام: TELEGRAM_BOT_TOKEN غير مضبوط.');
    return;
  }
  if (!env.publicUrl) {
    log.warn(
      'لا يمكن تسجيل webhook تيليجرام: تعذّر تحديد العنوان العام. اضبط PUBLIC_URL ' +
        '(أو فعّل الدومين العام في Railway ليتوفر RAILWAY_PUBLIC_DOMAIN).',
    );
    return;
  }
  if (!bot) return;

  const webhookUrl = `${env.publicUrl}${WEBHOOK_PATH}`;
  try {
    await bot.registerWebhook(webhookUrl, env.telegramWebhookSecret);
  } catch (error) {
    log.error(`فشل تسجيل webhook تيليجرام على ${webhookUrl}: ${(error as Error).message}`);
  }
}

main().catch((error) => {
  console.error('فشل إقلاع الخادم:', error);
  process.exit(1);
});
