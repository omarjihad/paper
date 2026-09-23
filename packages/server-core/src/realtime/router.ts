import {
  APP_VERSION,
  NET_PROTOCOL_VERSION,
  type ClientMessage,
  type RegionId,
} from '@riqaa/shared';
import { verifyToken } from '../auth/session.js';
import type { PlayerRepository } from '../players/player.repository.js';
import { regionCatalog } from '../room/regions.js';
import type { ClientLink } from '../room/room.js';
import type { RoomManager } from '../room/roomManager.js';

/**
 * جلسة لاعب على مستوى البروتوكول — بلا أي أثر لنوع المقبس.
 * كل وقت تشغيل يصنع `link` بطريقته (ws في Node، WebSocketPair في Workers)
 * ويسلّمها إلى هذا الموجّه.
 */
export interface ProtocolSession {
  readonly link: ClientLink;
  /** يُملأ بعد تحقق ناجح من رمز الجلسة، ولا يُقرأ من رسالة العميل أبدًا. */
  playerId: string | null;
  /** آخر إشارة حياة من هذه الوصلة. */
  lastSeen: number;
  /** متى أُرسلت آخر نبضة، لقياس زمن الذهاب والإياب من الرد عليها. */
  pingAt: number;
  /** متوسط متحرّك لزمن الاستجابة كما قاسه الخادم. */
  rtt: number;
  /** قطع الوصلة فورًا — الطريقة تختلف بين ws و WebSocketPair. */
  terminate(): void;
}

/**
 * فحص حيوية الوصلات وقياس زمنها.
 * النبضة هنا ليست للحياة فقط: منها يُشتق زمن الاستجابة الذي يقرّر حصة
 * اللاعب من اللقطات، فيجب أن تكون متقاربة بما يكفي ليواكب القرارُ الشبكةَ.
 */
export const HEARTBEAT_MS = 4000;
/**
 * كم من الصمت يعني وصلة ميتة فعلًا.
 * المتصفح يخنق المؤقتات حين يُصغَّر التطبيق، فتتأخر نبضات العميل؛ قطعُ
 * الوصلة عند أول نبضة فائتة يعني طرد كل من صغّر تيليجرام لحظة.
 */
export const SILENCE_LIMIT_MS = 70000;

export interface RouterDeps {
  sessionSecret: string;
  players: PlayerRepository;
  rooms: RoomManager;
  serverRegion: RegionId;
  log: (message: string) => void;
}

/**
 * موجّه رسائل اللعب اللحظي.
 *
 * قاعدة واحدة تحكم هذا الملف كله: العميل لا يرسل إلا نيّة حركة.
 * الاسم والصورة والهوية تُشتق من رمز الجلسة الموقَّع ومن قاعدة البيانات،
 * والنتائج والمساحات والعملات تُحسب في الغرفة على الخادم. أي حقل يرسله
 * العميل خارج (الزاوية، نسبة السرعة، معرّف السيرفر) يُتجاهل أو يُتحقّق منه.
 *
 * استُخرج من بوابة Node كي يعمل الحرفُ نفسه داخل Cloudflare Worker: قواعد
 * الثقة أخطر من أن تُكتب مرّتين وتفترقا بصمت.
 */
export class ProtocolRouter {
  /** وصلة واحدة فقط لكل لاعب — تمنع الجلسات المكرّرة. */
  private readonly byPlayer = new Map<string, ProtocolSession>();
  private readonly sessions = new Set<ProtocolSession>();

  constructor(private readonly deps: RouterDeps) {}

  /** تُستدعى فور فتح المقبس، قبل أي رسالة. */
  open(session: ProtocolSession): void {
    this.sessions.add(session);
  }

  /**
   * نبضة دورية على كل الوصلات: تقطع الميتة، وتقيس زمن الحيّة.
   * يقودها كل وقت تشغيل بمؤقّته الخاص، والمنطق واحد للجميع.
   */
  heartbeat(): void {
    const now = Date.now();
    for (const session of this.sessions) {
      if (now - session.lastSeen > SILENCE_LIMIT_MS) {
        session.terminate();
        continue;
      }
      session.pingAt = now;
      session.link.send({ t: 'ping', n: now });
    }
  }

  /** نصّ خام وصل من العميل. يعيد الخطأ عبر السجلّ لا عبر الاستثناء. */
  async handleRaw(session: ProtocolSession, raw: string): Promise<void> {
    session.lastSeen = Date.now();
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    try {
      await this.handle(session, message);
    } catch (error) {
      this.deps.log(`خطأ في معالجة رسالة لحظية: ${(error as Error).message}`);
    }
  }

  async handle(session: ProtocolSession, message: ClientMessage): Promise<void> {
    switch (message.t) {
      case 'hello':
        await this.onHello(session, String(message.token ?? ''), message.v);
        return;
      case 'ping':
        // قياس زمن حقيقي: العميل يوقّت الذهاب والإياب بنفسه.
        session.link.send({ t: 'pong', n: message.n });
        return;
      case 'pong':
        this.recordRtt(session, message.n);
        return;
      default:
        break;
    }

    const playerId = session.playerId;
    if (!playerId) {
      session.link.close('unauthorized', 'الجلسة غير مُصادَقة');
      return;
    }

    switch (message.t) {
      case 'lobby':
        this.deps.rooms.watch(playerId, session.link);
        return;

      case 'join': {
        const profile = await this.deps.players.findById(playerId);
        if (!profile) {
          session.link.close('player_not_found', 'لم يتم العثور على اللاعب');
          return;
        }
        const result = this.deps.rooms.join(
          {
            playerId,
            // الاسم والصورة من قاعدة البيانات لا من رسالة العميل.
            name: displayName(profile.firstName, profile.lastName),
            avatarUrl: profile.avatarUrl,
            link: session.link,
          },
          String(message.id ?? ''),
        );
        if (!result.ok) session.link.send({ t: 'error', code: 'join_failed', message: result.reason });
        return;
      }

      case 'start': {
        const started = this.deps.rooms.begin(playerId);
        if (!started.ok) session.link.send({ t: 'error', code: 'start_failed', message: started.reason });
        return;
      }

      case 'input':
        this.deps.rooms.input(playerId, Number(message.h), Number(message.r));
        return;
      case 'leave':
        this.deps.rooms.leave(playerId);
        return;
      default:
        return;
    }
  }

  /**
   * زمن الذهاب والإياب كما قاسه الخادم من نبضته هو.
   * نتجاهل أي ردّ لا يطابق النبضة الأخيرة كي لا يستطيع عميلٌ أن يدّعي
   * زمنًا أفضل من الحقيقة فيأخذ حصةً أكبر من اللقطات.
   */
  private recordRtt(session: ProtocolSession, echoed: number): void {
    if (session.pingAt === 0 || echoed !== session.pingAt) return;
    const sample = Math.max(0, Date.now() - session.pingAt);
    session.pingAt = 0;
    // متوسط متحرّك: قرار التخفيف يجب ألّا يتأرجح مع كل قفزة عابرة.
    session.rtt = session.rtt === 0 ? sample : Math.round(session.rtt * 0.7 + sample * 0.3);
  }

  /** تُستدعى عند إغلاق المقبس مهما كان سببه. */
  disconnect(session: ProtocolSession): void {
    this.sessions.delete(session);
    const playerId = session.playerId;
    if (!playerId) return;
    if (this.byPlayer.get(playerId) === session) this.byPlayer.delete(playerId);
    this.deps.rooms.disconnect(playerId);
  }

  private async onHello(session: ProtocolSession, token: string, version: number): Promise<void> {
    if (version !== NET_PROTOCOL_VERSION) {
      session.link.close('protocol_mismatch', 'نسخة اللعبة قديمة، أعد فتحها من تيليجرام');
      return;
    }
    let playerId: string;
    try {
      playerId = verifyToken(token, this.deps.sessionSecret).sub;
    } catch {
      session.link.close('unauthorized', 'الجلسة غير صالحة، أعد فتح اللعبة');
      return;
    }

    const profile = await this.deps.players.findById(playerId);
    if (!profile) {
      session.link.close('player_not_found', 'لم يتم العثور على اللاعب');
      return;
    }

    // جلسة واحدة لكل لاعب: الوصلة القديمة تُغلق فورًا.
    const previous = this.byPlayer.get(playerId);
    if (previous && previous !== session) {
      previous.playerId = null;
      previous.link.close('duplicate_session', 'تم فتح اللعبة في مكان آخر');
    }

    session.playerId = playerId;
    this.byPlayer.set(playerId, session);

    session.link.send({
      t: 'welcome',
      v: NET_PROTOCOL_VERSION,
      version: APP_VERSION,
      regions: regionCatalog(this.deps.serverRegion),
      serverRegion: this.deps.serverRegion,
      name: displayName(profile.firstName, profile.lastName),
    });

    // إن كان داخل غرفة قائمة، تعود حالته كما هي ضمن مهلة السماح.
    this.deps.rooms.resume(playerId, session.link);
  }
}

export function displayName(firstName: string, lastName: string | null): string {
  return [firstName, lastName].filter(Boolean).join(' ').trim() || 'لاعب';
}
