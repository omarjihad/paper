/**
 * عميل مباشر لـTelegram Bot API عبر HTTP — بلا أي مكتبة خارجية.
 * نستدعي ما نحتاجه فقط: إرسال رسالة، وتسجيل الـwebhook، وقراءة حالته.
 */

const DEFAULT_BASE_URL = 'https://api.telegram.org';

export interface InlineKeyboardButton {
  text: string;
  /** زر يفتح Mini App داخل تيليجرام (المحادثات الخاصة فقط). */
  web_app?: { url: string };
  url?: string;
}

export interface SendMessageParams {
  chat_id: number | string;
  text: string;
  reply_markup?: { inline_keyboard: InlineKeyboardButton[][] };
  disable_notification?: boolean;
}

export interface WebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_message?: string;
}

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly errorCode: number | null,
    description: string,
  ) {
    super(`Telegram API ${method} فشل (${errorCode ?? 'شبكة'}): ${description}`);
    this.name = 'TelegramApiError';
  }
}

export class TelegramApi {
  constructor(
    private readonly token: string,
    /** يُحقن في الاختبارات بخادم وهمي محلي. */
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  sendMessage(params: SendMessageParams): Promise<unknown> {
    return this.call('sendMessage', params);
  }

  setWebhook(params: {
    url: string;
    secret_token: string;
    allowed_updates?: string[];
    drop_pending_updates?: boolean;
  }): Promise<unknown> {
    return this.call('setWebhook', params);
  }

  getWebhookInfo(): Promise<WebhookInfo> {
    return this.call<WebhookInfo>('getWebhookInfo');
  }

  getMe(): Promise<{ id: number; username?: string; first_name?: string }> {
    return this.call('getMe');
  }

  private async call<T>(method: string, payload?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new TelegramApiError(method, null, (error as Error).message);
    }

    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: T;
      description?: string;
      error_code?: number;
    };

    if (!body.ok) {
      throw new TelegramApiError(method, body.error_code ?? response.status, body.description ?? 'رد غير متوقع');
    }
    return body.result as T;
  }
}
