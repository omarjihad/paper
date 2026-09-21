import { h } from './dom.js';

/** شاشة انتظار بسيطة. */
export function loadingState(message: string): HTMLElement {
  return h('div', { class: 'screen center-state' }, [
    h('div', { class: 'spinner' }),
    h('div', { class: 'state__text', text: message }),
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
