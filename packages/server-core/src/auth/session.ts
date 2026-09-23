import {
  fromBase64Url,
  fromUtf8,
  hmacBase64Url,
  timingSafeEqual,
  toBase64Url,
  utf8,
} from '../crypto/index.js';
import type { IdentitySource } from '@riqaa/shared';
import { unauthorized } from '../core/errors.js';

export interface SessionPayload {
  sub: string;
  src: IdentitySource;
  exp: number;
}

const TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * رمز جلسة موقَّع (HMAC) — بلا اعتماد خارجي.
 * الرمز يثبت فقط أن الخادم هو من أصدره بعد تحقق ناجح من تيليجرام.
 */
export function issueToken(subject: string, source: IdentitySource, secret: string): string {
  const payload: SessionPayload = {
    sub: subject,
    src: source,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  };
  const body = toBase64Url(utf8(JSON.stringify(payload)));
  return `${body}.${hmacBase64Url(secret, body)}`;
}

export function verifyToken(token: string, secret: string): SessionPayload {
  const [body, signature] = token.split('.');
  if (!body || !signature) throw unauthorized('token_invalid', 'جلسة غير صالحة');

  const expected = hmacBase64Url(secret, body);
  if (!timingSafeEqual(utf8(expected), utf8(signature))) {
    throw unauthorized('token_invalid', 'جلسة غير صالحة');
  }

  const raw = fromBase64Url(body);
  if (!raw) throw unauthorized('token_invalid', 'جلسة غير صالحة');

  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromUtf8(raw)) as SessionPayload;
  } catch {
    throw unauthorized('token_invalid', 'جلسة غير صالحة');
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw unauthorized('token_expired', 'انتهت صلاحية الجلسة، أعد فتح اللعبة');
  }
  return payload;
}
