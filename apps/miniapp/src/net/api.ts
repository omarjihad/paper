import type {
  AuthResponse,
  MatchResultRequest,
  MatchResultResponse,
  MatchStartResponse,
  PlayerProfile,
} from '@riqaa/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const TOKEN_KEY = 'riqaa.token';
const GUEST_KEY = 'riqaa.guestId';

/** عميل واحد لكل نداءات الخادم. الرمز يُحفظ محليًا ويُجدَّد عند انتهاء صلاحيته. */
export class ApiClient {
  private token: string | null = readStorage(TOKEN_KEY);

  async authenticate(initData: string): Promise<AuthResponse> {
    const body = initData ? { initData } : { guest: true, guestId: guestId() };
    const response = await this.request<AuthResponse>('/api/auth/telegram', {
      method: 'POST',
      body,
      auth: false,
    });
    this.token = response.token;
    writeStorage(TOKEN_KEY, response.token);
    return response;
  }

  me(): Promise<PlayerProfile> {
    return this.request<PlayerProfile>('/api/me', { method: 'GET' });
  }

  startMatch(): Promise<MatchStartResponse> {
    return this.request<MatchStartResponse>('/api/match/start', { method: 'POST' });
  }

  submitResult(result: MatchResultRequest): Promise<MatchResultResponse> {
    return this.request<MatchResultResponse>('/api/match/result', { method: 'POST', body: result });
  }

  hasToken(): boolean {
    return Boolean(this.token);
  }

  /** رمز الجلسة — تحتاجه وصلة اللعب اللحظي للمصادقة. */
  getToken(): string | null {
    return this.token;
  }

  clearToken(): void {
    this.token = null;
    writeStorage(TOKEN_KEY, '');
  }

  private async request<T>(
    path: string,
    options: { method: string; body?: unknown; auth?: boolean },
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.auth !== false && this.token) headers['authorization'] = `Bearer ${this.token}`;

    let response: Response;
    try {
      response = await fetch(path, {
        method: options.method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new ApiError(0, 'network_error', 'تعذّر الاتصال بالخادم، تحقق من الشبكة');
    }

    const text = await response.text();
    const payload = text ? safeParse(text) : {};

    if (!response.ok) {
      const error = payload as { error?: string; message?: string };
      throw new ApiError(
        response.status,
        error.error ?? 'unknown_error',
        error.message ?? 'حدث خطأ غير متوقع',
      );
    }
    return payload as T;
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function guestId(): string {
  let id = readStorage(GUEST_KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2, 12);
    writeStorage(GUEST_KEY, id);
  }
  return id;
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* التخزين قد يكون معطّلًا داخل بعض العملاء — تجاهل. */
  }
}
