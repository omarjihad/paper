import type { BotBehavior, BotDifficulty } from '@riqaa/shared';

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

/**
 * معامِل النمط: يضرب أو يزيح أرقام الصعوبة.
 * النمط يغيّر «الأسلوب» والصعوبة تغيّر «الإتقان»، فيتركّبان بحرية.
 */
export interface BehaviorModifier {
  /** الاسم المعروض بالعربية — يظهر مع كلمة «بوت» فلا يُخلط بلاعب حقيقي. */
  label: string;
  trailScale: number;
  depthScale: number;
  huntRadiusScale: number;
  huntChanceScale: number;
  cautionScale: number;
  dangerScale: number;
  /** يفضّل الخرجات البعيدة عن أرضه (استكشاف) بدل اللصق بالحافة. */
  roam: number;
  /** يطارد فقط من كان مكشوفًا وبعيدًا عن أرضه (انتهازي). */
  opportunistic: boolean;
}

export const BOT_BEHAVIORS_TABLE: Record<BotBehavior, BehaviorModifier> = {
  explorer: {
    label: 'مستكشف',
    trailScale: 1.35,
    depthScale: 1.5,
    huntRadiusScale: 0.4,
    huntChanceScale: 0.25,
    cautionScale: 0.8,
    dangerScale: 0.9,
    roam: 1,
    opportunistic: false,
  },
  defensive: {
    label: 'مدافع',
    trailScale: 0.55,
    depthScale: 0.6,
    huntRadiusScale: 0.3,
    huntChanceScale: 0.1,
    cautionScale: 1.6,
    dangerScale: 1.5,
    roam: 0,
    opportunistic: false,
  },
  aggressive: {
    label: 'مهاجم',
    trailScale: 1.1,
    depthScale: 0.9,
    huntRadiusScale: 1.6,
    huntChanceScale: 2.1,
    cautionScale: 0.45,
    dangerScale: 0.7,
    roam: 0.4,
    opportunistic: false,
  },
  opportunist: {
    label: 'متربّص',
    trailScale: 0.85,
    depthScale: 0.8,
    huntRadiusScale: 1.3,
    huntChanceScale: 1.5,
    cautionScale: 1.1,
    dangerScale: 1.1,
    roam: 0.2,
    opportunistic: true,
  },
  balanced: {
    label: 'متوازن',
    trailScale: 1,
    depthScale: 1,
    huntRadiusScale: 1,
    huntChanceScale: 1,
    cautionScale: 1,
    dangerScale: 1,
    roam: 0.5,
    opportunistic: false,
  },
};

/** يدمج الصعوبة مع النمط في ملف أرقام واحد يقرأه البوت. */
export function resolveBotProfile(difficulty: BotDifficulty, behavior: BotBehavior): ResolvedBotProfile {
  const base = BOT_PROFILES[difficulty];
  const mod = BOT_BEHAVIORS_TABLE[behavior];
  return {
    maxTrail: Math.max(6, Math.round(base.maxTrail * mod.trailScale)),
    minDepth: Math.max(2, Math.round(base.minDepth * mod.depthScale)),
    maxDepth: Math.max(3, Math.round(base.maxDepth * mod.depthScale)),
    huntRadius: Math.round(base.huntRadius * mod.huntRadiusScale),
    huntChance: clamp01(base.huntChance * mod.huntChanceScale),
    caution: clamp01(base.caution * mod.cautionScale),
    dangerRadius: Math.max(2, Math.round(base.dangerRadius * mod.dangerScale)),
    roam: mod.roam,
    opportunistic: mod.opportunistic,
  };
}

export interface ResolvedBotProfile extends BotProfile {
  roam: number;
  opportunistic: boolean;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
