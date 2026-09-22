import { createHmac } from 'node:crypto';

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
  /** العنوان العام للخدمة (بلا شرطة في آخره)، أو فارغ إن تعذّر تحديده. */
  publicUrl: string;
  /** رمز حماية webhook تيليجرام. */
  telegramWebhookSecret: string;
}

/**
 * ينظّف قيمة قادمة من لوحة الاستضافة: مسافات أو سطر جديد أو علامات اقتباس
 * تُلصق مع القيمة بسهولة، وتكسر توقيع HMAC بصمت.
 */
function clean(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
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
    telegramBotToken: clean(process.env.TELEGRAM_BOT_TOKEN),
    sessionSecret: clean(process.env.SESSION_SECRET) || DEV_SESSION_SECRET,
    // دخول الضيف وسيلة تطوير: مغلق تلقائيًا في الإنتاج ما لم يُطلب صراحةً.
    devAllowGuest: bool(process.env.DEV_ALLOW_GUEST, !isProduction),
    mongoUri: process.env.MONGODB_URI ?? '',
    mongoDb: process.env.MONGODB_DB ?? 'riqaa',
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
    initDataMaxAge: Number(process.env.INIT_DATA_MAX_AGE ?? 86400),
    publicUrl: resolvePublicUrl(),
    telegramWebhookSecret: resolveWebhookSecret(clean(process.env.SESSION_SECRET) || DEV_SESSION_SECRET),
  };
}

/**
 * العنوان العام للخدمة.
 * PUBLIC_URL يتقدّم دائمًا؛ وإلا نأخذ دومين Railway من بيئته — بلا افتراض أي دومين ثابت.
 */
function resolvePublicUrl(): string {
  const explicit = clean(process.env.PUBLIC_URL);
  if (explicit) return normalizeUrl(explicit);

  const railway = clean(process.env.RAILWAY_PUBLIC_DOMAIN);
  if (railway) return normalizeUrl(railway);

  return '';
}

function normalizeUrl(value: string): string {
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, '');
}

/**
 * رمز حماية الـwebhook: يؤخذ من البيئة إن وُجد، وإلا يُشتق من SESSION_SECRET.
 * الاشتقاق ثابت عبر عمليات إعادة التشغيل، فلا يبطل التسجيل السابق لدى تيليجرام.
 */
function resolveWebhookSecret(sessionSecret: string): string {
  const explicit = clean(process.env.TELEGRAM_WEBHOOK_SECRET);
  // تيليجرام يقبل A-Z a-z 0-9 _ - فقط، بطول 1..256.
  if (explicit) return explicit.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 256);
  return createHmac('sha256', sessionSecret).update('riqaa-telegram-webhook').digest('hex').slice(0, 48);
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
