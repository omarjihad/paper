import { MULTIPLAYER, type RegionId, type RegionInfo } from '@riqaa/shared';
import { h } from './dom.js';

export interface MatchmakingHandle {
  element: HTMLElement;
  /** نص الحالة الرئيسي. */
  setStatus(text: string): void;
  /** عدد المنتظرين والعدد الناقص لبدء الغرفة. */
  setQueue(waiting: number, needed: number): void;
  /** زمن الاستجابة المقاس فعلًا؛ 0 = لم يُقَس بعد. */
  setPing(ms: number): void;
  setRegions(regions: readonly RegionInfo[], active: RegionId): void;
  /** العد التنازلي قبل الانطلاق. */
  setCountdown(ms: number): void;
}

/**
 * شاشة المطابقة: بحث → طابور → غرفة → عد تنازلي.
 * كل رقم معروض هنا مصدره الخادم أو قياس حقيقي — لا تقديرات تجميلية.
 */
export function matchmakingScreen(options: {
  onCancel: () => void;
  onRegion: (region: RegionId) => void;
}): MatchmakingHandle {
  const status = h('div', { class: 'state__title', text: 'جاري البحث عن لاعبين…' });
  const queue = h('div', { class: 'state__text', text: 'بانتظار انضمام لاعبين' });
  const ping = h('span', { class: 'mm__ping', text: 'قياس زمن الاستجابة…' });
  const regionRow = h('div', { class: 'mm__regions', 'aria-label': 'المنطقة' });
  const countdown = h('div', { class: 'mm__count', text: '' });

  const bar = h('i');
  const progress = h('div', { class: 'mm__bar' }, [bar]);

  const element = h('div', { class: 'screen center-state mm' }, [
    h('img', { class: 'state__logo', src: '/logo.svg', alt: 'رقعة', width: '64', height: '64' }),
    h(
      'div',
      { class: 'tiles', 'aria-hidden': 'true' },
      Array.from({ length: 9 }, () => h('i')),
    ),
    status,
    queue,
    countdown,
    progress,
    regionRow,
    h('div', { class: 'mm__meta' }, [ping]),
    h(
      'button',
      { class: 'btn btn--ghost', type: 'button', onclick: options.onCancel },
      ['إلغاء'],
    ),
  ]);

  // شريط المهلة: يوضّح متى سيُفتح الملعب ببوتات إن لم يحضر خصوم.
  const startedAt = performance.now();
  let frame = 0;
  const animate = (): void => {
    const ratio = Math.min(1, (performance.now() - startedAt) / MULTIPLAYER.MATCHMAKING_TIMEOUT);
    bar.style.width = `${(ratio * 100).toFixed(1)}%`;
    if (ratio < 1) frame = requestAnimationFrame(animate);
  };
  frame = requestAnimationFrame(animate);
  element.addEventListener('riqaa:unmount', () => cancelAnimationFrame(frame));

  return {
    element,
    setStatus(text) {
      status.textContent = text;
    },
    setQueue(waiting, needed) {
      queue.textContent =
        needed > 0
          ? `${waiting} في الانتظار — ينقص ${needed} لبدء الجولة`
          : `${waiting} في الانتظار — جارٍ تجهيز الملعب`;
    },
    setPing(ms) {
      ping.textContent = ms > 0 ? `زمن الاستجابة ${ms} مللي ثانية` : 'قياس زمن الاستجابة…';
    },
    setRegions(regions, active) {
      regionRow.replaceChildren(
        ...regions.map((region) =>
          h(
            'button',
            {
              class: `mm__region${region.id === active ? ' mm__region--on' : ''}`,
              type: 'button',
              onclick: () => options.onRegion(region.id),
            },
            [
              h('span', { text: region.name }),
              h('em', { text: region.hosted ? 'مستضافة' : 'غير مُقاسة' }),
            ],
          ),
        ),
      );
    },
    setCountdown(ms) {
      const seconds = Math.ceil(ms / 1000);
      countdown.textContent = seconds > 0 ? String(seconds) : 'ابدأ!';
    },
  };
}
