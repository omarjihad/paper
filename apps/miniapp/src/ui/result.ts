import type { RoundOutcome } from '@riqaa/shared';
import { h } from './dom.js';

export interface ResultView {
  areaPercent: number;
  rank: number;
  participants: number;
  bestAreaPercent: number;
  outcome: RoundOutcome;
  /** رسالة تظهر إن تعذّر حفظ النتيجة على الخادم. */
  warning?: string;
}

const REASONS: Record<RoundOutcome, string> = {
  eliminated: 'تم قطع مسارك',
  timeup: 'انتهى وقت الجولة',
  quit: 'خرجت من الجولة',
  survived: 'صمدت حتى النهاية',
};

/** شاشة النتيجة: أرقام الجولة + طريقان للمتابعة. */
export function resultScreen(
  view: ResultView,
  onReplay: () => void,
  onHome: () => void,
): HTMLElement {
  return h('div', { class: 'screen result' }, [
    h('div', { class: 'result__card' }, [
      h('h2', { class: 'result__title', text: 'انتهت الجولة' }),
      h('div', { class: 'result__reason', text: REASONS[view.outcome] }),

      h('div', { class: 'result__rows' }, [
        resultRow('المساحة', `${view.areaPercent.toFixed(2)}٪`),
        resultRow('المركز', `${view.rank} من ${view.participants}`),
        resultRow('أفضل مساحة', `${view.bestAreaPercent.toFixed(2)}٪`),
      ]),

      view.warning ? h('div', { class: 'note', text: view.warning }) : null,

      h('div', { class: 'result__actions' }, [
        h('button', { class: 'btn', type: 'button', onclick: onReplay }, ['العب مرة أخرى']),
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: onHome }, ['الرئيسية']),
      ]),
    ]),
  ]);
}

function resultRow(label: string, value: string): HTMLElement {
  return h('div', { class: 'result__row' }, [h('div', { text: label }), h('b', { text: value })]);
}
