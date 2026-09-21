import type { AuthResponse } from '@riqaa/shared';
import { avatarElement } from './avatar.js';
import { h } from './dom.js';

/** القائمة الرئيسية: هوية اللاعب + زر واحد واضح. لا حشو. */
export function menuScreen(session: AuthResponse, onPlay: () => void): HTMLElement {
  const player = session.player;
  const fullName = [player.firstName, player.lastName].filter(Boolean).join(' ');

  const identityBadge =
    session.source === 'telegram'
      ? h('div', { class: 'badge', text: 'متصل عبر تيليجرام' })
      : h('div', { class: 'badge badge--guest', text: 'وضع ضيف — للتطوير فقط' });

  const playButton = h('button', { class: 'btn', type: 'button', onclick: onPlay }, ['العب الآن']);

  return h('div', { class: 'screen menu' }, [
    h('div', { class: 'brand' }, [
      h('div', { class: 'brand__mark' }),
      h('div', {}, [
        h('div', { class: 'brand__name', text: 'رقعة' }),
        h('div', { class: 'brand__tag', text: 'سيطر على أكبر مساحة' }),
      ]),
    ]),

    h('div', { class: 'card' }, [
      h('div', { class: 'profile' }, [
        avatarElement(player),
        h('div', { style: 'min-width:0' }, [
          h('h1', { class: 'profile__name', text: fullName || 'لاعب' }),
          player.username
            ? h('div', { class: 'profile__username', text: `@${player.username}` })
            : null,
          identityBadge,
        ]),
      ]),
      h('div', { class: 'stats' }, [
        h('div', { class: 'stat' }, [
          h('div', { class: 'stat__value', text: String(player.stats.rounds) }),
          h('div', { class: 'stat__label', text: 'الجولات' }),
        ]),
        h('div', { class: 'stat' }, [
          h('div', { class: 'stat__value', text: `${player.stats.bestAreaPercent.toFixed(2)}٪` }),
          h('div', { class: 'stat__label', text: 'أفضل مساحة' }),
        ]),
      ]),
    ]),

    h('div', { class: 'card how' }, [
      row('اخرج من أرضك، ارسم مسارًا، ثم عُد إليها لتضم ما أحطت به.'),
      row('داخل أرضك أنت آمن. خارجها مسارك مكشوف.'),
      row('من يقطع مسارك يُخرجك من الجولة — وأنت تستطيع فعل المثل.'),
    ]),

    h('div', { class: 'spacer' }),
    playButton,
    h('div', {
      class: 'note',
      text: 'خصومك في هذه المرحلة بوتات داخل اللعبة، وليسوا لاعبين حقيقيين.',
    }),
  ]);
}

function row(text: string): HTMLElement {
  return h('div', { class: 'how__row' }, [h('div', { class: 'how__dot' }), h('div', { text })]);
}
