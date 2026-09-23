import {
  LINK_GRADE_LABEL,
  gradeLink,
  type LobbyServer,
  type RegionId,
  type RegionInfo,
} from '@riqaa/shared';
import { h } from './dom.js';

export interface ServerListHandle {
  element: HTMLElement;
  /** قائمة السيرفرات كما أرسلها الخادم. */
  setServers(servers: readonly LobbyServer[], mine: string | null): void;
  /** زمن الاستجابة المقاس فعلًا، و0 قبل أول قياس. */
  setPing(ms: number): void;
  setRegion(region: RegionId, regions: readonly RegionInfo[]): void;
  setNotice(text: string): void;
}

/**
 * شاشة اختيار السيرفر.
 *
 * لا مطابقة خفيّة: اللاعب يرى أين يجلس الآخرون فيجلس معهم، ثم يضغط «ابدأ»
 * هو. عدد اللاعبين المعروض بشرٌ فقط — البوتات تملأ المقاعد الشاغرة عند
 * الانطلاق، وحسابُها هنا كان سيُظهر كل السيرفرات ممتلئة وهي فارغة.
 */
export function serverListScreen(options: {
  onPick: (id: string) => void;
  onStart: () => void;
  onCancel: () => void;
}): ServerListHandle {
  const list = h('div', { class: 'sv__list', role: 'list' });
  const notice = h('div', { class: 'sv__notice' });
  const meta = h('div', { class: 'sv__meta' });
  const startButton = h(
    'button',
    { class: 'btn sv__start', type: 'button', disabled: true, onclick: options.onStart },
    ['ابدأ'],
  );

  const element = h('div', { class: 'screen center-state sv' }, [
    h('img', { class: 'state__logo', src: '/logo.svg', alt: 'رقعة', width: '56', height: '56' }),
    h('div', { class: 'state__title', text: 'اختر سيرفرًا' }),
    list,
    notice,
    meta,
    h('div', { class: 'sv__actions' }, [
      startButton,
      h('button', { class: 'btn btn--ghost sv__cancel', type: 'button', onclick: options.onCancel }, ['رجوع']),
    ]),
  ]);

  let ping = 0;
  let regionName = '';
  let selected: string | null = null;

  const paintMeta = (): void => {
    const grade = gradeLink(ping);
    meta.textContent = '';
    meta.append(
      h('span', { text: regionName ? `الخادم: ${regionName}` : 'الخادم' }),
      h('i', { text: '·' }),
      h('span', {
        class: `sv__ping sv__ping--${grade}`,
        text: ping > 0 ? `${LINK_GRADE_LABEL[grade]} · ${ping} م.ث` : 'قياس الاتصال…',
      }),
    );
  };

  return {
    element,
    setServers(servers, mine) {
      selected = mine;
      list.replaceChildren(
        ...servers.map((server) => {
          const seated = server.id === mine;
          const busy = !server.joinable && !seated;
          const row = h(
            'button',
            {
              class: `sv__row${seated ? ' sv__row--on' : ''}${busy ? ' sv__row--busy' : ''}`,
              type: 'button',
              role: 'listitem',
              disabled: busy,
              onclick: () => options.onPick(server.id),
            },
            [
              h('span', { class: 'sv__name', text: server.name }),
              h('span', {
                class: 'sv__count',
                // بشر فقط — البوتات ليست لاعبين.
                text: `${server.players}/${server.capacity} لاعبين`,
              }),
              h('span', {
                class: 'sv__state',
                text: server.state === 'WAITING' ? (seated ? 'أنت هنا' : 'متاح') : 'جولة جارية',
              }),
            ],
          );
          return row;
        }),
      );
      startButton.disabled = selected === null;
      notice.textContent = selected
        ? 'اضغط «ابدأ» متى شئت — أو انتظر انضمام لاعبين آخرين.'
        : 'اختر سيرفرًا للانضمام إليه.';
    },
    setPing(ms) {
      ping = ms;
      paintMeta();
    },
    setRegion(region, regions) {
      regionName = regions.find((entry) => entry.id === region)?.name ?? region;
      paintMeta();
    },
    setNotice(text) {
      notice.textContent = text;
    },
  };
}
