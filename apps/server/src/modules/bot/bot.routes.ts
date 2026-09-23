import { timingSafeEqual, utf8 } from '@riqaa/server-core';
import type { FastifyInstance } from 'fastify';
import type { TelegramBot, TelegramUpdate } from '@riqaa/server-core';

export interface BotDeps {
  bot: TelegramBot | null;
  secretToken: string;
}

/** الترويسة التي يرسلها تيليجرام مع كل تحديث عند ضبط secret_token. */
const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

export async function registerBotRoutes(app: FastifyInstance, deps: BotDeps): Promise<void> {
  app.post('/api/telegram/webhook', async (request, reply) => {
    if (!deps.bot) {
      reply.status(503);
      return { error: 'bot_disabled', message: 'بوت تيليجرام غير مفعّل على هذا الخادم' };
    }

    const provided = request.headers[SECRET_HEADER];
    if (typeof provided !== 'string' || !secretMatches(provided, deps.secretToken)) {
      request.log.warn('تحديث تيليجرام مرفوض: secret_token غير مطابق');
      reply.status(401);
      return { error: 'invalid_secret', message: 'مصدر غير موثوق' };
    }

    const update = (request.body ?? {}) as TelegramUpdate;
    const outcome = await deps.bot.handleUpdate(update);

    // نرد 200 دائمًا بعد قبول التحديث كي لا يعيد تيليجرام إرساله بلا نهاية.
    return { ok: true, outcome };
  });
}

function secretMatches(provided: string, expected: string): boolean {
  return timingSafeEqual(utf8(provided), utf8(expected));
}
