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

/**
 * تحكّم لاعب بعيد: يقود مشاركًا على نسخة المرآة نحو آخر موضع أعلنه الخادم.
 *
 * لماذا نقوده بدل أن نضع موضعه مباشرة؟
 * لأن وضع الموضع يقفز فوق منطق دخول الخلايا، فلا يُرسم للاعب البعيد مسار
 * ولا تُحتسب استحواذاته. توجيهه بنيّة حركة يجعله يمر بنفس مسار المحرك تمامًا.
 *
 * بين لقطة وأخرى نستقرئ موضعه من زاويته وسرعته (لا نجمّده)، وحين يكبر الفارق
 * يصحّحه المستوى الأعلى قفزًا — فالاستقراء وسيلة نعومة لا مصدر حقيقة.
 */
export class RemoteController implements ActorController {
  private targetX = 0;
  private targetY = 0;
  private targetHeading = 0;
  private targetThrottle = 1;
  private updatedAt = 0;
  private active = false;

  constructor(
    readonly actorId: number,
    /** سرعة اللعبة بالخلايا في الثانية — تُستخدم في الاستقراء. */
    private readonly speed: number,
    /** أقصى زمن استقراء مسموح به بالثواني، حتى لا يهيم المشارك عند انقطاع البث. */
    private readonly maxExtrapolation = 0.4,
  ) {}

  /** لقطة جديدة من الخادم. */
  setTarget(x: number, y: number, heading: number, throttle: number, now: number): void {
    this.targetX = x;
    this.targetY = y;
    this.targetHeading = heading;
    this.targetThrottle = throttle;
    this.updatedAt = now;
    this.active = true;
  }

  intent(_world: WorldView, actor: Actor): MoveIntent | null {
    if (!this.active) return null;

    const age = Math.min((Date.now() - this.updatedAt) / 1000, this.maxExtrapolation);
    const lead = this.speed * this.targetThrottle * age;
    const px = this.targetX + Math.cos(this.targetHeading) * lead;
    const py = this.targetY + Math.sin(this.targetHeading) * lead;

    const dx = px - actor.x;
    const dy = py - actor.y;
    const distance = Math.hypot(dx, dy);

    // قريب جدًا: نكمل بزاوية الخادم بدل أن نتذبذب حول نقطة.
    if (distance < 0.05) return { heading: this.targetHeading, throttle: this.targetThrottle };

    return {
      heading: Math.atan2(dy, dx),
      // كلما زاد الفارق زادت السرعة كي يلحق، وبلا تجاوز للسرعة القصوى.
      throttle: Math.min(1, Math.max(this.targetThrottle, distance / CATCHUP_CELLS)),
    };
  }

  reset(): void {
    this.active = false;
  }
}

/** المسافة التي يصل عندها اللاحق إلى السرعة القصوى. */
const CATCHUP_CELLS = 1.2;
