import {
  APP_VERSION,
  MULTIPLAYER,
  REALTIME_PATH,
  type AuthRequest,
  type ServerMessage,
} from '@riqaa/shared';
import {
  AppError,
  HEARTBEAT_MS,
  ProtocolRouter,
  RoomManager,
  TelegramApi,
  TelegramBot,
  login,
  playerIdFromHeader,
  profileOf,
  regionCatalog,
  timingSafeEqual,
  utf8,
  type ClientLink,
  type ProtocolSession,
  type RuntimeConfig,
  type TelegramUpdate,
} from '@riqaa/server-core';
import { clean, runtimeConfig, webhookSecret, type WorkerEnv } from './config.js';
import { DurablePlayerRepository } from './durableRepository.js';

/** أقصى طول رسالة مقبول من العميل — الإدخال أسطر قصيرة لا غير. */
const MAX_MESSAGE_BYTES = 2048;
/** مسار الـwebhook — ثابت ومعروف للطرفين. */
const WEBHOOK_PATH = '/api/telegram/webhook';

/**
 * خادم اللعب كله داخل كائن واحد دائم.
 *
 * لماذا كائن واحد؟ لأن اللاعبين لا يلتقون إلا إذا كانوا في المكان نفسه.
 * عاملُ Cloudflare عديم الحالة ويعمل في مئات المدن، فلو حُفظت الغرف فيه
 * لرأى كل لاعب قائمة سيرفرات خاصة به. الـDurable Object نسخة واحدة في
 * العالم، وفيها تجلس الغرف الستّ والحلقة الموثوقة وملفّات اللاعبين.
 *
 * كل قواعد اللعب والثقة مستوردة من @riqaa/server-core — وهي الحرف نفسه
 * الذي يعمل على خادم Node، لا نسخةٌ ثانية تفترق عنه بصمت.
 */
export class GameServer implements DurableObject {
  private readonly players: DurablePlayerRepository;
  private readonly config: RuntimeConfig;
  private readonly rooms: RoomManager;
  private readonly router: ProtocolRouter;
  private readonly logs: string[] = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastTick = Date.now();
  private liveSockets = 0;
  /** يمنع تكرار تسجيل الـwebhook في كل طلب. */
  private webhookChecked = false;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: WorkerEnv,
  ) {
    this.config = runtimeConfig(env);
    this.players = new DurablePlayerRepository(ctx.storage);
    this.rooms = new RoomManager(this.players, (message) => this.log(`[سيرفرات] ${message}`), this.config.serverRegion);
    this.router = new ProtocolRouter({
      sessionSecret: this.config.sessionSecret,
      players: this.players,
      rooms: this.rooms,
      serverRegion: this.config.serverRegion,
      log: (message) => this.log(`[لحظي] ${message}`),
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === REALTIME_PATH) return this.openSocket(request);
      return await this.api(request, url);
    } catch (error) {
      if (error instanceof AppError) {
        return json({ error: error.code, message: error.message }, error.statusCode);
      }
      this.log(`خطأ غير متوقع: ${(error as Error).message}`);
      return json({ error: 'internal_error', message: 'حدث خطأ غير متوقع في الخادم' }, 500);
    }
  }

  // --------------------------------------------------------------- المقبس

  private openSocket(request: Request): Response {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return json({ error: 'upgrade_required', message: 'هذا المسار للوصلات اللحظية فقط' }, 426);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.liveSockets++;
    this.startLoop();

    const link: ClientLink = {
      send: (message: ServerMessage) => this.push(server, JSON.stringify(message)),
      sendRaw: (text: string) => this.push(server, text),
      rttMs: () => session.rtt,
      // Workers لا تكشف حجم الطابور، فلا ندّعي قياسًا لا نملكه؛ التخفيف
      // يبقى قائمًا على زمن الوصلة المقاس وهو المؤشّر الأصدق أصلًا.
      saturated: () => false,
      close: (code: string, reason: string) => {
        link.send({ t: 'error', code, message: reason });
        this.shutSocket(server, 4000, code);
      },
    };

    const session: ProtocolSession = {
      link,
      playerId: null,
      lastSeen: Date.now(),
      pingAt: 0,
      rtt: 0,
      terminate: () => this.shutSocket(server, 4001, 'silent'),
    };
    this.router.open(session);

    server.addEventListener('message', (event: MessageEvent) => {
      const raw = typeof event.data === 'string' ? event.data : '';
      // حدّ الطول هنا يقابل maxPayload في خادم Node: الإدخال أسطر قصيرة.
      if (!raw || raw.length > MAX_MESSAGE_BYTES) return;
      void this.router.handleRaw(session, raw);
    });

    let gone = false;
    const onGone = (): void => {
      if (gone) return;
      gone = true;
      this.router.disconnect(session);
      this.liveSockets = Math.max(0, this.liveSockets - 1);
      this.stopLoopIfIdle();
    };

    server.addEventListener('close', (event: CloseEvent) => {
      // إتمام مصافحة الإغلاق بأنفسنا.
      // مكتبة ws في Node تردّ إطار الإغلاق تلقائيًا، أما هنا فلا: بدون هذا
      // السطر يبقى مقبس المتصفح في حالة CLOSING فلا يصله حدث الإغلاق، فلا
      // يعيد الاتصال أبدًا — ينقطع اللاعب ولا يعود.
      this.shutSocket(server, closeCode(event.code), event.reason ?? '');
      onGone();
    });
    server.addEventListener('error', onGone);

    return new Response(null, { status: 101, webSocket: client });
  }

  private push(socket: WebSocket, text: string): void {
    try {
      socket.send(text);
    } catch {
      // وصلة مغلقة أثناء البث: الإغلاق سيصل كحدث ويُنظَّف هناك.
    }
  }

  private shutSocket(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason);
    } catch {
      // مغلقة أصلًا.
    }
  }

  // --------------------------------------------------------------- الحلقة

  /**
   * الحلقة الموثوقة: ستّون نبضة في الثانية تحرّك كل الغرف.
   * تعمل ما دامت هناك وصلة واحدة، وتتوقّف حين يخلو الكائن كي لا تُحسب
   * ثوانٍ لا لاعب فيها.
   */
  private startLoop(): void {
    if (this.tickTimer) return;
    this.lastTick = Date.now();
    this.tickTimer = setInterval(() => {
      const now = Date.now();
      this.lastTick = now;
      try {
        this.rooms.pump();
      } catch (error) {
        this.log(`خطأ في النبضة: ${(error as Error).message}`);
      }
    }, Math.round(1000 / MULTIPLAYER.TICK_HZ));
    this.heartbeatTimer = setInterval(() => this.router.heartbeat(), HEARTBEAT_MS);
  }

  private stopLoopIfIdle(): void {
    if (this.liveSockets > 0) return;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.tickTimer = null;
    this.heartbeatTimer = null;
  }

  // --------------------------------------------------------------- المسارات

  private async api(request: Request, url: URL): Promise<Response> {
    const path = url.pathname;

    // لا إقلاع في العامل يُسجَّل عنده الـwebhook مرّة، فنسجّله كسولًا عند أول
    // طلب بعد كل نشر. بدونه لا يردّ البوت على /start فلا يجد اللاعب مدخلًا.
    void this.ensureWebhook();

    if (path === '/api/health') {
      return json({
        ok: true,
        version: APP_VERSION,
        storage: this.players.kind,
        telegram: this.config.telegramBotToken ? 'configured' : 'missing',
        bot: this.config.telegramBotToken && clean(this.env.PUBLIC_URL) ? 'enabled' : 'disabled',
        realtime: this.rooms.stats,
        region: this.config.serverRegion,
        runtime: 'cloudflare',
        colo: request.cf?.colo ?? null,
      });
    }

    if (path === '/api/regions') {
      return json({
        regions: regionCatalog(this.config.serverRegion),
        serverRegion: this.config.serverRegion,
        config: {
          lobbyCount: MULTIPLAYER.LOBBY_COUNT,
          maxPlayersPerRoom: MULTIPLAYER.MAX_PLAYERS_PER_ROOM,
          minPlayersToStart: MULTIPLAYER.MIN_PLAYERS_TO_START,
          matchmakingTimeout: MULTIPLAYER.MATCHMAKING_TIMEOUT,
          botFillEnabled: MULTIPLAYER.BOT_FILL_ENABLED,
        },
        servers: this.rooms.listServers(),
      });
    }

    if (path === '/api/auth/telegram' && request.method === 'POST') {
      const body = (await readJson(request)) as AuthRequest;
      return json(
        await login(body, {
          config: this.config,
          players: this.players,
          log: { info: (m) => this.log(m), warn: (m) => this.log(m) },
        }),
      );
    }

    if (path === '/api/me') {
      const playerId = playerIdFromHeader(request.headers.get('authorization'), this.config.sessionSecret);
      return json(await profileOf(playerId, this.players));
    }

    if (path === '/api/telegram/webhook' && request.method === 'POST') {
      return this.webhook(request);
    }

    if (path === '/api/client-error' && request.method === 'POST') {
      const body = (await readJson(request)) as { message?: string };
      this.log(`[واجهة] ${String(body.message ?? '').slice(0, 300)}`);
      return json({ ok: true });
    }

    return json({ error: 'not_found', message: 'المسار غير موجود' }, 404);
  }

  /**
   * تسجيل الـwebhook عند الحاجة فقط.
   * العنوان المسجَّل يُحفَظ في التخزين، فلا نُتعب تيليجرام بطلبٍ في كل نشر
   * ما لم يتغيّر العنوان أو الرمز فعلًا. الفشل لا يُسقط شيئًا.
   */
  private async ensureWebhook(): Promise<void> {
    if (this.webhookChecked) return;
    this.webhookChecked = true;

    const publicUrl = clean(this.env.PUBLIC_URL);
    const token = this.config.telegramBotToken;
    if (!token || !publicUrl) return;

    const target = `${publicUrl}${WEBHOOK_PATH}`;
    const secret = webhookSecret(this.env);
    const stamp = `${target}|${secret.slice(0, 8)}`;
    const registered = await this.ctx.storage.get<string>('webhook');
    if (registered === stamp) return;

    try {
      await new TelegramApi(token).setWebhook({
        url: target,
        secret_token: secret,
        allowed_updates: ['message'],
      });
      await this.ctx.storage.put('webhook', stamp);
      this.log(`سُجّل webhook تيليجرام على ${target}`);
    } catch (error) {
      // نسمح بإعادة المحاولة في الطلب التالي بدل تثبيت الفشل.
      this.webhookChecked = false;
      this.log(`فشل تسجيل webhook تيليجرام على ${target}: ${(error as Error).message}`);
    }
  }

  private async webhook(request: Request): Promise<Response> {
    const provided = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
    if (!timingSafeEqual(utf8(provided), utf8(webhookSecret(this.env)))) {
      return json({ error: 'forbidden', message: 'رمز التحقق غير صحيح' }, 403);
    }
    const publicUrl = clean(this.env.PUBLIC_URL);
    const token = this.config.telegramBotToken;
    if (!token || !publicUrl) return json({ ok: true, outcome: 'ignored' });

    const bot = new TelegramBot(new TelegramApi(token), publicUrl, {
      info: (m) => this.log(m),
      warn: (m) => this.log(m),
      error: (m) => this.log(m),
    });
    const outcome = await bot.handleUpdate((await readJson(request)) as TelegramUpdate);
    // نرد 200 دائمًا بعد قبول التحديث كي لا يعيد تيليجرام إرساله بلا نهاية.
    return json({ ok: true, outcome });
  }

  /** سجلّ قصير يظهر في `wrangler tail` وفي آخر الأخطاء. */
  private log(message: string): void {
    this.logs.push(message);
    if (this.logs.length > 50) this.logs.shift();
    console.log(message);
  }
}

/**
 * رمز إغلاق صالح للإرسال. الرموز 1005 و1006 تُولَّد داخليًا ويُرفض إرسالها،
 * وإرسال رمز مرفوض يرمي استثناءً فيضيع الإغلاق أصلًا.
 */
function closeCode(code: number): number {
  if (code === 1000 || (code >= 3000 && code <= 4999)) return code;
  return 1000;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
