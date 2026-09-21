/**
 * شبكة اللعبة: مصفوفتان مسطّحتان فقط.
 * لا كائنات لكل خلية — هذا ما يجعل الملء والرسم رخيصين على الهاتف.
 */
export class Grid {
  readonly width: number;
  readonly height: number;
  /** معرّف مالك كل خلية، 0 = خالية. */
  readonly owner: Uint8Array;
  /** معرّف صاحب المسار المار بالخلية، 0 = لا مسار. */
  readonly trail: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.owner = new Uint8Array(width * height);
    this.trail = new Uint8Array(width * height);
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  ownerAt(x: number, y: number): number {
    return this.inBounds(x, y) ? this.owner[this.index(x, y)] : 0;
  }

  trailAt(x: number, y: number): number {
    return this.inBounds(x, y) ? this.trail[this.index(x, y)] : 0;
  }

  xOf(index: number): number {
    return index % this.width;
  }

  yOf(index: number): number {
    return (index / this.width) | 0;
  }
}
