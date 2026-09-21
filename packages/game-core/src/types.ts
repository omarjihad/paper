import type { BotDifficulty, MatchConfig } from '@riqaa/shared';

/** الاتجاهات الأربعة. الترتيب مهم: العكس = (dir + 2) % 4 */
export const DIR_RIGHT = 0;
export const DIR_DOWN = 1;
export const DIR_LEFT = 2;
export const DIR_UP = 3;

export type Dir = 0 | 1 | 2 | 3;

export const DX: readonly number[] = [1, 0, -1, 0];
export const DY: readonly number[] = [0, 1, 0, -1];

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
  /** الخلية الحالية. */
  cx: number;
  cy: number;
  dir: Dir;
  nextDir: Dir;
  /** 0..1 — الموضع بين الخلية الحالية والتالية (للرسم السلس فقط). */
  progress: number;
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

/**
 * مصدر الإدخال لأي مشارك: لاعب بشري، بوت، أو لاحقًا حزمة قادمة من الشبكة.
 * المحرك لا يعرف ولا يهتم من أين جاء الاتجاه.
 */
export interface ActorController {
  readonly actorId: number;
  /** يُستدعى عند كل عبور لحدود خلية. null = أبقِ الاتجاه الحالي. */
  decide(world: WorldView, actor: Actor): Dir | null;
  /** يُستدعى عند موت المشارك أو عودته لتصفير أي تخطيط داخلي. */
  reset?(): void;
}

export interface EngineOptions {
  config: MatchConfig;
  seed: number;
}
