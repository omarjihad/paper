import { h } from './dom.js';

/** انتظار عام (إقلاع التطبيق). */
export function loadingState(message: string): HTMLElement {
  return h('div', { class: 'screen center-state' }, [
    h('div', { class: 'spinner' }),
    h('div', { class: 'state__text', text: message }),
  ]);
}

/** انتظار تجهيز الجولة: رقعة تُملأ خلية خلية — نفس فكرة اللعبة. */
export function matchLoadingState(): HTMLElement {
  return h('div', { class: 'screen center-state' }, [
    h(
      'div',
      { class: 'tiles', 'aria-hidden': 'true' },
      Array.from({ length: 9 }, () => h('i')),
    ),
    h('div', { class: 'state__title', text: 'جاري تجهيز الجولة…' }),
    h('div', { class: 'state__text', text: 'يتم توزيع الأراضي على المشاركين' }),
  ]);
}

/** شاشة خطأ مع إمكانية إعادة المحاولة. */
export function errorState(title: string, message: string, onRetry?: () => void): HTMLElement {
  return h('div', { class: 'screen center-state' }, [
    h('div', { class: 'state__title', text: title }),
    h('div', { class: 'state__text', text: message }),
    onRetry
      ? h('button', { class: 'btn btn--ghost', type: 'button', onclick: onRetry }, ['إعادة المحاولة'])
      : null,
  ]);
}
