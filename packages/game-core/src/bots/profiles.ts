import type { BotDifficulty } from '@riqaa/shared';

/**
 * معايير سلوك البوت. كل مستوى صعوبة = أرقام مختلفة، لا كود مختلف —
 * لذلك تطوير الذكاء لاحقًا يتم بتعديل الأرقام أو بإضافة سلوك جديد دون لمس المحرك.
 */
export interface BotProfile {
  /** أقصى طول مسار قبل أن يقرر العودة. */
  maxTrail: number;
  /** أقل/أكثر عمق للخرجة الواحدة. */
  minDepth: number;
  maxDepth: number;
  /** مدى البحث عن مسار خصم لمهاجمته (0 = لا يهاجم). */
  huntRadius: number;
  /** احتمال اختيار الهجوم بدل التوسّع عند كل خرجة. */
  huntChance: number;
  /** احتمال الانسحاب عند استشعار خطر قريب. */
  caution: number;
  /** المسافة التي يعتبرها خطرًا. */
  dangerRadius: number;
}

export const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  easy: {
    maxTrail: 16,
    minDepth: 3,
    maxDepth: 6,
    huntRadius: 0,
    huntChance: 0,
    caution: 0.2,
    dangerRadius: 4,
  },
  medium: {
    maxTrail: 28,
    minDepth: 4,
    maxDepth: 9,
    huntRadius: 12,
    huntChance: 0.3,
    caution: 0.55,
    dangerRadius: 6,
  },
  hard: {
    maxTrail: 42,
    minDepth: 5,
    maxDepth: 13,
    huntRadius: 20,
    huntChance: 0.6,
    caution: 0.85,
    dangerRadius: 8,
  },
};
