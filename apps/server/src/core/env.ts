import { createHmac } from 'node:crypto';
import { DEFAULT_REGION, isRegionId, type RegionId } from '@riqaa/shared';

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
  /**
   * المنطقة التي يعمل منها هذا الخادم فعلًا.
   * تُعرض للاعبين كالمنطقة الوحيدة القابلة للقياس — لا نخترع مناطق لا نستضيفها.
   */
  serverRegion: RegionId;
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
    serverRegion: resolveRegion(clean(process.env.SERVER_REGION)),
  };
}

function resolveRegion(value: string): RegionId {
  const lower = value.toLowerCase();
  return isRegionId(lower) ? lower : DEFAULT_REGION;
}

/**
 * العنوان العام للخدمة.
 * PUBLIC_URL يتقدّم دائمًا؛ وإلا نأخذ العنوان الذي تضعه الاستضافة في بيئتها —
 * بلا افتراض أي دومين ثابت. بدونه لا يُسجَّل webhook البوت فلا يرد على /start.
 */
function resolvePublicUrl(): string {
  const explicit = clean(process.env.PUBLIC_URL);
  if (explicit) return normalizeUrl(explicit);

  for (const key of ['RAILWAY_PUBLIC_DOMAIN', 'RENDER_EXTERNAL_URL', 'FLY_APP_NAME']) {
    const value = clean(process.env[key]);
    if (!value) continue;
    return normalizeUrl(key === 'FLY_APP_NAME' ? `${value}.fly.dev` : value);
  }

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
