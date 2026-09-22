import type { BotBehavior, BotDifficulty } from '@riqaa/shared';
import type { Rng } from '../rng.js';
import { DX, DY, type Actor, type ActorController, type Dir, type WorldView } from '../types.js';
import { resolveBotProfile, type ResolvedBotProfile } from './profiles.js';

type BotMode = 'plan' | 'expand' | 'hunt' | 'return';

/**
 * بوت بآلة حالات صغيرة: يخطط خرجة، ينفذها، ثم يعود.
 * لا بحث مسارات ثقيل — قرار واحد رخيص عند كل حدود خلية.
 *
 * الصعوبة تضبط إتقان القرار، والنمط يضبط أسلوبه (استكشاف، دفاع، هجوم…)،
 * والقواعد المطبَّقة هي نفسها قواعد الأرض والمسار والاستحواذ — بلا استثناء.
 */
export class BotController implements ActorController {
  private readonly profile: ResolvedBotProfile;
  private mode: BotMode = 'plan';
  private targetX = -1;
  private targetY = -1;
  /** يُفضِّل البوت محور الحركة هذا عند التساوي — يمنع الاهتزاز بين محورين. */
  private preferHorizontal = true;

  constructor(
    readonly actorId: number,
    readonly difficulty: BotDifficulty,
    private readonly rng: Rng,
    readonly behavior: BotBehavior = 'balanced',
  ) {
    this.profile = resolveBotProfile(difficulty, behavior);
  }

  reset(): void {
    this.mode = 'plan';
    this.targetX = -1;
    this.targetY = -1;
  }

  decide(world: WorldView, actor: Actor): Dir | null {
    if (!actor.outside) {
      // داخل الأرض: آمن. إمّا نكمل خرجة مخططة أو نخطط واحدة جديدة.
      if (this.mode === 'return' || this.mode === 'plan' || this.targetX < 0) {
        this.planExcursion(world, actor);
      }
    } else if (this.mode !== 'return') {
      const tooLong = actor.trail.length >= this.profile.maxTrail;
      const arrived = actor.cx === this.targetX && actor.cy === this.targetY;
      const huntLost = this.mode === 'hunt' && world.trailAt(this.targetX, this.targetY) === 0;
      if (tooLong || arrived || huntLost || this.senseDanger(world, actor)) {
        this.beginReturn(world, actor);
      }
    }

    return this.stepToward(world, actor);
  }

  // ------------------------------------------------------------- التخطيط

  private planExcursion(world: WorldView, actor: Actor): void {
    if (this.profile.huntRadius > 0 && this.rng.next() < this.profile.huntChance) {
      const prey = this.findNearestEnemyTrail(world, actor);
      if (prey) {
        this.mode = 'hunt';
        this.targetX = prey.x;
        this.targetY = prey.y;
        this.preferHorizontal = Math.abs(prey.x - actor.cx) >= Math.abs(prey.y - actor.cy);
        return;
      }
    }

    // خرجة على شكل مستطيل: عمق في محور + عرض في المحور العمودي عليه،
    // فتُغلق الحلقة عند العودة وتُحتسب المساحة المحصورة.
    const depth = this.rng.int(this.profile.minDepth, this.profile.maxDepth);
    const width = this.rng.int(2, Math.max(2, (depth / 2) | 0) + 2);
    const outward = this.pickOutward(world, actor);
    const side = ((outward + (this.rng.next() < 0.5 ? 1 : 3)) & 3) as Dir;

    this.mode = 'expand';
    this.targetX = clamp(actor.cx + DX[outward] * depth + DX[side] * width, 1, world.width - 2);
    this.targetY = clamp(actor.cy + DY[outward] * depth + DY[side] * width, 1, world.height - 2);
    this.preferHorizontal = DX[outward] !== 0;
  }

  /**
   * اختيار جهة الخرجة.
   * كلما زاد roam مال البوت إلى الابتعاد عن مركز أرضه بدل الدوران حول حافتها،
   * وهذا وحده ما يفرّق «المستكشف» عن «المدافع» في الشكل الظاهر على الخريطة.
   */
  private pickOutward(world: WorldView, actor: Actor): Dir {
    if (this.profile.roam <= 0 || this.rng.next() > this.profile.roam) {
      return this.rng.int(0, 3) as Dir;
    }
    const homeX = (actor.minX + actor.maxX) / 2;
    const homeY = (actor.minY + actor.maxY) / 2;
    const dx = actor.cx - homeX;
    const dy = actor.cy - homeY;
    // الابتعاد عن مركز الأرض، مع إبقاء الوجهة داخل الملعب.
    let dir: Dir;
    if (Math.abs(dx) >= Math.abs(dy)) dir = dx >= 0 ? 0 : 2;
    else dir = dy >= 0 ? 1 : 3;
    const nx = actor.cx + DX[dir] * this.profile.minDepth;
    const ny = actor.cy + DY[dir] * this.profile.minDepth;
    if (!world.inBounds(nx, ny)) dir = ((dir + 2) & 3) as Dir;
    return dir;
  }

  private beginReturn(world: WorldView, actor: Actor): void {
    this.mode = 'return';
    const home = this.findNearestOwnCell(world, actor);
    this.targetX = home.x;
    this.targetY = home.y;
    this.preferHorizontal = Math.abs(home.x - actor.cx) >= Math.abs(home.y - actor.cy);
  }

  private senseDanger(world: WorldView, actor: Actor): boolean {
    const radius = this.profile.dangerRadius;
    for (const other of world.actors) {
      if (other.id === actor.id || !other.alive) continue;
      const distance = Math.max(Math.abs(other.cx - actor.cx), Math.abs(other.cy - actor.cy));
      if (distance <= radius && this.rng.next() < this.profile.caution) return true;
    }
    return false;
  }

  private findNearestEnemyTrail(world: WorldView, actor: Actor): { x: number; y: number } | null {
    const radius = this.profile.huntRadius;
    let best: { x: number; y: number } | null = null;
    let bestDistance = Infinity;
    for (let y = actor.cy - radius; y <= actor.cy + radius; y++) {
      for (let x = actor.cx - radius; x <= actor.cx + radius; x++) {
        if (!world.inBounds(x, y)) continue;
        const owner = world.trailAt(x, y);
        if (owner === 0 || owner === actor.id) continue;
        // المتربّص لا يطارد إلا من تورّط فعلًا: مسار طويل ومكشوف.
        if (this.profile.opportunistic) {
          const prey = world.actorById(owner);
          if (!prey || !prey.alive || prey.trail.length < OPPORTUNIST_MIN_TRAIL) continue;
        }
        const distance = Math.abs(x - actor.cx) + Math.abs(y - actor.cy);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { x, y };
        }
      }
    }
    return best;
  }

  /** بحث حلقي قصير عن أقرب خلية يملكها البوت؛ وإلا نقطة الخروج. */
  private findNearestOwnCell(world: WorldView, actor: Actor): { x: number; y: number } {
    for (let radius = 1; radius <= 48; radius++) {
      for (let y = actor.cy - radius; y <= actor.cy + radius; y++) {
        for (let x = actor.cx - radius; x <= actor.cx + radius; x++) {
          const onRing =
            Math.abs(x - actor.cx) === radius || Math.abs(y - actor.cy) === radius;
          if (!onRing || !world.inBounds(x, y)) continue;
          if (world.ownerAt(x, y) === actor.id) return { x, y };
        }
      }
    }
    return { x: actor.exitCell % world.width, y: (actor.exitCell / world.width) | 0 };
  }

  // -------------------------------------------------------------- الحركة

  private stepToward(world: WorldView, actor: Actor): Dir | null {
    const dx = this.targetX - actor.cx;
    const dy = this.targetY - actor.cy;

    const horizontal: Dir | null = dx > 0 ? 0 : dx < 0 ? 2 : null;
    const vertical: Dir | null = dy > 0 ? 1 : dy < 0 ? 3 : null;

    const primary = this.preferHorizontal ? horizontal : vertical;
    const secondary = this.preferHorizontal ? vertical : horizontal;

    if (primary !== null && this.isSafe(world, actor, primary)) return primary;
    if (secondary !== null && this.isSafe(world, actor, secondary)) return secondary;
    if (this.isSafe(world, actor, actor.dir)) return actor.dir;

    for (let dir = 0 as Dir; dir < 4; dir = ((dir + 1) as Dir)) {
      if (this.isSafe(world, actor, dir)) return dir;
    }
    return null;
  }

  private isSafe(world: WorldView, actor: Actor, dir: Dir): boolean {
    if (dir === ((actor.dir + 2) & 3)) return false;
    const nx = actor.cx + DX[dir];
    const ny = actor.cy + DY[dir];
    if (!world.inBounds(nx, ny)) return false;
    if (world.trailAt(nx, ny) === actor.id) return false;
    return true;
  }
}

/** أقل طول مسار يعتبره المتربّص فرصة تستحق المخاطرة. */
const OPPORTUNIST_MIN_TRAIL = 6;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
