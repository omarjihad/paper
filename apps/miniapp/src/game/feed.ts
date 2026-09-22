import type { NetFeedItem } from '@riqaa/shared';
import { h } from '../ui/dom.js';

/** كم يبقى السطر ظاهرًا. */
const LIFETIME_MS = 4200;
/** أقصى عدد أسطر ظاهرة في وقت واحد — الشريط مرافق للعب لا يزاحمه. */
const MAX_ROWS = 3;

/**
 * شريط الإخراجات: «فلان أخرج فلانًا».
 * الأسماء تصل جاهزة من الخادم — أسماء عرض حقيقية للاعبين، و«بوت ن» للبوتات.
 */
export class EliminationFeed {
  readonly element: HTMLElement;
  private readonly rows: { node: HTMLElement; until: number }[] = [];
  private timer = 0;

  constructor() {
    this.element = h('div', { class: 'feed', 'aria-live': 'polite' });
  }

  push(item: NetFeedItem, localActorId: number): void {
    const mine = 'killerActorId' in item && item.killerActorId === localActorId;
    const node =
      item.k === 'kill'
        ? h('div', { class: `feed__row${mine ? ' feed__row--me' : ''}` }, [
            h('b', { text: item.killer }),
            h('span', { text: ' أخرج ' }),
            h('b', { text: item.victim }),
          ])
        : h('div', { class: 'feed__row' }, [
            h('b', { text: item.victim }),
            h('span', { text: ' خرج من الجولة' }),
          ]);

    this.element.prepend(node);
    this.rows.unshift({ node, until: performance.now() + LIFETIME_MS });
    while (this.rows.length > MAX_ROWS) this.rows.pop()?.node.remove();
    this.schedule();
  }

  /** تنظيف دوري خفيف: مؤقّت واحد يعمل فقط حين يكون هناك ما ينتهي. */
  private schedule(): void {
    if (this.timer) return;
    this.timer = window.setInterval(() => {
      const now = performance.now();
      while (this.rows.length > 0 && this.rows[this.rows.length - 1].until <= now) {
        this.rows.pop()?.node.remove();
      }
      if (this.rows.length === 0) {
        window.clearInterval(this.timer);
        this.timer = 0;
      }
    }, 500);
  }

  destroy(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
    this.rows.length = 0;
    this.element.remove();
  }
}
