import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IdentitySource } from '@riqaa/shared';
import { unauthorized } from '../../core/errors.js';

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
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export function verifyToken(token: string, secret: string): SessionPayload {
  const [body, signature] = token.split('.');
  if (!body || !signature) throw unauthorized('token_invalid', 'جلسة غير صالحة');

  const expected = sign(body, secret);
  if (expected.length !== signature.length) throw unauthorized('token_invalid', 'جلسة غير صالحة');
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    throw unauthorized('token_invalid', 'جلسة غير صالحة');
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
  } catch {
    throw unauthorized('token_invalid', 'جلسة غير صالحة');
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw unauthorized('token_expired', 'انتهت صلاحية الجلسة، أعد فتح اللعبة');
  }
  return payload;
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}
