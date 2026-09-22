import type { BotDifficulty, MatchConfig } from '@riqaa/shared';

/** الاتجاهات الأربعة. الترتيب مهم: العكس = (dir + 2) % 4 */
export const DIR_RIGHT = 0;
export const DIR_DOWN = 1;
export const DIR_LEFT = 2;
export const DIR_UP = 3;

export type Dir = 0 | 1 | 2 | 3;

export const DX: readonly number[] = [1, 0, -1, 0];
export const DY: readonly number[] = [0, 1, 0, -1];

export const TAU = Math.PI * 2;
export const HALF_PI = Math.PI / 2;

/** زاوية الاتجاه الأصلي بالراديان. */
export function dirToHeading(dir: Dir): number {
  return dir * HALF_PI;
}

/** أقرب اتجاه أصلي لزاوية — يستخدمه منطق البوتات كما هو. */
export function headingToDir(heading: number): Dir {
  const angle = ((heading % TAU) + TAU) % TAU;
  return (Math.round(angle / HALF_PI) % 4) as Dir;
}

export type ActorKind = 'human' | 'bot';

/** حالة مشارك واحد داخل المحاكاة. تُعاد استخدامها ولا يُعاد إنشاؤها أثناء الجولة. */
export interface Actor {
  /** 1..255 — الصفر محجوز لمعنى "لا أحد" داخل شبكة الملكية. */
  id: number;
  kind: ActorKind;
  name: string;
  colorIndex: number;
  difficulty: BotDifficulty | null;
  alive: boolean;
  /**
   * الموضع المستمر بوحدة الخلية (مركز اللاعب).
   * الأرض تُحتسب على شبكة، أما الحركة فحرة بإحداثيات عشرية.
   */
  x: number;
  y: number;
  /** زاوية الحركة بالراديان — أي زاوية من 360 درجة. */
  heading: number;
  /** الخلية التي يقف فيها الآن، مشتقة من الموضع. */
  cx: number;
  cy: number;
  /** أقرب اتجاه أصلي للزاوية — لمنطق البوتات فقط. */
  dir: Dir;
  /** فهارس خلايا المسار بالترتيب. */
  trail: number[];
  /** هل اللاعب خارج منطقته الآن (أي أن له مسارًا مكشوفًا). */
  outside: boolean;
  /** فهرس الخلية التي خرج منها — نقطة العودة الآمنة. */
  exitCell: number;
  area: number;
  kills: number;
  deaths: number;
  /** وقت العودة للبوتات (بالثواني منذ بداية الجولة)، -1 = لا عودة مجدولة. */
  respawnAt: number;
  /** الصندوق المحيط بأرض اللاعب — يقلّص كلفة خوارزمية الملء. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** true عندما تمنع الحدود الحركة (يُستخدم للرسم والذكاء فقط). */
  blocked: boolean;
}

export type GameStatus = 'running' | 'ended';

export type EndReason = 'eliminated' | 'timeup' | 'quit' | 'lastStanding';

export type GameEvent =
  | { type: 'capture'; actorId: number; gained: number }
  | { type: 'kill'; killerId: number; victimId: number }
  | { type: 'death'; actorId: number; cause: 'self' | 'trail' | 'collision' | 'wiped' }
  | { type: 'respawn'; actorId: number }
  | { type: 'end'; reason: EndReason };

/** واجهة القراءة التي يراها الذكاء الاصطناعي — لا يستطيع تعديل الحالة. */
export interface WorldView {
  readonly width: number;
  readonly height: number;
  readonly elapsed: number;
  readonly actors: readonly Actor[];
  ownerAt(x: number, y: number): number;
  trailAt(x: number, y: number): number;
  inBounds(x: number, y: number): boolean;
  actorById(id: number): Actor | undefined;
}

/** نيّة حركة تناظرية: زاوية حرة + نسبة سرعة. */
export interface MoveIntent {
  /** بالراديان، أي زاوية. */
  heading: number;
  /** 0..1 — نسبة من السرعة القصوى. */
  throttle: number;
}

/**
 * مصدر الإدخال لأي مشارك: لاعب بشري، بوت، أو لاحقًا حزمة قادمة من الشبكة.
 * المحرك لا يعرف ولا يهتم من أين جاء الاتجاه.
 */
export interface ActorController {
  readonly actorId: number;
  /**
   * إدخال تناظري يُقرأ كل خطوة محاكاة. له الأولوية على decide.
   * null = لا تغيير على الحركة الحالية.
   */
  intent?(world: WorldView, actor: Actor): MoveIntent | null;
  /** إدخال شبكي يُستدعى عند دخول كل خلية جديدة. null = أبقِ الاتجاه الحالي. */
  decide?(world: WorldView, actor: Actor): Dir | null;
  /** يُستدعى عند موت المشارك أو عودته لتصفير أي تخطيط داخلي. */
  reset?(): void;
}

export interface EngineOptions {
  config: MatchConfig;
  seed: number;
}
