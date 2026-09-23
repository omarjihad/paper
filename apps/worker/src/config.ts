import { DEFAULT_REGION, isRegionId, type RegionId } from '@riqaa/shared';
import { hmacHex, type RuntimeConfig } from '@riqaa/server-core';

/** قيمة تطوير معروفة — لا يُسمح بها في الإنتاج إطلاقًا. */
export const DEV_SESSION_SECRET = 'riqaa-dev-secret-change-me';

/** الارتباطات والأسرار كما تصل من Cloudflare. */
export interface WorkerEnv {
  GAME: DurableObjectNamespace;
  ASSETS: Fetcher;
  SESSION_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  DEV_ALLOW_GUEST?: string;
  SERVER_REGION?: string;
  INIT_DATA_MAX_AGE?: string;
  PUBLIC_URL?: string;
  /**
   * المنطقة التي يُطلب من Cloudflare إنشاء الكائن فيها.
   * التلميح يُقرأ عند أول إنشاء فقط، ولا يُعاد النظر فيه بعدها.
   */
  DO_LOCATION_HINT?: string;
}

/**
 * ينظّف قيمة قادمة من لوحة الإعدادات: مسافات أو سطر جديد أو علامات اقتباس
 * تُلصق مع القيمة بسهولة، وتكسر توقيع HMAC بصمت.
 */
export function clean(value: string | undefined): string {
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
  const cleaned = clean(value);
  if (cleaned === '') return fallback;
  return cleaned === '1' || cleaned.toLowerCase() === 'true';
}

export function runtimeConfig(env: WorkerEnv): RuntimeConfig {
  const region = clean(env.SERVER_REGION).toLowerCase();
  return {
    sessionSecret: clean(env.SESSION_SECRET) || DEV_SESSION_SECRET,
    telegramBotToken: clean(env.TELEGRAM_BOT_TOKEN),
    initDataMaxAge: Number(clean(env.INIT_DATA_MAX_AGE) || 86400),
    // دخول الضيف وسيلة تطوير: مغلق ما لم يُطلب صراحةً.
    devAllowGuest: bool(env.DEV_ALLOW_GUEST, false),
    serverRegion: isRegionId(region) ? (region as RegionId) : DEFAULT_REGION,
  };
}

/**
 * رمز حماية الـwebhook: من الإعدادات إن وُجد، وإلا يُشتق من SESSION_SECRET.
 * الاشتقاق ثابت، فلا يبطل التسجيل السابق لدى تيليجرام عند كل نشر.
 */
export function webhookSecret(env: WorkerEnv): string {
  const explicit = clean(env.TELEGRAM_WEBHOOK_SECRET);
  // تيليجرام يقبل A-Z a-z 0-9 _ - فقط، بطول 1..256.
  if (explicit) return explicit.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 256);
  return hmacHex(clean(env.SESSION_SECRET) || DEV_SESSION_SECRET, 'riqaa-telegram-webhook').slice(0, 48);
}

/**
 * يرفض الإقلاع بإعدادات غير آمنة بدل تشغيل خادم مكشوف بصمت.
 * لا يمنع التطوير المحلي: هناك دخول الضيف مفتوح صراحةً.
 */
export function configProblems(config: RuntimeConfig): string[] {
  const problems: string[] = [];
  if (!config.sessionSecret || config.sessionSecret === DEV_SESSION_SECRET) {
    problems.push('SESSION_SECRET غير مضبوط (أو ما زال قيمة التطوير) — بدونه يمكن تزوير جلسات اللاعبين.');
  }
  if (!config.telegramBotToken && !config.devAllowGuest) {
    problems.push('TELEGRAM_BOT_TOKEN غير مضبوط — لن يستطيع أي لاعب الدخول لأن التحقق من تيليجرام معطّل.');
  }
  return problems;
}
