/**
 * مؤثرات القتل: ومضة قصيرة + شظايا + حلقة انفجار + لافتة المكافأة.
 * كلها على الـCanvas بمجمّع ثابت الحجم — لا تخصيص أثناء اللعب ولا عناصر DOM.
 */

const MAX_PARTICLES = 96;
const PARTICLES_PER_KILL = 14;
const MAX_BURSTS = 6;
const MAX_LABELS = 4;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
}

interface Burst {
  x: number;
  y: number;
  life: number;
  color: string;
}

interface Label {
  x: number;
  y: number;
  life: number;
  text: string;
}

export class Effects {
  private readonly particles: Particle[] = [];
  private readonly bursts: Burst[] = [];
  private readonly labels: Label[] = [];
  private flash = 0;
  private flashColor = '#ffffff';

  private readonly coin = new Image();
  private coinReady = false;

  constructor(coinUrl = '/game-coin.svg') {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, color: '#fff' });
    }
    for (let i = 0; i < MAX_BURSTS; i++) this.bursts.push({ x: 0, y: 0, life: 0, color: '#fff' });
    for (let i = 0; i < MAX_LABELS; i++) this.labels.push({ x: 0, y: 0, life: 0, text: '' });

    this.coin.addEventListener('load', () => {
      this.coinReady = true;
    });
    this.coin.src = coinUrl;
  }

  /** إحداثيات العالم بوحدة الخلية. */
  spawnKill(x: number, y: number, color: string, reward: number, byPlayer: boolean): void {
    let spawned = 0;
    for (const particle of this.particles) {
      if (particle.life > 0) continue;
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 6;
      particle.x = x;
      particle.y = y;
      particle.vx = Math.cos(angle) * speed;
      particle.vy = Math.sin(angle) * speed;
      particle.maxLife = 0.45 + Math.random() * 0.35;
      particle.life = particle.maxLife;
      particle.color = color;
      if (++spawned >= PARTICLES_PER_KILL) break;
    }

    const burst = this.bursts.find((item) => item.life <= 0);
    if (burst) {
      burst.x = x;
      burst.y = y;
      burst.life = 0.5;
      burst.color = color;
    }

    if (byPlayer) {
      const label = this.labels.find((item) => item.life <= 0);
      if (label) {
        label.x = x;
        label.y = y;
        label.life = 1.1;
        label.text = `+${reward}`;
      }
      this.flash = 0.22;
      this.flashColor = color;
    }
  }

  update(dt: number): void {
    for (const particle of this.particles) {
      if (particle.life <= 0) continue;
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 0.92;
      particle.vy *= 0.92;
    }
    for (const burst of this.bursts) if (burst.life > 0) burst.life -= dt;
    for (const label of this.labels) {
      if (label.life <= 0) continue;
      label.life -= dt;
      label.y -= dt * 1.6;
    }
    if (this.flash > 0) this.flash -= dt;
  }

  /** مؤثرات داخل العالم — تُرسم بعد الأرض وقبل واجهة اللاعب. */
  drawWorld(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number, cell: number): void {
    for (const burst of this.bursts) {
      if (burst.life <= 0) continue;
      const progress = 1 - burst.life / 0.5;
      ctx.globalAlpha = (1 - progress) * 0.7;
      ctx.strokeStyle = burst.color;
      ctx.lineWidth = Math.max(2, cell * 0.35 * (1 - progress));
      ctx.beginPath();
      ctx.arc(offsetX + burst.x * cell, offsetY + burst.y * cell, cell * (0.6 + progress * 4), 0, Math.PI * 2);
      ctx.stroke();
    }

    const size = Math.max(2, cell * 0.3);
    for (const particle of this.particles) {
      if (particle.life <= 0) continue;
      ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife) * 0.9;
      ctx.fillStyle = particle.color;
      ctx.fillRect(
        offsetX + particle.x * cell - size / 2,
        offsetY + particle.y * cell - size / 2,
        size,
        size,
      );
    }
    ctx.globalAlpha = 1;
  }

  /** لافتة المكافأة فوق كل شيء. */
  drawLabels(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number, cell: number): void {
    for (const label of this.labels) {
      if (label.life <= 0) continue;
      const alpha = Math.min(1, label.life / 0.4);
      const x = offsetX + label.x * cell;
      const y = offsetY + label.y * cell;

      ctx.globalAlpha = alpha;
      // الصفحة RTL، فبدون هذا تُرسم «+10» معكوسة.
      ctx.direction = 'ltr';
      ctx.font = '700 17px Cairo, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(8,12,20,0.85)';
      ctx.strokeText(label.text, x - 14, y);
      ctx.fillStyle = '#FFD166';
      ctx.fillText(label.text, x - 14, y);

      if (this.coinReady) ctx.drawImage(this.coin, x + 10, y - 9, 18, 18);
      ctx.direction = 'inherit';
      ctx.globalAlpha = 1;
    }
  }

  /** ومضة شاشة خفيفة عند قتل يقوم به اللاعب. */
  drawFlash(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (this.flash <= 0) return;
    ctx.globalAlpha = Math.min(0.18, this.flash * 0.8);
    ctx.fillStyle = this.flashColor;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }

  clear(): void {
    for (const particle of this.particles) particle.life = 0;
    for (const burst of this.bursts) burst.life = 0;
    for (const label of this.labels) label.life = 0;
    this.flash = 0;
  }
}
