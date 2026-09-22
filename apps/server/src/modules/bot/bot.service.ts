import { APP_VERSION } from '@riqaa/shared';
import { TelegramApi, TelegramApiError, type SendMessageParams } from './telegram.api.js';

/** الحد الأدنى من حقول التحديث التي نستخدمها فعلًا. */
export interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id: number; type?: string };
    from?: { id?: number; first_name?: string };
  };
}

export interface BotLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** علامة اتجاه من اليمين لليسار: تضبط اتجاه الفقرة في عملاء تيليجرام. */
const RLM = '‏';

/**
 * منطق البوت: يرد على /start برسالة ترحيب وزر يفتح اللعبة.
 * لا يلمس نظام التحقق من initData — الزر يفتح نفس الواجهة كما هي.
 */
export class TelegramBot {
  constructor(
    private readonly api: TelegramApi,
    /** رابط اللعبة العام (نفس أصل الخادم). */
    private readonly gameUrl: string,
    private readonly log: BotLogger,
  ) {}

  /** يعالج تحديثًا واحدًا. لا يرمي أبدًا: الـwebhook يجب أن يرد 200 دائمًا. */
  async handleUpdate(update: TelegramUpdate): Promise<'handled' | 'ignored' | 'failed'> {
    const message = update.message;
    const chatId = message?.chat?.id;
    const text = message?.text?.trim() ?? '';

    if (chatId === undefined || !isStartCommand(text)) return 'ignored';

    try {
      await this.api.sendMessage(this.buildWelcome(chatId, message?.chat?.type, message?.from?.first_name));
      return 'handled';
    } catch (error) {
      const reason = error instanceof TelegramApiError ? error.message : String(error);
      this.log.error(`تعذّر الرد على /start: ${reason}`);
      return 'failed';
    }
  }

  /**
   * رسالة الترحيب.
   * زر web_app مسموح في المحادثات الخاصة فقط، ففي المجموعات نكتفي برابط عادي.
   */
  buildWelcome(chatId: number, chatType: string | undefined, firstName: string | undefined): SendMessageParams {
    const name = (firstName ?? '').trim();
    const greeting = name ? `أهلًا ${name} في «رقعة».` : 'أهلًا بك في «رقعة».';

    const text = [
      `${RLM}${greeting}`,
      '',
      `${RLM}سيطر على أكبر مساحة في الخريطة: اخرج من أرضك، ارسم مسارًا، ثم عُد إليها لتضمّ ما أحطت به.`,
      `${RLM}داخل أرضك أنت آمن، وخارجها مسارك مكشوف.`,
      '',
      `${RLM}اضغط الزر بالأسفل لبدء اللعب.`,
      '',
      `${RLM}النسخة ${APP_VERSION}`,
    ].join('\n');

    const isPrivate = chatType === undefined || chatType === 'private';
    const button = isPrivate
      ? { text: 'العب الآن', web_app: { url: this.gameUrl } }
      : { text: 'العب الآن', url: this.gameUrl };

    return {
      chat_id: chatId,
      text,
      reply_markup: { inline_keyboard: [[button]] },
    };
  }

  /** يسجّل الـwebhook لدى تيليجرام. يُستدعى مرة عند الإقلاع. */
  async registerWebhook(webhookUrl: string, secretToken: string): Promise<void> {
    await this.api.setWebhook({
      url: webhookUrl,
      secret_token: secretToken,
      // لا نحتاج غير الرسائل في هذه المرحلة.
      allowed_updates: ['message'],
    });
    this.log.info(`تم تسجيل webhook تيليجرام على ${webhookUrl}`);
  }
}

/** يقبل /start و/start@BotName و/start مع معامل بدء. */
function isStartCommand(text: string): boolean {
  if (!text.startsWith('/start')) return false;
  const command = text.split(/\s+/)[0];
  return command === '/start' || command.startsWith('/start@');
}
