import { createHmac, timingSafeEqual } from 'node:crypto';
import { unauthorized } from '../../core/errors.js';

/** بيانات المستخدم كما يرسلها تيليجرام داخل initData. */
export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
  is_bot?: boolean;
}

export interface VerifiedInitData {
  user: TelegramUser;
  authDate: number;
}

/**
 * التحقق من initData بالطريقة الرسمية:
 *   secret = HMAC_SHA256(key = "WebAppData", data = <bot token>)
 *   hash   = HMAC_SHA256(key = secret,      data = <data_check_string>)
 *
 * لا نثق بأي حقل قادم من الواجهة قبل نجاح هذا التحقق.
 */
export function verifyInitData(initData: string, botToken: string, maxAgeSeconds: number): VerifiedInitData {
  if (!botToken) {
    throw unauthorized('bot_token_missing', 'التوكن غير مضبوط على الخادم، لا يمكن التحقق من هوية تيليجرام');
  }
  if (!initData) {
    throw unauthorized('init_data_missing', 'بيانات تيليجرام غير موجودة');
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw unauthorized('init_data_invalid', 'بيانات تيليجرام غير مكتملة');

  const computed = computeHash(params, botToken);

  if (!safeEqualHex(computed, hash)) {
    throw unauthorized('init_data_invalid', 'تعذّر التحقق من بيانات تيليجرام');
  }

  const authDate = Number(params.get('auth_date') ?? 0);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw unauthorized('init_data_invalid', 'ختم الوقت في بيانات تيليجرام غير صالح');
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (maxAgeSeconds > 0 && ageSeconds > maxAgeSeconds) {
    throw unauthorized('init_data_expired', 'انتهت صلاحية جلسة تيليجرام، أعد فتح اللعبة');
  }

  const rawUser = params.get('user');
  if (!rawUser) throw unauthorized('init_data_invalid', 'بيانات المستخدم غير موجودة');

  let user: TelegramUser;
  try {
    user = JSON.parse(rawUser) as TelegramUser;
  } catch {
    throw unauthorized('init_data_invalid', 'تعذّر قراءة بيانات المستخدم');
  }
  if (typeof user.id !== 'number' || !user.first_name) {
    throw unauthorized('init_data_invalid', 'بيانات المستخدم ناقصة');
  }

  return { user, authDate };
}

/**
 * سلسلة التحقق: كل الحقول عدا hash وsignature، مرتّبة أبجديًا **بالمفتاح**،
 * بصيغة key=value ومفصولة بسطر جديد.
 */
function buildDataCheckString(params: URLSearchParams): string {
  const pairs: Array<[string, string]> = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash' || key === 'signature') continue;
    pairs.push([key, value]);
  }
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return pairs.map(([key, value]) => `${key}=${value}`).join('\n');
}

function computeHash(params: URLSearchParams, botToken: string): string {
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secretKey).update(buildDataCheckString(params)).digest('hex');
}

/**
 * ملخّص آمن للتشخيص عند فشل التحقق — بلا توكن وبلا بيانات المستخدم.
 * طول التوكن يكشف المسافات الزائدة، والبصمتان تكشفان اختلاف البوت.
 */
export function summarizeInitData(initData: string, botToken: string): string {
  try {
    const params = new URLSearchParams(initData);
    const keys = [...params.keys()].sort().join(',');
    const authDate = Number(params.get('auth_date') ?? 0);
    const age = authDate > 0 ? Math.floor(Date.now() / 1000) - authDate : -1;
    const received = params.get('hash') ?? '';
    const computed = botToken ? computeHash(params, botToken) : '';
    return (
      `الحقول=[${keys}] منذ_التوقيع=${age}ث ` +
      `hash_المستلم=${received.slice(0, 10)}… hash_المحسوب=${computed.slice(0, 10)}… ` +
      `طول_التوكن=${botToken.length}`
    );
  } catch {
    return 'تعذّر تحليل initData';
  }
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
