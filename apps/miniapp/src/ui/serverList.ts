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
 *
 * أسماء البلدان أسماءُ غرفٍ لا عناوين مواقع، والشاشة تقول ذلك صراحةً:
 * الخدمة تعمل من منطقة واحدة، فلا يظن اللاعب أن اختياره يغيّر زمن استجابته.
 */
export function serverListScreen(options: {
  onPick: (id: string) => void;
  onStart: () => void;
  onCancel: () => void;
}): ServerListHandle {
  const grid = h('div', { class: 'sv__grid', role: 'list' });
  const notice = h('div', { class: 'sv__notice' });
  const host = h('div', { class: 'sv__host' });
  const pingTag = h('span', { class: 'sv__ping' });

  const startButton = h(
    'button',
    { class: 'btn sv__start', type: 'button', disabled: true, onclick: options.onStart },
    ['ابدأ'],
  );

  const element = h('div', { class: 'screen sv' }, [
    h('div', { class: 'sv__head' }, [
      h('button', { class: 'sv__back', type: 'button', 'aria-label': 'رجوع', onclick: options.onCancel }, ['‹']),
      h('div', { class: 'sv__heading' }, [
        h('h2', { class: 'sv__title', text: 'اختر سيرفرًا' }),
        h('div', { class: 'sv__sub', text: 'العدد المعروض لاعبون حقيقيون — البوتات تملأ الباقي' }),
      ]),
      pingTag,
    ]),
    grid,
    h('div', { class: 'sv__foot' }, [notice, startButton, host]),
  ]);

  let ping = 0;
  let regionName = '';

  const paintHost = (): void => {
    host.textContent = regionName
      ? `كل السيرفرات تعمل من ${regionName} — الأسماء للتمييز بينها فقط`
      : '';
  };

  const paintPing = (): void => {
    const grade = gradeLink(ping);
    pingTag.className = `sv__ping sv__ping--${grade}`;
    pingTag.textContent = ping > 0 ? `${LINK_GRADE_LABEL[grade]} · ${ping}م.ث` : '…';
  };
  paintPing();

  return {
    element,
    setServers(servers, mine) {
      grid.replaceChildren(
        ...servers.map((server) => {
          const seated = server.id === mine;
          const busy = !server.joinable && !seated;
          const full = server.players >= server.capacity;
          return h(
            'button',
            {
              class: `sv__card${seated ? ' sv__card--on' : ''}${busy ? ' sv__card--busy' : ''}`,
              type: 'button',
              role: 'listitem',
              disabled: busy,
              onclick: () => options.onPick(server.id),
            },
            [
              h('span', { class: 'sv__flag', 'aria-hidden': 'true', text: server.flag }),
              h('span', { class: 'sv__name', text: server.name }),
              h('span', { class: 'sv__count' }, [
                h('b', { text: String(server.players) }),
                h('i', { text: `/${server.capacity}` }),
              ]),
              h('span', {
                class: `sv__tag${busy ? ' sv__tag--busy' : ''}${seated ? ' sv__tag--on' : ''}`,
                text: busy ? 'جولة جارية' : seated ? 'أنت هنا' : full ? 'ممتلئ' : 'متاح',
              }),
            ],
          );
        }),
      );
      startButton.disabled = mine === null;
      notice.textContent = mine
        ? 'اضغط «ابدأ» متى شئت، أو انتظر انضمام لاعبين.'
        : 'اختر سيرفرًا للانضمام إليه.';
    },
    setPing(ms) {
      ping = ms;
      paintPing();
    },
    setRegion(region, regions) {
      regionName = regions.find((entry) => entry.id === region)?.name ?? region;
      paintHost();
    },
    setNotice(text) {
      notice.textContent = text;
    },
  };
}
