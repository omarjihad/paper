import type { AuthResponse } from '@riqaa/shared';
import { avatarElement } from './avatar.js';
import { h } from './dom.js';
import { PLAYER_LEVEL, displayName, formatPercent, maskedId } from './player.js';

/**
 * صفحة الملف الشخصي.
 * ما لا يُحتسب بعد يُعرض صفرًا ومكتومًا — لا أرقام مخترعة.
 */
export function profilePage(session: AuthResponse): HTMLElement {
  const player = session.player;

  return h('div', { class: 'page page--profile' }, [
    h('div', { class: 'card' }, [
      h('div', { class: 'profile-head' }, [
        avatarElement(player, 'avatar avatar--lg'),
        h('h1', { class: 'profile-head__name', text: displayName(player) }),
        player.username
          ? h('div', { class: 'identity__username', text: `@${player.username}` })
          : h('div', { class: 'identity__username', text: 'لا يوجد اسم مستخدم' }),
        h('div', { class: 'badge badge--level', text: `المستوى ${PLAYER_LEVEL}` }),
      ]),
    ]),

    h('div', { class: 'section-title', text: 'الإحصاءات' }),
    h('div', { class: 'card' }, [
      h('div', { class: 'stats', style: 'margin-top:0' }, [
        stat(String(player.stats.rounds), 'الجولات'),
        stat(formatPercent(player.stats.bestAreaPercent), 'أفضل مساحة'),
        stat('0', 'مرات الفوز', true),
        stat('0.00٪', 'المساحة المسيطر عليها', true),
      ]),
      h('div', {
        class: 'note',
        style: 'margin-top:12px',
        text: 'مرات الفوز والمساحة الإجمالية لا تُحتسب بعد، لذلك تظهر بصفر.',
      }),
    ]),

    h('div', { class: 'section-title', text: 'الحساب' }),
    h('div', { class: 'card' }, [
      row('الاسم', displayName(player)),
      row('اسم المستخدم', player.username ? `@${player.username}` : '—'),
      identifierRow(player.telegramId),
      row('عضو منذ', formatDate(player.createdAt)),
    ]),

    h('div', { class: 'spacer' }),
  ]);
}

function stat(value: string, label: string, muted = false): HTMLElement {
  return h('div', { class: muted ? 'stat stat--muted' : 'stat' }, [
    h('div', { class: 'stat__value', text: value }),
    h('div', { class: 'stat__label', text: label }),
  ]);
}

function row(label: string, value: string): HTMLElement {
  return h('div', { class: 'row' }, [
    h('div', { class: 'row__label', text: label }),
    // dir="auto" يترك المتصفح يختار الاتجاه من المحتوى:
    // الاسم عربي، اسم المستخدم لاتيني، والتاريخ لا ينكسر.
    h('div', { class: 'row__value', dir: 'auto', text: value }),
  ]);
}

/** المعرّف مخفي افتراضيًا ويظهر عند الطلب فقط. */
function identifierRow(telegramId: string): HTMLElement {
  let revealed = false;
  const value = h('div', { class: 'row__value', dir: 'auto', text: maskedId(telegramId) });
  const toggle = h('button', { class: 'row__reveal', type: 'button' }, ['إظهار']);

  toggle.addEventListener('click', () => {
    revealed = !revealed;
    value.textContent = revealed ? telegramId : maskedId(telegramId);
    toggle.textContent = revealed ? 'إخفاء' : 'إظهار';
  });

  return h('div', { class: 'row' }, [
    h('div', { class: 'row__label', text: 'معرّف تيليجرام' }),
    h('div', { style: 'display:flex;align-items:center;gap:8px;min-width:0' }, [value, toggle]),
  ]);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar', { dateStyle: 'medium' }).format(date);
}
