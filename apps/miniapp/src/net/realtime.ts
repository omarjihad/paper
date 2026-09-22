import {
  DEFAULT_REGION,
  NET_PROTOCOL_VERSION,
  REALTIME_PATH,
  type ClientMessage,
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

  region: RegionId = DEFAULT_REGION;

  /** زمن الذهاب والإياب المقاس فعليًا بالمللي ثانية، أو 0 قبل أول قياس. */
  get pingMs(): number {
    return this.rtt;
  }

  get open(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
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
        if (message.t === 'welcome' && !settled) {
          settled = true;
          window.clearTimeout(timeout);
          this.region = message.serverRegion;
          resolve(message);
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
        }
        if (!this.closedByUs) this.emit({ t: 'error', code: 'disconnected', message: 'انقطع الاتصال بالخادم' });
      };
    });
  }

  queue(region: RegionId): void {
    this.region = region;
    this.send({ t: 'queue', region });
  }

  cancel(): void {
    this.send({ t: 'cancel' });
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
    if (now - this.lastSentAt < INPUT_INTERVAL_MS) return;

    const changed =
      !Number.isFinite(this.lastSentHeading) ||
      Math.abs(angleDelta(heading, this.lastSentHeading)) > INPUT_ANGLE_EPS ||
      Math.abs(throttle - this.lastSentThrottle) > 0.05;
    if (!changed && now - this.lastSentAt < INPUT_KEEPALIVE_MS) return;

    this.lastSentHeading = heading;
    this.lastSentThrottle = throttle;
    this.lastSentAt = now;
    this.send({ t: 'input', h: Number(heading.toFixed(4)), r: Number(throttle.toFixed(3)) });
  }

  close(): void {
    this.closedByUs = true;
    this.stopPing();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
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
