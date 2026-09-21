/** إعدادات التشغيل. كل قيمة لها افتراضي آمن حتى يعمل المشروع فورًا بعد الاستنساخ. */
export interface Env {
  port: number;
  host: string;
  telegramBotToken: string;
  sessionSecret: string;
  devAllowGuest: boolean;
  mongoUri: string;
  mongoDb: string;
  corsOrigin: string;
  /** أقصى عمر مقبول لـ initData بالثواني. */
  initDataMaxAge: number;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

export function loadEnv(): Env {
  return {
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '0.0.0.0',
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    sessionSecret: process.env.SESSION_SECRET ?? 'riqaa-dev-secret-change-me',
    devAllowGuest: bool(process.env.DEV_ALLOW_GUEST, true),
    mongoUri: process.env.MONGODB_URI ?? '',
    mongoDb: process.env.MONGODB_DB ?? 'riqaa',
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    initDataMaxAge: Number(process.env.INIT_DATA_MAX_AGE ?? 86400),
  };
}
