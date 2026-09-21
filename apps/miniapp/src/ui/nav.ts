import { h } from './dom.js';
import { icons } from './icons.js';

export type Tab = 'home' | 'profile';

const TABS: ReadonlyArray<{ id: Tab; label: string; icon: () => SVGSVGElement }> = [
  { id: 'home', label: 'الرئيسية', icon: icons.home },
  { id: 'profile', label: 'الملف الشخصي', icon: icons.user },
];

/** تنقّل سفلي بتبويبين فقط — لا شيء غيرهما في هذه المرحلة. */
export function bottomNav(active: Tab, onSelect: (tab: Tab) => void): HTMLElement {
  return h(
    'nav',
    { class: 'nav', role: 'tablist', 'aria-label': 'التنقل الرئيسي' },
    TABS.map((tab) =>
      h(
        'button',
        {
          class: 'nav__item',
          type: 'button',
          role: 'tab',
          'aria-selected': String(tab.id === active),
          onclick: () => {
            if (tab.id !== active) onSelect(tab.id);
          },
        },
        [tab.icon(), h('span', { text: tab.label })],
      ),
    ),
  );
}
