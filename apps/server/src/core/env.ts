/** قيمة تطوير معروفة — لا يُسمح بها في الإنتاج إطلاقًا. */
export const DEV_SESSION_SECRET = 'riqaa-dev-secret-change-me';

/** إعدادات التشغيل. كل قيمة لها افتراضي آمن حتى يعمل المشروع فورًا بعد الاستنساخ. */
export interface Env {
  isProduction: boolean;
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
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    isProduction,
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '0.0.0.0',
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    sessionSecret: process.env.SESSION_SECRET ?? DEV_SESSION_SECRET,
    // دخول الضيف وسيلة تطوير: مغلق تلقائيًا في الإنتاج ما لم يُطلب صراحةً.
    devAllowGuest: bool(process.env.DEV_ALLOW_GUEST, !isProduction),
    mongoUri: process.env.MONGODB_URI ?? '',
    mongoDb: process.env.MONGODB_DB ?? 'riqaa',
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    initDataMaxAge: Number(process.env.INIT_DATA_MAX_AGE ?? 86400),
  };
}

/**
 * يرفض الإقلاع في الإنتاج بإعدادات غير آمنة، بدل تشغيل خادم مكشوف بصمت.
 * لا يؤثر إطلاقًا على بيئة التطوير.
 */
export function assertProductionConfig(env: Env): string[] {
  if (!env.isProduction) return [];
  const problems: string[] = [];

  if (!env.sessionSecret || env.sessionSecret === DEV_SESSION_SECRET) {
    problems.push(
      'SESSION_SECRET غير مضبوط (أو ما زال قيمة التطوير) — بدونه يمكن تزوير جلسات اللاعبين.',
    );
  }
  if (!env.telegramBotToken && !env.devAllowGuest) {
    problems.push(
      'TELEGRAM_BOT_TOKEN غير مضبوط — لن يستطيع أي لاعب الدخول لأن التحقق من تيليجرام معطّل.',
    );
  }
  return problems;
}
