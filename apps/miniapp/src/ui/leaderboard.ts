import { h } from './dom.js';

export interface LeaderRow {
  rank: number;
  name: string;
  /** نسبة المساحة المسيطر عليها. */
  area: number;
  color: string;
  isHuman: boolean;
  avatarUrl?: string | null;
  /** خرج من الجولة — يُعرض باهتًا ولا يُحذف كي يبقى الترتيب مفهومًا. */
  eliminated?: boolean;
}

const VISIBLE_ROWS = 5;

/**
 * لوحة صدارة الجولة.
 * صفوف ثابتة تُنشأ مرة واحدة ويُحدَّث نصها فقط — لا إنشاء عناصر أثناء اللعب.
 */
export class Leaderboard {
  readonly element: HTMLElement;
  private readonly rows: RowView[] = [];
  private readonly selfRow: RowView;
  private readonly divider: HTMLElement;

  constructor() {
    for (let i = 0; i < VISIBLE_ROWS; i++) this.rows.push(createRow());
    this.selfRow = createRow();
    this.divider = h('div', { class: 'lb__divider' });

    this.element = h(
      'div',
      { class: 'lb', 'aria-label': 'لوحة الصدارة' },
      [...this.rows.map((row) => row.element), this.divider, this.selfRow.element],
    );
    this.divider.style.display = 'none';
    this.selfRow.element.style.display = 'none';
  }

  /** `rows` مرتّبة تنازليًا بالمساحة. */
  update(rows: readonly LeaderRow[]): void {
    for (let i = 0; i < VISIBLE_ROWS; i++) {
      const row = rows[i];
      if (!row) {
        this.rows[i].element.style.display = 'none';
        continue;
      }
      this.rows[i].element.style.display = '';
      paint(this.rows[i], row);
    }

    // اللاعب خارج المراكز الظاهرة: يُعرض مركزه أسفل فاصل.
    const self = rows.find((row) => row.isHuman);
    const outside = Boolean(self && self.rank > VISIBLE_ROWS);
    this.divider.style.display = outside ? '' : 'none';
    this.selfRow.element.style.display = outside ? '' : 'none';
    if (outside && self) paint(this.selfRow, self);
  }
}

interface RowView {
  element: HTMLElement;
  rank: HTMLElement;
  badge: HTMLElement;
  avatar: HTMLImageElement;
  name: HTMLElement;
  area: HTMLElement;
  avatarUrl: string | null;
}

function createRow(): RowView {
  const rank = h('span', { class: 'lb__rank' });
  const badge = h('span', { class: 'lb__badge' });
  const avatar = h('img', { class: 'lb__avatar', alt: '' });
  const name = h('span', { class: 'lb__name' });
  const area = h('span', { class: 'lb__area' });

  avatar.style.display = 'none';
  const element = h('div', { class: 'lb__row' }, [rank, badge, avatar, name, area]);
  return { element, rank, badge, avatar, name, area, avatarUrl: null };
}

function paint(view: RowView, row: LeaderRow): void {
  view.rank.textContent = `#${row.rank}`;
  view.name.textContent = row.name;
  view.area.textContent = `${row.area.toFixed(2)}٪`;
  view.badge.style.background = row.color;
  view.element.classList.toggle('lb__row--me', row.isHuman);
  view.element.classList.toggle('lb__row--out', Boolean(row.eliminated));

  const url = row.avatarUrl ?? null;
  if (url !== view.avatarUrl) {
    view.avatarUrl = url;
    if (url) {
      view.avatar.src = url;
      view.avatar.style.display = '';
      view.badge.style.display = 'none';
    } else {
      view.avatar.removeAttribute('src');
      view.avatar.style.display = 'none';
      view.badge.style.display = '';
    }
  }
}
