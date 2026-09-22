import type { PlayerProfile } from '@riqaa/shared';
import { h } from './dom.js';

const GRADIENTS: ReadonlyArray<[string, string]> = [
  ['#35E0A1', '#17B980'],
  ['#7C5CFF', '#5433D6'],
  ['#3FA9FF', '#1E6FD9'],
  ['#FFB443', '#E0842A'],
  ['#FF6B6B', '#D63F55'],
  ['#38D6D6', '#199C9C'],
];

/** صورة رمزية مولّدة: حرف الاسم فوق تدرّج ثابت مشتق من المعرّف. */
export function generateAvatar(profile: PlayerProfile): string {
  const seed = hash(profile.telegramId);
  const [from, to] = GRADIENTS[seed % GRADIENTS.length];
  const initial = firstCharacter(profile.firstName);

  const background = `<rect width="120" height="120" rx="34" fill="url(#g)"/>`;
  const gradient = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
  </linearGradient></defs>`;
  const label = `<text x="60" y="60" font-family="Cairo, sans-serif" font-size="54" font-weight="700"
        fill="#0E1420" text-anchor="middle" dominant-baseline="central">${escapeXml(initial)}</text>`;

  const withLabel = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${gradient}${background}${label}</svg>`;
  const plain = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${gradient}${background}</svg>`;

  // حزام أمان: أي محرف يعجز encodeURIComponent عنه يُسقط الحرف لا الصورة.
  return toDataUri(withLabel) ?? toDataUri(plain) ?? TRANSPARENT_PIXEL;
}

const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function toDataUri(svg: string): string | null {
  try {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } catch {
    return null;
  }
}

/**
 * أول محرف حقيقي من الاسم.
 * القراءة بالنقاط البرمجية لا بوحدات الترميز: الأسماء التي تبدأ بإيموجي
 * تتكوّن من زوج بديل، وأخذ نصفه يُنتج نصفًا يتيمًا يكسر encodeURIComponent.
 */
function firstCharacter(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '؟';
  const first = Array.from(trimmed)[0] ?? '؟';
  // نصف بديل يتيم (اسم مشوّه أصلًا) — لا نعرضه إطلاقًا.
  const code = first.codePointAt(0) ?? 0;
  if (code >= 0xd800 && code <= 0xdfff) return '؟';
  return first.toUpperCase();
}

/** صورة تيليجرام إن وُجدت، وإلا الصورة المولّدة — مع تراجع تلقائي عند فشل التحميل. */
export function avatarElement(profile: PlayerProfile, className = 'avatar'): HTMLImageElement {
  const fallback = generateAvatar(profile);
  const image = h('img', {
    class: className,
    alt: `صورة ${profile.firstName}`,
    src: profile.avatarUrl ?? fallback,
    loading: 'lazy',
    decoding: 'async',
  });
  image.addEventListener('error', () => {
    if (image.src !== fallback) image.src = fallback;
  });
  return image;
}

function hash(value: string): number {
  let result = 0;
  for (let i = 0; i < value.length; i++) result = (result * 31 + value.charCodeAt(i)) >>> 0;
  return result;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => {
    switch (character) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      default:
        return '&quot;';
    }
  });
}
