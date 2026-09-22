import type { MatchConfig, MatchParticipant, MatchStartResponse } from '@riqaa/shared';
import { BotController } from './bots/botController.js';
import { HumanController, RemoteController } from './controllers.js';
import { GameEngine } from './engine.js';
import type { Actor } from './types.js';

export interface WorldOptions {
  config: MatchConfig;
  seed: number;
  participants: readonly MatchParticipant[];
  /** المشارك الذي يقوده هذا الجهاز؛ 0 = لا أحد (الخادم مثلًا). */
  localActorId?: number;
  /** false = نسخة مرآة لا تُصدر أحكامًا. */
  authoritative?: boolean;
  /** هل تنتهي الجولة بموت اللاعب البشري؟ */
  endOnHumanDeath?: boolean;
  /**
   * true = كل من عدا المشارك المحلي تقوده لقطات الخادم.
   * البوتات أيضًا: تشغيلها محليًا يعني مولّدَي عشوائية مستقلَّين فتنفصل
   * نسخة الجهاز عن نسخة الخادم خلال ثوانٍ.
   */
  networked?: boolean;
}

export interface World {
  engine: GameEngine;
  /** المشارك المحلي، إن وُجد. */
  local: Actor | null;
  localController: HumanController | null;
  /** وحدات تحكّم المشاركين البعيدين، مفهرسة بمعرّف المشارك. */
  remotes: Map<number, RemoteController>;
  /** وحدات تحكّم اللاعبين البشر على الخادم، مفهرسة بمعرّف المشارك. */
  humans: Map<number, HumanController>;
}

/**
 * يبني عالم جولة من وصف واحد.
 * نفس الدالة تُستخدم على الخادم (المرجع) وعلى الجهاز (المرآة)،
 * والفرق كله في الخيارات لا في الكود.
 */
export function buildWorld(options: WorldOptions): World {
  const engine = new GameEngine({
    config: options.config,
    seed: options.seed,
    authoritative: options.authoritative ?? true,
    endOnHumanDeath: options.endOnHumanDeath ?? true,
  });

  if (options.localActorId !== undefined) engine.focusActorId = options.localActorId;

  const remotes = new Map<number, RemoteController>();
  const humans = new Map<number, HumanController>();
  let local: Actor | null = null;
  let localController: HumanController | null = null;

  for (const participant of options.participants) {
    const actor = engine.addParticipant({
      id: participant.actorId,
      kind: participant.kind,
      name: participant.name,
      colorIndex: participant.colorIndex,
      difficulty: participant.kind === 'bot' ? participant.difficulty : null,
    });

    const isLocal = options.localActorId !== undefined && actor.id === options.localActorId;

    if (isLocal) {
      const controller = new HumanController(actor.id);
      engine.setController(actor.id, controller);
      local = actor;
      localController = controller;
      humans.set(actor.id, controller);
      continue;
    }

    if (options.networked) {
      const controller = new RemoteController(actor.id, options.config.speedCellsPerSecond);
      engine.setController(actor.id, controller);
      remotes.set(actor.id, controller);
      continue;
    }

    if (participant.kind === 'bot') {
      engine.setController(
        actor.id,
        new BotController(actor.id, participant.difficulty, engine.rng, participant.behavior),
      );
    } else {
      // لاعب بشري على الخادم: إدخاله يصل من الشبكة عبر وحدة التحكّم هذه.
      const controller = new HumanController(actor.id);
      engine.setController(actor.id, controller);
      humans.set(actor.id, controller);
    }
  }

  return { engine, local, localController, remotes, humans };
}

export interface Match {
  engine: GameEngine;
  human: Actor;
  humanController: HumanController;
}

/**
 * الجولة الفردية المحلية (بوتات على الجهاز) — المسار الاحتياطي حين
 * يتعذّر الوصول إلى خادم اللعب الجماعي.
 */
export function createMatch(descriptor: MatchStartResponse): Match {
  const humanId = descriptor.participants.find((p) => p.kind === 'human')?.actorId;
  const world = buildWorld({
    config: descriptor.config,
    seed: descriptor.seed,
    participants: descriptor.participants,
    localActorId: humanId,
  });

  if (!world.local || !world.localController) {
    throw new Error('الجولة يجب أن تحتوي على لاعب بشري واحد على الأقل');
  }
  return { engine: world.engine, human: world.local, humanController: world.localController };
}
