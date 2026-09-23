import type { Actor } from '../types.js';
import { placeAt, type UnpackedActor } from './sync.js';

export interface ReconcileOptions {
  /** سرعة اللعبة بالخلايا في الثانية. */
  speed: number;
  /** زمن الذهاب والإياب المقاس فعلًا. */
  latencyMs: number;
  /**
   * كم من زمن الرحلة نستقرئه للأمام.
   * ليس 1 لأن زاوية الخادم قديمة أثناء الانعطاف، فالاستقراء الكامل يتجاوز
   * الهدف. 0.75 أقلّ الخيارات خطأً على مدى 150…700 م.ث (قياس، لا تقدير).
   */
  leadFactor?: number;
  /** عمر اللقطة منذ وصولها. */
  ageMs?: number;
  /** فارق يُتجاهل تمامًا: هو تأخير شبكة لا خطأ محاكاة. */
  deadZone?: number;
  /** نسبة التقريب في كل لقطة عند فارق متوسط (0..1). */
  blend?: number;
  /** فارق يعني انفصالًا حقيقيًا لا تأخيرًا: يُصحَّح قفزًا. */
  hardSnap?: number;
}

export type ReconcileResult = 'ignored' | 'blended' | 'snapped';

const DEFAULTS = { deadZone: 0.9, blend: 0.2, hardSnap: 8, leadFactor: 0.75 };
/**
 * التصحيح المعاكس لاتجاه السير هو وحده ما يُحسّ كـ«تعليق».
 * لذلك نسمح به بخُمس قوة التصحيح الجانبي: يبطئ قليلًا ولا يسحب أحدًا للخلف.
 */
const BACKWARD_DAMPING = 0.2;

/**
 * مطابقة موضع اللاعب المحلي مع الخادم.
 *
 * اللقطة تصف ماضيًا: غادرت الخادم قبل نصف رحلة، ونيّة اللاعب وصلته قبل نصف
 * رحلة أخرى. لذلك مقارنة موضع الخادم بموضعنا «كما هو» تقارن زمنين مختلفين،
 * فتُظهر فارقًا ليس خطأً — ومعالجته بالقفز تسحب اللاعب للخلف عشرات المرات
 * في الثانية. هذا ما يجعل الحركة «تعلك» على شبكة الهاتف.
 *
 * فالصواب: نستقرئ موضع الخادم للأمام بزمن الرحلة، ثم:
 *  • فارق صغير ⇒ لا شيء. التنبؤ المحلي أصدق لأنه يعرف إدخال اللاعب الآن.
 *  • فارق متوسط ⇒ تقريب ناعم لا يُرى.
 *  • فارق كبير ⇒ انفصال حقيقي، فيُصحَّح قفزًا.
 *
 * والزاوية لا تُلمَس أبدًا: هي إدخال اللاعب في هذه اللحظة، وكتابتها من لقطة
 * قديمة تعني إلغاء انعطافه بعد أن بدأه.
 */
export function reconcileLocal(
  actor: Actor,
  state: UnpackedActor,
  options: ReconcileOptions,
): ReconcileResult {
  const deadZone = options.deadZone ?? DEFAULTS.deadZone;
  const blend = options.blend ?? DEFAULTS.blend;
  const hardSnap = options.hardSnap ?? DEFAULTS.hardSnap;

  const leadFactor = options.leadFactor ?? DEFAULTS.leadFactor;
  const leadSeconds = Math.max(0, options.latencyMs * leadFactor + (options.ageMs ?? 0)) / 1000;
  const lead = options.speed * leadSeconds;
  const predictedX = state.x + Math.cos(state.heading) * lead;
  const predictedY = state.y + Math.sin(state.heading) * lead;

  const dx = predictedX - actor.x;
  const dy = predictedY - actor.y;
  const error = Math.hypot(dx, dy);

  if (error <= deadZone) return 'ignored';

  if (error >= hardSnap) {
    // انفصال حقيقي (عودة من انقطاع، أو تخطٍّ في المحاكاة): زاوية اللاعب تبقى له.
    placeAt(actor, predictedX, predictedY, actor.heading);
    return 'snapped';
  }

  // نفكّك التصحيح إلى مركّبة على اتجاه السير وأخرى عمودية عليه.
  const forwardX = Math.cos(actor.heading);
  const forwardY = Math.sin(actor.heading);
  const along = dx * forwardX + dy * forwardY;
  const crossX = dx - along * forwardX;
  const crossY = dy - along * forwardY;

  // الجانبي يُصحَّح كاملًا (لا يكاد يُرى)، والرجوعي بخُمس القوة (لا يُحس كتعليق).
  const alongGain = along >= 0 ? blend : blend * BACKWARD_DAMPING;
  placeAt(
    actor,
    actor.x + crossX * blend + along * alongGain * forwardX,
    actor.y + crossY * blend + along * alongGain * forwardY,
    actor.heading,
  );
  return 'blended';
}
