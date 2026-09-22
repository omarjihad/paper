import { h } from './dom.js';

/** انتظار عام (إقلاع التطبيق). */
export function loadingState(message: string): HTMLElement {
  return h('div', { class: 'screen center-state' }, [
    h('div', { class: 'spinner' }),
    h('div', { class: 'state__text', text: message }),
  ]);
}

/** انتظار تجهيز الجولة: الشعار ورقعة تُملأ خلية خلية — نفس فكرة اللعبة. */
export function matchLoadingState(): HTMLElement {
  return h('div', { class: 'screen center-state' }, [
    h('img', { class: 'state__logo', src: '/logo.svg', alt: 'رقعة', width: '64', height: '64' }),
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
export function errorState(
  title: string,
  message: string,
  onRetry?: () => void,
  /** تفصيل تقني للأخطاء غير المتوقعة — يجعل أي انهيار قابلًا للتشخيص من لقطة شاشة. */
  detail?: string,
): HTMLElement {
  return h('div', { class: 'screen center-state' }, [
    h('div', { class: 'state__title', text: title }),
    h('div', { class: 'state__text', text: message }),
    onRetry
      ? h('button', { class: 'btn btn--ghost', type: 'button', onclick: onRetry }, ['إعادة المحاولة'])
      : null,
    detail ? h('div', { class: 'note', style: 'max-width:320px', text: detail }) : null,
  ]);
}
