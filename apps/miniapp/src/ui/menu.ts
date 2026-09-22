import type { AuthResponse } from '@riqaa/shared';
import { avatarElement } from './avatar.js';
import { h } from './dom.js';
import { icons } from './icons.js';
import { PLAYER_LEVEL, displayName, formatPercent } from './player.js';

/**
 * الصفحة الرئيسية: هوية اللاعب في الأعلى، وزر «العب الآن» هو العنصر الأبرز.
 * بطاقة اللاعب قابلة للضغط وتفتح الملف الشخصي.
 *
 * تُعاد قطعتان: محتوى قابل للتمرير، ورصيف ثابت يحمل زر اللعب —
 * كي يبقى الزر ظاهرًا حتى على أقصر الشاشات.
 */
export function menuPage(
  session: AuthResponse,
  handlers: { onPlay: () => void; onOpenProfile: () => void },
): HTMLElement[] {
  const player = session.player;

  const identityBadge =
    session.source === 'telegram'
      ? h('div', { class: 'badge', text: 'متصل عبر تيليجرام' })
      : h('div', { class: 'badge badge--guest', text: 'وضع ضيف — للتطوير فقط' });

  const profileCard = h(
    'button',
    {
      class: 'card card--tap',
      type: 'button',
      'aria-label': 'فتح الملف الشخصي',
      onclick: handlers.onOpenProfile,
    },
    [
      h('div', { class: 'identity' }, [
        avatarElement(player),
        h('div', { class: 'identity__body' }, [
          h('h1', { class: 'identity__name', text: displayName(player) }),
          player.username
            ? h('div', { class: 'identity__username', text: `@${player.username}` })
            : null,
          h('div', { class: 'badge badge--level', text: `المستوى ${PLAYER_LEVEL}` }),
        ]),
        h('div', { class: 'chevron' }, [icons.chevron(20)]),
      ]),
      h('div', { class: 'stats' }, [
        stat(String(player.stats.rounds), 'الجولات'),
        stat(formatPercent(player.stats.bestAreaPercent), 'أفضل مساحة'),
      ]),
    ],
  );

  const page = h('div', { class: 'page' }, [
    h('div', { class: 'brand' }, [
      h('img', { class: 'brand__logo', src: '/logo.svg', alt: 'شعار رقعة', width: '44', height: '44' }),
      h('div', {}, [
        h('div', { class: 'brand__name', text: 'رقعة' }),
        h('div', { class: 'brand__tag', text: 'سيطر على أكبر مساحة' }),
      ]),
    ]),

    profileCard,
    h('div', { class: 'badge-row' }, [identityBadge]),

    h('div', { class: 'card how' }, [
      how('اخرج من أرضك، ارسم مسارًا، ثم عُد إليها لتضم ما أحطت به.'),
      how('داخل أرضك أنت آمن. خارجها مسارك مكشوف.'),
      how('من يقطع مسارك يُخرجك من الجولة — وأنت تستطيع فعل المثل.'),
    ]),
  ]);

  const dock = h('div', { class: 'btn-dock' }, [
    h('button', { class: 'btn', type: 'button', onclick: handlers.onPlay }, ['العب الآن']),
    h('div', {
      class: 'note',
      text: 'خصومك في هذه المرحلة بوتات داخل اللعبة، وليسوا لاعبين حقيقيين.',
    }),
  ]);

  return [page, dock];
}

function stat(value: string, label: string): HTMLElement {
  return h('div', { class: 'stat' }, [
    h('div', { class: 'stat__value', text: value }),
    h('div', { class: 'stat__label', text: label }),
  ]);
}

function how(text: string): HTMLElement {
  return h('div', { class: 'how__row' }, [h('div', { class: 'how__dot' }), h('div', { text })]);
}
