import {
  DEFAULT_REGION,
  MULTIPLAYER,
  NET_PROTOCOL_VERSION,
  REALTIME_PATH,
  type ClientMessage,
  type LinkState,
  type RegionId,
  type ServerMessage,
} from '@riqaa/shared';

type MessageType = ServerMessage['t'];
type Payload<T extends MessageType> = Extract<ServerMessage, { t: T }>;
type Handler<T extends MessageType> = (message: Payload<T>) => void;

/** كل كم يُقاس زمن الذهاب والإياب. */
const PING_INTERVAL_MS = 3000;
/** أقصى انتظار لفتح الوصلة قبل اعتبارها متعذّرة. */
const CONNECT_TIMEOUT_MS = 6000;
/** أقل فارق زاوية يستحق إرسال حزمة جديدة (راديان). */
const INPUT_ANGLE_EPS = 0.02;
/** أقصى معدل إرسال للإدخال — الخادم يحاكي 60 مرة بالثانية لكن لا يحتاج 60 حزمة. */
const INPUT_INTERVAL_MS = 50;
/** كل كم يُعاد إرسال الإدخال حتى لو لم يتغيّر، كي لا يضيع مع حزمة مفقودة. */
const INPUT_KEEPALIVE_MS = 400;
/** انعطاف يستحق حزمة فورية بلا انتظار دورة الإرسال. */
const URGENT_TURN_RAD = 0.12;
/** أول فاصل قبل إعادة المحاولة، يتضاعف حتى السقف. */
const RETRY_BASE_MS = 400;
const RETRY_MAX_MS = 3000;
/**
 * نتوقف عن المحاولة قبل انتهاء مهلة السماح على الخادم بقليل:
 * بعدها لا توجد غرفة نعود إليها، فالمحاولة بلا معنى.
 */
const RETRY_WINDOW_MS = MULTIPLAYER.RECONNECT_GRACE_MS - 3000;

/**
 * عميل اللعب اللحظي.
 *
 * لا يرسل إلا: مصادقة، طلب طابور، نيّة حركة، قياس زمن.
 * لا يرسل اسمًا ولا معرّفًا ولا نتيجة ولا مساحة ولا عملات — كلها تُشتق على الخادم.
 */
export class RealtimeClient {
  private socket: WebSocket | null = null;
  private readonly handlers = new Map<MessageType, Set<(message: ServerMessage) => void>>();
  private pingTimer = 0;
  private rtt = 0;
  private lastSentHeading = Number.NaN;
  private lastSentThrottle = Number.NaN;
  private lastSentAt = 0;
  private closedByUs = false;
  /** الرمز محفوظ كي تتم إعادة المصادقة تلقائيًا بعد أي انقطاع. */
  private token = '';
  private retryTimer = 0;
  private retryDelay = RETRY_BASE_MS;
  private downSince = 0;
  private linkState: LinkState = 'connecting';
  private onLink: ((state: LinkState) => void) | null = null;
  private visibilityBound = false;

  region: RegionId = DEFAULT_REGION;

  /** زمن الذهاب والإياب المقاس فعليًا بالمللي ثانية، أو 0 قبل أول قياس. */
  get pingMs(): number {
    return this.rtt;
  }

  get open(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** حالة الوصلة كما تُعرض للاعب. */
  get status(): LinkState {
    return this.linkState;
  }

  /** يشترك في تغيّر حالة الوصلة (متصل / يعيد المحاولة / انقطع). */
  watchLink(handler: (state: LinkState) => void): () => void {
    this.onLink = handler;
    handler(this.linkState);
    return () => {
      if (this.onLink === handler) this.onLink = null;
    };
  }

  private setLink(state: LinkState): void {
    if (this.linkState === state) return;
    this.linkState = state;
    this.onLink?.(state);
  }

  on<T extends MessageType>(type: T, handler: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const wrapped = handler as (message: ServerMessage) => void;
    set.add(wrapped);
    return () => set?.delete(wrapped);
  }

  /** يفتح الوصلة ويصادق. يُحلّ الوعد عند وصول رسالة الترحيب. */
  connect(token: string): Promise<Payload<'welcome'>> {
    this.close();
    this.closedByUs = false;
    this.token = token;
    this.retryDelay = RETRY_BASE_MS;
    this.downSince = 0;
    this.bindVisibility();
    this.setLink('connecting');

    return new Promise((resolve, reject) => {
      let settled = false;
      let socket: WebSocket;
      try {
        socket = new WebSocket(realtimeUrl());
      } catch (error) {
        reject(error);
        return;
      }
      this.socket = socket;

      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        this.close();
        reject(new Error('تعذّر الاتصال بخادم اللعب الجماعي'));
      }, CONNECT_TIMEOUT_MS);

      socket.onopen = () => {
        this.send({ t: 'hello', v: NET_PROTOCOL_VERSION, token });
        this.startPing();
      };

      socket.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }

        if (message.t === 'pong') {
          const sample = Math.max(0, Math.round(performance.now() - message.n));
          // متوسط متحرّك: رقم مستقر بلا قفزات، ومقاس فعلًا لا مُفترَض.
          this.rtt = this.rtt === 0 ? sample : Math.round(this.rtt * 0.7 + sample * 0.3);
        }
        if (message.t === 'welcome') {
          this.region = message.serverRegion;
          this.retryDelay = RETRY_BASE_MS;
          this.downSince = 0;
          this.setLink('live');
          if (!settled) {
            settled = true;
            window.clearTimeout(timeout);
            resolve(message);
          }
        }
        if (message.t === 'error' && !settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error(message.message));
        }
        this.emit(message);
      };

      socket.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        reject(new Error('تعذّر الاتصال بخادم اللعب الجماعي'));
      };

      socket.onclose = () => {
        this.stopPing();
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error('أُغلق الاتصال قبل اكتماله'));
          return;
        }
        // انقطاع بعد جلسة قائمة: لا نُعلن الخسارة، بل نحاول العودة.
        // الخادم يحفظ الغرفة مهلةَ سماح كاملة، وتركُها بلا محاولة إهدار لها.
        if (!this.closedByUs) this.scheduleRetry();
      };
    });
  }

  /** الاشتراك في قائمة السيرفرات وتحديثاتها. */
  watchLobby(): void {
    this.send({ t: 'lobby' });
  }

  join(id: string): void {
    this.send({ t: 'join', id });
  }

  /** بدء الجولة بضغطة اللاعب — لا انطلاق تلقائي. */
  start(): void {
    this.send({ t: 'start' });
  }

  leave(): void {
    this.send({ t: 'leave' });
  }

  /**
   * إرسال نيّة الحركة.
   * يُهمل ما لم يتغيّر شيء يُذكر، ويُعاد إرساله دوريًا كي لا يضيع مع حزمة مفقودة.
   */
  sendIntent(heading: number, throttle: number): void {
    const now = performance.now();
    const turn = Number.isFinite(this.lastSentHeading)
      ? Math.abs(angleDelta(heading, this.lastSentHeading))
      : Infinity;
    // انعطاف حقيقي لا ينتظر دورة الإرسال: تأخيره هو ما يجعل التحكّم ثقيلًا.
    const urgent = turn > URGENT_TURN_RAD;
    if (!urgent && now - this.lastSentAt < INPUT_INTERVAL_MS) return;

    const changed =
      turn > INPUT_ANGLE_EPS || Math.abs(throttle - this.lastSentThrottle) > 0.05;
    if (!changed && now - this.lastSentAt < INPUT_KEEPALIVE_MS) return;

    this.lastSentHeading = heading;
    this.lastSentThrottle = throttle;
    this.lastSentAt = now;
    this.send({ t: 'input', h: Number(heading.toFixed(4)), r: Number(throttle.toFixed(3)) });
  }

  /** إعادة محاولة بتراجع أسّي داخل نافذة مهلة السماح. */
  private scheduleRetry(): void {
    if (this.closedByUs || this.retryTimer) return;
    if (this.downSince === 0) this.downSince = Date.now();

    if (Date.now() - this.downSince > RETRY_WINDOW_MS) {
      this.setLink('lost');
      this.emit({ t: 'error', code: 'disconnected', message: 'انقطع الاتصال بالخادم' });
      return;
    }

    this.setLink('reconnecting');
    const delay = this.retryDelay;
    this.retryDelay = Math.min(RETRY_MAX_MS, this.retryDelay * 2);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = 0;
      if (this.closedByUs || this.open) return;
      // نفس الرمز ونفس المعالِجات: الخادم يعيدنا إلى الغرفة ويرسل إطارًا مفتاحيًا.
      this.connect(this.token).catch(() => this.scheduleRetry());
    }, delay);
  }

  /**
   * عودة التطبيق إلى الواجهة.
   * المتصفح يخنق المؤقتات في الخلفية فتتوقف نبضات الحياة وتُقطع الوصلة؛
   * لذلك نتفقّدها فور العودة بدل انتظار اكتشاف الانقطاع.
   */
  private bindVisibility(): void {
    if (this.visibilityBound) return;
    this.visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || this.closedByUs) return;
      if (this.open) {
        this.send({ t: 'ping', n: Math.round(performance.now()) });
        return;
      }
      this.retryDelay = RETRY_BASE_MS;
      this.downSince = 0;
      this.scheduleRetry();
    });
  }

  close(): void {
    this.closedByUs = true;
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    this.retryTimer = 0;
    this.stopPing();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
  }

  /** إغلاق نهائي يُنهي الجلسة ويمنع أي محاولة عودة. */
  shutdown(): void {
    this.close();
    this.setLink('lost');
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private emit(message: ServerMessage): void {
    const set = this.handlers.get(message.t);
    if (!set) return;
    for (const handler of set) handler(message);
  }

  private startPing(): void {
    this.stopPing();
    const beat = () => this.send({ t: 'ping', n: Math.round(performance.now()) });
    beat();
    this.pingTimer = window.setInterval(beat, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    this.pingTimer = 0;
  }
}

function realtimeUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${REALTIME_PATH}`;
}

/** فارق زاويتين في المجال [-π, π]. */
function angleDelta(a: number, b: number): number {
  let delta = (a - b) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}
