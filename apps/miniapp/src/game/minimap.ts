import type { GameEngine } from '@riqaa/game-core';

/**
 * خريطة مصغّرة تُرسم على لوحة منفصلة وتُحدَّث على فترات،
 * ثم تُنسخ في كل إطار. بهذا لا تكلّف الشبكة شيئًا في الإطار الواحد.
 */
const REFRESH_MS = 220;

export class Minimap {
  private readonly buffer: HTMLCanvasElement;
  private readonly bufferCtx: CanvasRenderingContext2D;
  private lastRefresh = -Infinity;

  constructor(
    private readonly engine: GameEngine,
    private readonly colorOf: (actorId: number) => string,
    /** دقة اللوحة الداخلية بالبكسل. */
    private readonly resolution = 96,
  ) {
    this.buffer = document.createElement('canvas');
    this.buffer.width = resolution;
    this.buffer.height = resolution;
    const context = this.buffer.getContext('2d');
    if (!context) throw new Error('تعذّر إنشاء لوحة الخريطة المصغّرة');
    this.bufferCtx = context;
  }

  /**
   * يرسم الخريطة في المربع المحدد:
   * حدود العالم، أراضي الجميع، إطار الكاميرا، وموقع اللاعب.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    camera: { x: number; y: number; cellsWide: number; cellsHigh: number },
    now: number,
  ): void {
    if (now - this.lastRefresh >= REFRESH_MS) {
      this.refresh();
      this.lastRefresh = now;
    }

    const radius = 10;
    ctx.save();
    roundedPath(ctx, x, y, size, size, radius);
    ctx.fillStyle = 'rgba(20,29,45,0.88)';
    ctx.fill();
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.buffer, x, y, size, size);

    const engine = this.engine;
    const scaleX = size / engine.width;
    const scaleY = size / engine.height;

    // إطار الكاميرا: أين ينظر اللاعب من العالم كله.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      x + (camera.x - camera.cellsWide / 2) * scaleX,
      y + (camera.y - camera.cellsHigh / 2) * scaleY,
      camera.cellsWide * scaleX,
      camera.cellsHigh * scaleY,
    );

    // موقع اللاعب.
    const human = engine.human;
    if (human && human.alive) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x + human.x * scaleX, y + human.y * scaleY, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = this.colorOf(human.id);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + human.x * scaleX, y + human.y * scaleY, 4.6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    roundedPath(ctx, x + 0.5, y + 0.5, size - 1, size - 1, radius);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** إعادة رسم الأراضي بعيّنات متباعدة — تكلفة مقبولة كل جزء من الثانية. */
  private refresh(): void {
    const engine = this.engine;
    const ctx = this.bufferCtx;
    const size = this.resolution;
    ctx.clearRect(0, 0, size, size);

    const stepX = engine.width / size;
    const stepY = engine.height / size;
    const owner = engine.grid.owner;
    const gridWidth = engine.width;

    for (let py = 0; py < size; py++) {
      const cy = Math.min(engine.height - 1, (py * stepY) | 0);
      const row = cy * gridWidth;
      let runStart = -1;
      let runOwner = 0;

      for (let px = 0; px <= size; px++) {
        const cx = Math.min(gridWidth - 1, (px * stepX) | 0);
        const value = px < size ? owner[row + cx] : 0;
        if (value === runOwner) continue;
        if (runOwner !== 0 && runStart >= 0) {
          ctx.fillStyle = this.colorOf(runOwner);
          ctx.fillRect(runStart, py, px - runStart, 1);
        }
        runOwner = value;
        runStart = px;
      }
    }
  }
}

function roundedPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}
