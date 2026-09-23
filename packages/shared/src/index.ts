/**
 * علامة النسخة المنشورة.
 * تظهر في رسالة الترحيب وفي /api/health وفي سجل الإقلاع،
 * فتكشف فورًا ما إذا كانت الاستضافة تشغّل آخر كود أم نسخة قديمة.
 * ارفعها مع كل تحديث.
 */
export const APP_VERSION = 'V14';

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

/**
 * أنماط سلوك البوتات. الصعوبة تضبط «مستوى الإتقان»، والنمط يضبط «الأسلوب»،
 * فيتنوّع الخصوم داخل الجولة الواحدة بدل أن يكونوا نسخة واحدة مكرّرة.
 */
export type BotBehavior = 'explorer' | 'defensive' | 'aggressive' | 'opportunist' | 'balanced';

export const BOT_BEHAVIORS: readonly BotBehavior[] = [
  'explorer',
  'defensive',
  'aggressive',
  'opportunist',
  'balanced',
];

/** وصف مشارك في الجولة. النوع صريح: إما بشر أو بوت — لا تمويه. */
export type MatchParticipant =
  | {
      kind: 'human';
      actorId: number;
      name: string;
      colorIndex: number;
      /** صورة تيليجرام كما اشتقّها الخادم من الجلسة — لا تصل من العميل أبدًا. */
      avatarUrl?: string | null;
    }
  | {
      kind: 'bot';
      actorId: number;
      name: string;
      colorIndex: number;
      difficulty: BotDifficulty;
      behavior: BotBehavior;
    };

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

/**
 * مكافأة إخراج خصم من الجولة، بالعملات.
 * موضع واحد للتعديل — لا تكرّر الرقم في أي مكان آخر.
 */
export const KILL_REWARD_COINS = 10;

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

// ===========================================================================
//                       الطور الشبكي: غرف، مطابقة، مناطق
// ===========================================================================

/**
 * إعدادات اللعب الجماعي في موضع واحد.
 * لا تكرّر أيًّا من هذه الأرقام في الخادم أو الواجهة — اقرأها من هنا دائمًا.
 */
export interface MultiplayerConfig {
  /** أقصى عدد مشاركين في الغرفة الواحدة (بشر + بوتات). */
  MAX_PLAYERS_PER_ROOM: number;
  /** أقل عدد لاعبين بشر لبدء الغرفة قبل انتهاء مهلة المطابقة. */
  MIN_PLAYERS_TO_START: number;
  /** مهلة البحث عن خصوم بالمللي ثانية قبل اللجوء إلى ملء البوتات. */
  MATCHMAKING_TIMEOUT: number;
  /** هل يُسمح بملء المقاعد الشاغرة ببوتات معلنة؟ */
  BOT_FILL_ENABLED: boolean;
  /** مدة العد التنازلي قبل انطلاق الجولة. */
  COUNTDOWN_MS: number;
  /** مهلة السماح بالعودة بعد انقطاع الاتصال. */
  RECONNECT_GRACE_MS: number;
  /** معدل بث لقطات الحالة في الثانية. */
  SNAPSHOT_HZ: number;
  /** معدل بث الإطار المفتاحي الكامل (الأرض) في الثانية. */
  KEYFRAME_HZ: number;
  /** معدل محاكاة الخادم في الثانية. */
  TICK_HZ: number;
  /**
   * فوق زمن الاستجابة هذا تُخفَّف حصة اللاعب من اللقطات.
   * وصلة بطيئة لا تستفيد من خمس عشرة لقطة في الثانية: الحزم تتكدّس في
   * الطريق فيزداد التأخير بدل أن ينقص، ثم تنقطع.
   */
  WEAK_LINK_RTT_MS: number;
  /** وزمن استجابة أسوأ من هذا يستحق تخفيفًا أشد. */
  POOR_LINK_RTT_MS: number;
  /** أقصى ما يُسمح بتراكمه في مخزن إرسال لاعب قبل تخطّي لقطته. */
  SEND_BUFFER_LIMIT: number;
  /** عدد السيرفرات المعروضة للاعب. ثابتة كي يجدها الأصدقاء في المكان نفسه. */
  LOBBY_COUNT: number;
}

export const MULTIPLAYER: MultiplayerConfig = {
  MAX_PLAYERS_PER_ROOM: 10,
  MIN_PLAYERS_TO_START: 2,
  // ست ثوانٍ بحثًا عمّن قد لا يأتي تجعل اللعبة تبدو معطّلة قبل أن تبدأ.
  // ثانية ونصف تكفي لالتقاط لاعب ضغط «العب» في اللحظة نفسها تقريبًا.
  // مجموعة حاضرة لا تنتظر إلى الأبد ضغطةَ واحدٍ منهم.
  MATCHMAKING_TIMEOUT: 20000,
  BOT_FILL_ENABLED: true,
  COUNTDOWN_MS: 1000,
  RECONNECT_GRACE_MS: 30000,
  SNAPSHOT_HZ: 15,
  KEYFRAME_HZ: 0.5,
  TICK_HZ: 60,
  WEAK_LINK_RTT_MS: 180,
  POOR_LINK_RTT_MS: 350,
  SEND_BUFFER_LIMIT: 48 * 1024,
  LOBBY_COUNT: 6,
};

/** تقدير جودة الوصلة من زمن الاستجابة المقاس. */
export type LinkGrade = 'good' | 'fair' | 'weak';

export function gradeLink(rttMs: number): LinkGrade {
  if (rttMs <= 0) return 'good';
  if (rttMs < MULTIPLAYER.WEAK_LINK_RTT_MS) return 'good';
  if (rttMs < MULTIPLAYER.POOR_LINK_RTT_MS) return 'fair';
  return 'weak';
}

export const LINK_GRADE_LABEL: Record<LinkGrade, string> = {
  good: 'ممتاز',
  fair: 'متوسط',
  weak: 'ضعيف',
};

/** آلة حالات الجولة. الخادم هو المرجع، والواجهة تتفاعل فقط. */
export type MatchState = 'WAITING' | 'MATCHMAKING' | 'COUNTDOWN' | 'PLAYING' | 'FINISHED';

export type RegionId = 'eu' | 'us' | 'asia' | 'me';

export interface RegionInfo {
  id: RegionId;
  /** الاسم المعروض بالعربية. */
  name: string;
  /**
   * هل يستضيف هذا الخادم هذه المنطقة فعليًا؟
   * منطقة واحدة فقط مستضافة الآن، والبقية تُعرض كخيارات غير مُقاسة —
   * لا نخترع أرقام زمن استجابة لمناطق لا نملك فيها خادمًا.
   */
  hosted: boolean;
}

export const REGIONS: readonly RegionInfo[] = [
  { id: 'eu', name: 'أوروبا', hosted: false },
  { id: 'us', name: 'أمريكا', hosted: false },
  { id: 'asia', name: 'آسيا', hosted: false },
  { id: 'me', name: 'الشرق الأوسط', hosted: false },
];

export const DEFAULT_REGION: RegionId = 'eu';

export function isRegionId(value: unknown): value is RegionId {
  return value === 'eu' || value === 'us' || value === 'asia' || value === 'me';
}

// --------------------------------------------------------------- البروتوكول

/** مسار الاتصال اللحظي. */
export const REALTIME_PATH = '/ws';
/** رقم البروتوكول — يرفض الخادم أي عميل قديم بدل أن يتصرّف بغرابة. */
export const NET_PROTOCOL_VERSION = 1;

/**
 * حالة مشارك واحد داخل اللقطة، كمصفوفة مضغوطة بدل كائن:
 * [id, x*100, y*100, heading*1000, flags, area]
 * الأعداد صحيحة كي يبقى نص JSON قصيرًا — اللقطة تُبث 15 مرة في الثانية.
 */
export type NetActor = [number, number, number, number, number, number];

export const NET_FLAG_ALIVE = 1;
export const NET_FLAG_OUTSIDE = 2;
/** دقة إرسال الموضع (خانتان عشريتان = 1٪ من الخلية). */
export const NET_POS_SCALE = 100;
export const NET_ANGLE_SCALE = 1000;

/** صف في لوحة صدارة الجولة — يبنيه الخادم بالكامل. */
export interface NetLeaderEntry {
  actorId: number;
  name: string;
  kind: 'human' | 'bot';
  colorIndex: number;
  areaPercent: number;
  /** خرج من الجولة نهائيًا. */
  eliminated: boolean;
  avatarUrl: string | null;
}

/** سطر في شريط الإخراجات — أسماء عرض حقيقية كما اعتمدها الخادم. */
export type NetFeedItem =
  | { k: 'kill'; killer: string; victim: string; killerActorId: number; victimActorId: number }
  | { k: 'out'; victim: string; victimActorId: number };

/** أحداث الجولة الموثوقة القادمة من الخادم. */
/** سبب خروج المشارك كما قرّره الخادم. */
export type DeathCause = 'self' | 'trail' | 'collision' | 'wiped';

export const DEATH_CAUSE_TEXT: Record<DeathCause, string> = {
  self: 'ارتطمت بمسارك أنت',
  trail: 'قُطِع مسارك',
  collision: 'اصطدمت بخصم وأنت خارج أرضك',
  wiped: 'فقدت كامل أرضك',
};

export type NetEvent =
  | { e: 'kill'; killerActorId: number; victimActorId: number; x: number; y: number }
  | {
      e: 'death';
      actorId: number;
      eliminated: boolean;
      cause: DeathCause;
      /** من أخرجه، أو null إن لم يكن لأحد يد في ذلك. */
      killerActorId: number | null;
      /** نقطة الحدث بوحدة الخلية — مركز إعادة اللقطة. */
      x: number;
      y: number;
    }
  | { e: 'respawn'; actorId: number }
  | { e: 'capture'; actorId: number; gained: number }
  /** مكافأة مؤكَّدة من الخادم — الواجهة لا تحسب العملات من عندها. */
  | { e: 'coins'; total: number; gained: number };

export interface RoomDescriptor {
  roomId: string;
  region: RegionId;
  seed: number;
  config: MatchConfig;
  participants: MatchParticipant[];
  /** معرّف المشارك الذي يتحكّم به هذا العميل، كما قرّره الخادم. */
  youActorId: number;
  state: MatchState;
  /** الزمن المتبقي قبل الانطلاق (0 إذا انطلقت). */
  startsInMs: number;
  /** عدد اللاعبين البشر في الغرفة — للشفافية لا أكثر. */
  humans: number;
}

export interface NetRoundResult {
  outcome: RoundOutcome;
  rank: number;
  participants: number;
  areaPercent: number;
  /** عملات الجولة كما احتسبها الخادم فقط. */
  coins: number;
  kills: number;
  leaderboard: NetLeaderEntry[];
  matchId: string;
  /** أفضل نسبة مساحة في تاريخ اللاعب، بعد حفظ هذه الجولة. */
  bestAreaPercent: number;
  /** عدد جولاته الكلي بعد حفظ هذه الجولة. */
  rounds: number;
}

/**
 * سيرفر معروض في قائمة الاختيار.
 * `players` بشرٌ فقط — البوتات تملأ المقاعد الشاغرة عند الانطلاق ولا تُحسب
 * هنا، وإلا بدت كل السيرفرات ممتلئة وهي فارغة.
 */
export interface LobbyServer {
  id: string;
  name: string;
  region: RegionId;
  players: number;
  capacity: number;
  state: MatchState;
  /** هل يمكن الانضمام إليه الآن؟ (جولة جارية = لا) */
  joinable: boolean;
}

/** رسائل العميل إلى الخادم: نيّة وإدخال فقط — لا نتائج ولا هوية. */
export type ClientMessage =
  | { t: 'hello'; v: number; token: string }
  /** اشتراك في قائمة السيرفرات وتحديثاتها. */
  | { t: 'lobby' }
  | { t: 'join'; id: string }
  /** بدء الجولة في السيرفر الذي انضم إليه — بضغطة اللاعب لا تلقائيًا. */
  | { t: 'start' }
  | { t: 'input'; h: number; r: number }
  | { t: 'ping'; n: number }
  | { t: 'leave' };

export type ServerMessage =
  | { t: 'welcome'; v: number; version: string; regions: RegionInfo[]; serverRegion: RegionId; name: string }
  | {
      t: 'lobby';
      servers: LobbyServer[];
      /** السيرفر الذي يجلس فيه هذا اللاعب الآن، أو null. */
      yourServerId: string | null;
      serverRegion: RegionId;
    }
  | { t: 'room'; room: RoomDescriptor }
  | { t: 'state'; state: MatchState; startsInMs: number }
  | { t: 'snap'; tick: number; elapsed: number; actors: NetActor[]; lb: NetLeaderEntry[] }
  | { t: 'key'; tick: number; owner: string; trail: string; actors: NetActor[] }
  | { t: 'events'; items: NetEvent[]; feed: NetFeedItem[] }
  | { t: 'over'; result: NetRoundResult }
  | { t: 'pong'; n: number }
  | { t: 'error'; code: string; message: string };

/**
 * حالة وصلة اللعب اللحظي كما تراها الواجهة.
 * «يعيد الاتصال» حالة مؤقتة داخل مهلة السماح، لا انقطاعًا نهائيًا.
 */
export type LinkState = 'connecting' | 'live' | 'reconnecting' | 'lost';
