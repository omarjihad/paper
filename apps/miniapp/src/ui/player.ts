import type { PlayerProfile } from '@riqaa/shared';

/**
 * المستوى ثابت عند 1 في هذه المرحلة: لا يوجد نظام خبرة بعد،
 * وعرض رقم محسوب من لا شيء سيكون بيانات مخترعة.
 */
export const PLAYER_LEVEL = 1;

export function displayName(player: PlayerProfile): string {
  return [player.firstName, player.lastName].filter(Boolean).join(' ') || 'لاعب';
}

/** يخفي المعرّف عن النظرة العادية ويُبقي آخر أربعة أرقام للتعرّف. */
export function maskedId(telegramId: string): string {
  const raw = telegramId.startsWith('guest:') ? telegramId.slice(6) : telegramId;
  const tail = raw.slice(-4);
  return `${'•'.repeat(Math.max(4, Math.min(8, raw.length - tail.length)))}${tail}`;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(2)}٪`;
}
