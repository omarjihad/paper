import type { Grid } from './grid.js';

/**
 * خوارزمية الاستحواذ: كل خلية غير مملوكة للاعب ومحاصَرة داخل أرضه تصبح ملكًا له.
 *
 * نعمل داخل الصندوق المحيط بأرض اللاعب فقط (موسّعًا خلية واحدة)، ثم ننشر
 * تعبئة من حواف الصندوق: ما لا تصله التعبئة فهو محاصَر.
 * التكلفة مرتبطة بحجم أرض اللاعب لا بحجم الخريطة كلها.
 */
export class CaptureSolver {
  private readonly queue: Int32Array;
  private readonly stamp: Int32Array;
  private current = 0;

  constructor(private readonly grid: Grid) {
    const size = grid.width * grid.height;
    this.queue = new Int32Array(size);
    this.stamp = new Int32Array(size);
  }

  /**
   * يملأ الفراغات المحاصرة لصالح actorId.
   * @param onClaim يُستدعى لكل خلية تم الاستيلاء عليها مع مالكها السابق.
   * @returns عدد الخلايا المكتسبة.
   */
  fill(
    actorId: number,
    box: { minX: number; minY: number; maxX: number; maxY: number },
    onClaim: (index: number, previousOwner: number) => void,
  ): number {
    const { grid } = this;
    const w = grid.width;
    const owner = grid.owner;

    const x0 = Math.max(0, box.minX - 1);
    const y0 = Math.max(0, box.minY - 1);
    const x1 = Math.min(grid.width - 1, box.maxX + 1);
    const y1 = Math.min(grid.height - 1, box.maxY + 1);
    if (x1 < x0 || y1 < y0) return 0;

    const mark = ++this.current;
    const queue = this.queue;
    const stamp = this.stamp;
    let head = 0;
    let tail = 0;

    // بذور التعبئة: كل خلية على حافة الصندوق ليست ملكًا للاعب.
    for (let x = x0; x <= x1; x++) {
      const top = y0 * w + x;
      if (owner[top] !== actorId && stamp[top] !== mark) {
        stamp[top] = mark;
        queue[tail++] = top;
      }
      const bottom = y1 * w + x;
      if (owner[bottom] !== actorId && stamp[bottom] !== mark) {
        stamp[bottom] = mark;
        queue[tail++] = bottom;
      }
    }
    for (let y = y0; y <= y1; y++) {
      const left = y * w + x0;
      if (owner[left] !== actorId && stamp[left] !== mark) {
        stamp[left] = mark;
        queue[tail++] = left;
      }
      const right = y * w + x1;
      if (owner[right] !== actorId && stamp[right] !== mark) {
        stamp[right] = mark;
        queue[tail++] = right;
      }
    }

    while (head < tail) {
      const index = queue[head++];
      const x = index % w;
      const y = (index / w) | 0;

      if (x > x0) {
        const n = index - 1;
        if (owner[n] !== actorId && stamp[n] !== mark) {
          stamp[n] = mark;
          queue[tail++] = n;
        }
      }
      if (x < x1) {
        const n = index + 1;
        if (owner[n] !== actorId && stamp[n] !== mark) {
          stamp[n] = mark;
          queue[tail++] = n;
        }
      }
      if (y > y0) {
        const n = index - w;
        if (owner[n] !== actorId && stamp[n] !== mark) {
          stamp[n] = mark;
          queue[tail++] = n;
        }
      }
      if (y < y1) {
        const n = index + w;
        if (owner[n] !== actorId && stamp[n] !== mark) {
          stamp[n] = mark;
          queue[tail++] = n;
        }
      }
    }

    let gained = 0;
    for (let y = y0; y <= y1; y++) {
      const row = y * w;
      for (let x = x0; x <= x1; x++) {
        const index = row + x;
        if (owner[index] === actorId) continue;
        if (stamp[index] === mark) continue;
        const previous = owner[index];
        owner[index] = actorId;
        onClaim(index, previous);
        gained++;
      }
    }
    return gained;
  }
}
