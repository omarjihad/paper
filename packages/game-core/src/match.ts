import type { MatchStartResponse } from '@riqaa/shared';
import { BotController } from './bots/botController.js';
import { HumanController } from './controllers.js';
import { GameEngine } from './engine.js';
import type { Actor } from './types.js';

export interface Match {
  engine: GameEngine;
  human: Actor;
  humanController: HumanController;
}

/**
 * يبني جولة من وصف قادم من الخادم.
 * نفس الدالة ستُستخدم لاحقًا على الخادم نفسه عند تفعيل الطور الشبكي.
 */
export function createMatch(descriptor: MatchStartResponse): Match {
  const engine = new GameEngine({ config: descriptor.config, seed: descriptor.seed });

  let human: Actor | undefined;
  let humanController: HumanController | undefined;

  for (const participant of descriptor.participants) {
    const actor = engine.addParticipant({
      id: participant.actorId,
      kind: participant.kind,
      name: participant.name,
      colorIndex: participant.colorIndex,
      difficulty: participant.kind === 'bot' ? participant.difficulty : null,
    });

    if (participant.kind === 'bot') {
      engine.setController(actor.id, new BotController(actor.id, participant.difficulty, engine.rng));
    } else {
      const controller = new HumanController(actor.id);
      engine.setController(actor.id, controller);
      human = actor;
      humanController = controller;
    }
  }

  if (!human || !humanController) {
    throw new Error('الجولة يجب أن تحتوي على لاعب بشري واحد على الأقل');
  }

  return { engine, human, humanController };
}
