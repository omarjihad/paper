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
  /** أي صيغة لسلسلة التحقق طابقت — للتشخيص فقط. */
  variant: 'with-signature' | 'without-signature';
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

  // الصيغة المعتمدة: كل الحقول عدا hash — بما فيها signature.
  let variant: VerifiedInitData['variant'] | null = null;
  if (safeEqualHex(computeHash(params, botToken, true), hash)) {
    variant = 'with-signature';
  } else if (params.has('signature') && safeEqualHex(computeHash(params, botToken, false), hash)) {
    // احتياط: بعض العملاء لا يُدخلون signature في سلسلة HMAC.
    variant = 'without-signature';
  }

  if (!variant) {
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

  return { user, authDate, variant };
}

/**
 * سلسلة التحقق: كل الحقول عدا hash، مرتّبة أبجديًا **بالمفتاح**،
 * بصيغة key=value ومفصولة بسطر جديد.
 *
 * حقل signature يبقى داخل السلسلة في فحص HMAC — استبعاده خاص بمسار
 * التحقق الخارجي (Ed25519) وحده، واستبعاده هنا يكسر التحقق تمامًا.
 */
function buildDataCheckString(params: URLSearchParams, includeSignature: boolean): string {
  const pairs: Array<[string, string]> = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    if (key === 'signature' && !includeSignature) continue;
    pairs.push([key, value]);
  }
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return pairs.map(([key, value]) => `${key}=${value}`).join('\n');
}

function computeHash(params: URLSearchParams, botToken: string, includeSignature: boolean): string {
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secretKey)
    .update(buildDataCheckString(params, includeSignature))
    .digest('hex');
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
    const withSignature = botToken ? computeHash(params, botToken, true) : '';
    const withoutSignature = botToken ? computeHash(params, botToken, false) : '';
    return (
      `الحقول=[${keys}] منذ_التوقيع=${age}ث ` +
      `hash_المستلم=${received.slice(0, 10)}… ` +
      `مع_signature=${withSignature.slice(0, 10)}… بدون_signature=${withoutSignature.slice(0, 10)}… ` +
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
