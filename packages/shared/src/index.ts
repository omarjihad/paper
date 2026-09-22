/**
 * علامة النسخة المنشورة.
 * تظهر في رسالة الترحيب وفي /api/health وفي سجل الإقلاع،
 * فتكشف فورًا ما إذا كانت الاستضافة تشغّل آخر كود أم نسخة قديمة.
 * ارفعها مع كل تحديث.
 */
export const APP_VERSION = 'V4';

/**
 * العقود المشتركة بين الواجهة والخادم.
 * كل ما يمر عبر الشبكة يُعرَّف هنا مرة واحدة فقط.
 */

/** ملف اللاعب الدائم كما يُخزَّن في قاعدة البيانات ويُعاد للواجهة. */
export interface PlayerProfile {
  telegramId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  lastSeen: string;
  /** إحصاءات الحد الأدنى التي تحتاجها شاشة النتيجة فقط. */
  stats: PlayerStats;
}

export interface PlayerStats {
  rounds: number;
  bestAreaPercent: number;
}

/** مصدر الهوية: تيليجرام الحقيقي أو ضيف تطوير (خارج تيليجرام). */
export type IdentitySource = 'telegram' | 'guest';

export interface AuthRequest {
  /** السلسلة الخام من Telegram.WebApp.initData (لا نثق بأي شيء غيرها). */
  initData?: string;
  /** يُستخدم فقط عندما يكون DEV_ALLOW_GUEST مفعّلًا والصفحة مفتوحة خارج تيليجرام. */
  guest?: boolean;
  /** معرّف ضيف ثابت في المتصفح كي لا يُنشأ ملف جديد مع كل فتح أثناء التطوير. */
  guestId?: string;
}

export interface AuthResponse {
  token: string;
  player: PlayerProfile;
  source: IdentitySource;
}

export interface MatchStartResponse {
  matchId: string;
  /** بذرة عشوائية من الخادم: نفس البذرة تُنتج نفس الخريطة (مهم للطور الشبكي لاحقًا). */
  seed: number;
  config: MatchConfig;
  /** اللاعب المحلي دائمًا في الفهرس 0. */
  participants: MatchParticipant[];
}

export interface MatchConfig {
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  /** خطوة المحاكاة الثابتة بالثانية. */
  tickSeconds: number;
  /** سرعة الحركة بالخلايا في الثانية. */
  speedCellsPerSecond: number;
  /** نصف قطر منطقة البداية بالخلايا. */
  startAreaRadius: number;
  /** مدة الجولة بالثواني (0 = بلا حد). */
  roundSeconds: number;
  /** تأخير عودة البوت بعد خسارته بالثواني. */
  botRespawnSeconds: number;
}

export type BotDifficulty = 'easy' | 'medium' | 'hard';

/** وصف مشارك في الجولة. النوع صريح: إما بشر أو بوت — لا تمويه. */
export type MatchParticipant =
  | { kind: 'human'; actorId: number; name: string; colorIndex: number }
  | { kind: 'bot'; actorId: number; name: string; colorIndex: number; difficulty: BotDifficulty };

export interface MatchResultRequest {
  matchId: string;
  areaPercent: number;
  rank: number;
  participants: number;
  durationMs: number;
  outcome: RoundOutcome;
}

export interface MatchResultResponse {
  areaPercent: number;
  rank: number;
  bestAreaPercent: number;
  rounds: number;
}

export type RoundOutcome = 'survived' | 'eliminated' | 'timeup' | 'quit';

export interface ApiError {
  error: string;
  message: string;
}

/** لوحة ألوان اللاعبين — مشتركة كي يتطابق لون الخادم مع لون الواجهة. */
export const ACTOR_COLORS: readonly string[] = [
  '#35E0A1',
  '#FF6B6B',
  '#7C5CFF',
  '#FFB443',
  '#3FA9FF',
  '#FF5FC4',
  '#9BE24B',
  '#FF8A3D',
  '#38D6D6',
  '#C77DFF',
];

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  gridWidth: 150,
  gridHeight: 150,
  cellSize: 20,
  tickSeconds: 1 / 60,
  speedCellsPerSecond: 7.5,
  startAreaRadius: 3,
  roundSeconds: 180,
  botRespawnSeconds: 4,
};
