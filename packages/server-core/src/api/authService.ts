import type { AuthRequest, AuthResponse, PlayerProfile } from '@riqaa/shared';
import { issueToken, verifyToken } from '../auth/session.js';
import { summarizeInitData, verifyInitData } from '../auth/telegram.js';
import { notFound, unauthorized } from '../core/errors.js';
import type { PlayerRepository } from '../players/player.repository.js';
import type { RuntimeConfig } from './config.js';

export interface AuthServiceDeps {
  config: RuntimeConfig;
  players: PlayerRepository;
  log: { info(message: string): void; warn(message: string): void };
}

/**
 * تسجيل الدخول.
 *
 * الهوية تُشتق من توقيع تيليجرام وحده: لا حقل من الجسم يُوثَق به قبل نجاح
 * التحقق، ورمز الجلسة الصادر يحمل المعرّف الذي أثبته التوقيع لا الذي ادّعاه
 * العميل. مسار الضيف للتطوير فقط ومغلق حين يكون devAllowGuest = false.
 */
export async function login(body: AuthRequest, deps: AuthServiceDeps): Promise<AuthResponse> {
  const { config, players, log } = deps;

  if (body.initData) {
    let user;
    try {
      const verified = verifyInitData(body.initData, config.telegramBotToken, config.initDataMaxAge);
      user = verified.user;
      // info لا debug: نجاح التحقق يجب أن يظهر في سجل الاستضافة.
      log.info(`تحقق ناجح من initData (صيغة ${verified.variant})`);
    } catch (error) {
      // بلا هذا السطر يكون فشل التحقق صامتًا تمامًا في سجلات الاستضافة.
      log.warn(
        `فشل التحقق من initData: ${(error as Error).message} | ${summarizeInitData(body.initData, config.telegramBotToken)}`,
      );
      throw error;
    }
    const profile = await players.upsertOnLogin({
      telegramId: String(user.id),
      firstName: user.first_name,
      lastName: user.last_name ?? null,
      username: user.username ?? null,
      avatarUrl: user.photo_url ?? null,
    });
    return {
      token: issueToken(profile.telegramId, 'telegram', config.sessionSecret),
      player: profile,
      source: 'telegram',
    };
  }

  // مسار التطوير فقط: فتح اللعبة في متصفح عادي خارج تيليجرام.
  if (body.guest && config.devAllowGuest) {
    const profile = await players.upsertOnLogin(guestIdentity(body.guestId));
    return {
      token: issueToken(profile.telegramId, 'guest', config.sessionSecret),
      player: profile,
      source: 'guest',
    };
  }

  throw unauthorized('telegram_required', 'هذه اللعبة تُفتح من داخل تيليجرام فقط');
}

/** يقرأ معرّف اللاعب من ترويسة Authorization، أو يرمي. */
export function playerIdFromHeader(header: string | null | undefined, sessionSecret: string): string {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    throw unauthorized('token_missing', 'الجلسة غير موجودة، أعد فتح اللعبة من تيليجرام');
  }
  return verifyToken(header.slice(7), sessionSecret).sub;
}

export async function profileOf(playerId: string, players: PlayerRepository): Promise<PlayerProfile> {
  const player = await players.findById(playerId);
  if (!player) throw notFound('player_not_found', 'لم يتم العثور على اللاعب');
  await players.touch(player.telegramId);
  return player;
}

function guestIdentity(guestId: string | undefined) {
  const safe = (guestId ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  const id = safe || Math.random().toString(36).slice(2, 12);
  return {
    telegramId: `guest:${id}`,
    firstName: 'ضيف التطوير',
    lastName: null,
    username: null,
    avatarUrl: null,
  };
}
