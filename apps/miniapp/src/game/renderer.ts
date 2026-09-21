import type { GameEngine } from '@riqaa/game-core';
import { ACTOR_COLORS } from '@riqaa/shared';
import type { JoystickState } from './input.js';

/** عدد الخلايا الظاهرة على البُعد الأصغر للشاشة — يضبط مستوى التقريب. */
const VISIBLE_CELLS = 30;
const MAX_DPR = 2;

/**
 * راسم Canvas 2D.
 * قواعد الأداء هنا: لا تخصيص كائنات داخل الإطار، ولا رسم لما هو خارج الكاميرا،
 * وتجميع الخلايا المتجاورة بنفس المالك في مستطيل واحد.
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private scale = 1;

  /** ألوان جاهزة لكل معرّف مشارك — تُحسب مرة واحدة. */
  private readonly territoryColor: string[] = [];
  private readonly trailColor: string[] = [];
  private readonly headColor: string[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly engine: GameEngine,
  ) {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('تعذّر إنشاء سياق الرسم');
    this.ctx = context;

    for (const actor of engine.actors) {
      const base = ACTOR_COLORS[actor.colorIndex % ACTOR_COLORS.length];
      this.territoryColor[actor.id] = withAlpha(base, actor.kind === 'human' ? 0.55 : 0.4);
      this.trailColor[actor.id] = withAlpha(base, 0.85);
      this.headColor[actor.id] = base;
    }
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.scale = Math.min(this.width, this.height) / (VISIBLE_CELLS * this.engine.config.cellSize);
  }

  draw(joystick: JoystickState): void {
    const { ctx, engine } = this;
    const cell = engine.config.cellSize * this.scale;

    const focus = engine.human ?? engine.actors[0];
    const cameraX = engine.renderX(focus) * cell;
    const cameraY = engine.renderY(focus) * cell;
    const offsetX = this.width / 2 - cameraX;
    const offsetY = this.height / 2 - cameraY;

    ctx.fillStyle = '#0a0f18';
    ctx.fillRect(0, 0, this.width, this.height);

    // أرضية الملعب داخل الحدود فقط.
    const worldW = engine.width * cell;
    const worldH = engine.height * cell;
    ctx.fillStyle = '#121a27';
    ctx.fillRect(offsetX, offsetY, worldW, worldH);

    const minX = Math.max(0, Math.floor(-offsetX / cell) - 1);
    const minY = Math.max(0, Math.floor(-offsetY / cell) - 1);
    const maxX = Math.min(engine.width - 1, Math.ceil((this.width - offsetX) / cell) + 1);
    const maxY = Math.min(engine.height - 1, Math.ceil((this.height - offsetY) / cell) + 1);

    this.drawGrid(offsetX, offsetY, cell, minX, minY, maxX, maxY);
    this.drawTerritories(offsetX, offsetY, cell, minX, minY, maxX, maxY);
    this.drawTrails(offsetX, offsetY, cell, minX, minY, maxX, maxY);
    this.drawActors(offsetX, offsetY, cell);
    this.drawBorder(offsetX, offsetY, worldW, worldH);

    if (joystick.active) this.drawJoystick(joystick);
  }

  private drawGrid(
    offsetX: number,
    offsetY: number,
    cell: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): void {
    if (cell < 9) return;
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = minX; x <= maxX + 1; x++) {
      const px = Math.round(offsetX + x * cell) + 0.5;
      ctx.moveTo(px, offsetY + minY * cell);
      ctx.lineTo(px, offsetY + (maxY + 1) * cell);
    }
    for (let y = minY; y <= maxY + 1; y++) {
      const py = Math.round(offsetY + y * cell) + 0.5;
      ctx.moveTo(offsetX + minX * cell, py);
      ctx.lineTo(offsetX + (maxX + 1) * cell, py);
    }
    ctx.stroke();
  }

  /** تجميع أفقي: كل سلسلة خلايا بنفس المالك تُرسم كمستطيل واحد. */
  private drawTerritories(
    offsetX: number,
    offsetY: number,
    cell: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): void {
    const ctx = this.ctx;
    const owner = this.engine.grid.owner;
    const width = this.engine.width;

    for (let y = minY; y <= maxY; y++) {
      const row = y * width;
      let runStart = -1;
      let runOwner = 0;

      for (let x = minX; x <= maxX + 1; x++) {
        const value = x <= maxX ? owner[row + x] : 0;
        if (value === runOwner) continue;
        if (runOwner !== 0 && runStart >= 0) {
          ctx.fillStyle = this.territoryColor[runOwner] ?? 'rgba(255,255,255,0.2)';
          ctx.fillRect(
            offsetX + runStart * cell,
            offsetY + y * cell,
            (x - runStart) * cell + 0.5,
            cell + 0.5,
          );
        }
        runOwner = value;
        runStart = x;
      }
    }
  }

  private drawTrails(
    offsetX: number,
    offsetY: number,
    cell: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): void {
    const ctx = this.ctx;
    const width = this.engine.width;

    for (const actor of this.engine.actors) {
      if (!actor.alive || actor.trail.length === 0) continue;
      ctx.fillStyle = this.trailColor[actor.id] ?? '#ffffff';
      for (let i = 0; i < actor.trail.length; i++) {
        const index = actor.trail[i];
        const x = index % width;
        if (x < minX || x > maxX) continue;
        const y = (index / width) | 0;
        if (y < minY || y > maxY) continue;
        ctx.fillRect(offsetX + x * cell, offsetY + y * cell, cell + 0.5, cell + 0.5);
      }
    }
  }

  private drawActors(offsetX: number, offsetY: number, cell: number): void {
    const ctx = this.ctx;
    const engine = this.engine;
    const head = Math.max(cell * 0.86, 6);
    const inset = (cell - head) / 2;

    for (const actor of engine.actors) {
      if (!actor.alive) continue;
      const px = offsetX + engine.renderX(actor) * cell + inset;
      const py = offsetY + engine.renderY(actor) * cell + inset;

      if (actor.kind === 'human') {
        ctx.shadowColor = this.headColor[actor.id] ?? '#fff';
        ctx.shadowBlur = 14;
      }
      ctx.fillStyle = this.headColor[actor.id] ?? '#fff';
      roundRect(ctx, px, py, head, head, Math.max(2, head * 0.28));
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = 'rgba(8,12,20,0.85)';
      ctx.lineWidth = Math.max(1, head * 0.12);
      ctx.stroke();
    }
  }

  private drawBorder(offsetX: number, offsetY: number, worldW: number, worldH: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(53,224,161,0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(offsetX - 1.5, offsetY - 1.5, worldW + 3, worldH + 3);
  }

  private drawJoystick(joystick: JoystickState): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(joystick.originX, joystick.originY, 46, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(joystick.knobX, joystick.knobY, 20, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(53,224,161,0.75)';
    ctx.fill();
  }
}

function roundRect(
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

/** #RRGGBB إلى rgba() — يُستدعى عند الإعداد فقط لا أثناء الرسم. */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
