import type { Actor, ActorController, Dir, WorldView } from './types.js';

/**
 * تحكّم اللاعب البشري: مجرد صندوق يحمل آخر اتجاه مطلوب.
 * مصدر الاتجاه (عصا، لمس، لوحة مفاتيح، أو لاحقًا حزمة شبكة) لا يعني المحرك.
 */
export class HumanController implements ActorController {
  private desired: Dir | null = null;

  constructor(readonly actorId: number) {}

  setDirection(dir: Dir): void {
    this.desired = dir;
  }

  decide(_world: WorldView, _actor: Actor): Dir | null {
    return this.desired;
  }

  reset(): void {
    this.desired = null;
  }
}
