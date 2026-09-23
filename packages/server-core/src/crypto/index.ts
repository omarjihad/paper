export { sha256, hmacSha256 } from './sha256.js';
export {
  utf8,
  fromUtf8,
  toHex,
  fromHex,
  toBase64Url,
  fromBase64Url,
  timingSafeEqual,
  randomId,
} from './bytes.js';

import { hmacSha256 } from './sha256.js';
import { toBase64Url, toHex, utf8 } from './bytes.js';

/** HMAC-SHA256 بمفتاح نصّي ومخرَج ست عشري — أكثر الأشكال استعمالًا هنا. */
export function hmacHex(key: string | Uint8Array, message: string): string {
  return toHex(hmacSha256(typeof key === 'string' ? utf8(key) : key, utf8(message)));
}

/** HMAC-SHA256 بمخرَج base64url — لتوقيع رموز الجلسات. */
export function hmacBase64Url(key: string, message: string): string {
  return toBase64Url(hmacSha256(utf8(key), utf8(message)));
}

/** HMAC-SHA256 بمخرَج خام — يُستعمل مفتاحًا لـHMAC آخر (مسار تيليجرام). */
export function hmacRaw(key: string | Uint8Array, message: string): Uint8Array {
  return hmacSha256(typeof key === 'string' ? utf8(key) : key, utf8(message));
}
