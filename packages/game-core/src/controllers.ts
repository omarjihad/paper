import { dirToHeading, type Actor, type ActorController, type Dir, type MoveIntent, type WorldView } from './types.js';

/**
 * تحكّم اللاعب البشري: نيّة حركة تناظرية (زاوية حرة + نسبة سرعة).
 * مصدر الإدخال (عصا، لمس، لوحة مفاتيح، أو لاحقًا حزمة شبكة) لا يعني المحرك.
 */
export class HumanController implements ActorController {
  private readonly value: MoveIntent = { heading: 0, throttle: 1 };
  private active = false;

  constructor(readonly actorId: number) {}

  /** زاوية حرة بالراديان ونسبة سرعة 0..1. */
  setIntent(heading: number, throttle: number): void {
    this.value.heading = heading;
    this.value.throttle = throttle;
    this.active = true;
  }

  /** مساعد للوحة المفاتيح: اتجاه أصلي كزاوية. */
  setDirection(dir: Dir): void {
    this.setIntent(dirToHeading(dir), 1);
  }

  /** ترك العصا لا يوقف اللاعب: يواصل بآخر زاوية وبسرعة كاملة. */
  release(): void {
    this.value.throttle = 1;
  }

  intent(_world: WorldView, _actor: Actor): MoveIntent | null {
    return this.active ? this.value : null;
  }

  reset(): void {
    this.active = false;
    this.value.throttle = 1;
  }
}
