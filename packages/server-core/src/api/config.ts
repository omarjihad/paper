import type { RegionId } from '@riqaa/shared';

/**
 * الإعدادات التي يحتاجها منطق الخادم المحايد.
 *
 * هذا هو القاسم المشترك بين `process.env` في Node و`env` المحقونة في
 * Cloudflare Worker: كل وقت تشغيل يقرأ إعداداته بطريقته ثم يسلّم هذا الشكل.
 */
export interface RuntimeConfig {
  /** مفتاح توقيع رموز الجلسات. لا يغادر الخادم أبدًا. */
  sessionSecret: string;
  telegramBotToken: string;
  /** أقصى عمر مقبول لـ initData بالثواني، و0 يعني بلا حدّ. */
  initDataMaxAge: number;
  /** دخول الضيف: وسيلة تطوير، مغلقة في الإنتاج. */
  devAllowGuest: boolean;
  /** المنطقة التي يعمل منها هذا الخادم فعلًا — لا تُخترع مناطق لا نستضيفها. */
  serverRegion: RegionId;
}
