/**
 * غلاف رقيق حول Telegram.WebApp.
 * كل ما نأخذه من هنا للعرض فقط — الهوية الموثوقة تأتي من الخادم بعد تحقق initData.
 */

export interface TelegramUserUnsafe {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: TelegramUserUnsafe };
  version: string;
  platform: string;
  colorScheme: string;
  isExpanded: boolean;
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  disableVerticalSwipes?(): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  };
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(handler: () => void): void;
    offClick(handler: () => void): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const webApp: TelegramWebApp | null = window.Telegram?.WebApp ?? null;

/** true فقط عندما تُفتح الصفحة فعلًا داخل تيليجرام (توجد initData موقَّعة). */
export const isInsideTelegram = Boolean(webApp && webApp.initData && webApp.initData.length > 0);

export function initTelegram(): void {
  if (!webApp) return;
  webApp.ready();
  webApp.expand();
  webApp.setHeaderColor?.('#0e1420');
  webApp.setBackgroundColor?.('#0e1420');
  // يمنع إغلاق التطبيق بالسحب لأسفل أثناء استخدام عصا التحكم.
  webApp.disableVerticalSwipes?.();
}

export function getInitData(): string {
  return webApp?.initData ?? '';
}

export function getUnsafeUser(): TelegramUserUnsafe | null {
  return webApp?.initDataUnsafe?.user ?? null;
}

export function haptic(kind: 'light' | 'medium' | 'heavy' | 'success' | 'error'): void {
  const feedback = webApp?.HapticFeedback;
  if (!feedback) return;
  try {
    if (kind === 'success' || kind === 'error') feedback.notificationOccurred(kind);
    else feedback.impactOccurred(kind);
  } catch {
    /* نسخ تيليجرام القديمة قد لا تدعم كل الأنواع — تجاهل بصمت. */
  }
}

let backHandler: (() => void) | null = null;

export function setBackButton(handler: (() => void) | null): void {
  const button = webApp?.BackButton;
  if (!button) return;
  if (backHandler) button.offClick(backHandler);
  backHandler = handler;
  if (handler) {
    button.onClick(handler);
    button.show();
  } else {
    button.hide();
  }
}

export function setClosingConfirmation(enabled: boolean): void {
  if (!webApp) return;
  if (enabled) webApp.enableClosingConfirmation?.();
  else webApp.disableClosingConfirmation?.();
}
