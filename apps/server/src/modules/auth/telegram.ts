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

  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash' || key === 'signature') continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

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

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
