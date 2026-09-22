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

export interface TelegramThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  secondary_bg_color?: string;
}

export interface TelegramInset {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: TelegramUserUnsafe };
  version: string;
  platform: string;
  colorScheme: 'dark' | 'light';
  themeParams: TelegramThemeParams;
  isExpanded: boolean;
  viewportStableHeight?: number;
  onEvent?(event: string, handler: () => void): void;
  offEvent?(event: string, handler: () => void): void;
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  disableVerticalSwipes?(): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  /** Bot API 8.0 — قد تكون غائبة أو ترمي في النسخ الأقدم. */
  isFullscreen?: boolean;
  requestFullscreen?(): void;
  exitFullscreen?(): void;
  lockOrientation?(orientation: 'portrait' | 'landscape'): void;
  unlockOrientation?(): void;
  safeAreaInset?: TelegramInset;
  contentSafeAreaInset?: TelegramInset;
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

/**
 * كل استدعاء لسكربت تيليجرام يمر من هنا.
 * السكربت يرمي WebAppMethodUnsupported للدوال التي لا يدعمها إصدار العميل،
 * و`?.` يحمي من غياب الدالة لا من رميها. بدون هذا الحاجز، فشل استدعاء
 * تجميلي واحد كان يُسقط إقلاع اللعبة كله.
 */
function safely(label: string, action: () => void): void {
  try {
    action();
  } catch (error) {
    console.warn(`[رقعة] تجاهلت فشل ${label} في تيليجرام:`, error);
  }
}

/** true فقط عندما تُفتح الصفحة فعلًا داخل تيليجرام (توجد initData موقَّعة). */
export const isInsideTelegram = Boolean(webApp && webApp.initData && webApp.initData.length > 0);

/** ألوان الإطار لكل وضع — نحافظ على هوية اللعبة بدل تبنّي ألوان تيليجرام حرفيًا. */
const FRAME_COLORS = { dark: '#0e1420', light: '#eef2f7' } as const;

export type ColorScheme = 'dark' | 'light';

/** الوضع الذي يعمل به تيليجرام حاليًا؛ الداكن هو الافتراضي خارجه. */
export function getColorScheme(): ColorScheme {
  return webApp?.colorScheme === 'light' ? 'light' : 'dark';
}

/** يطبّق الوضع على الصفحة ويوحّد لون إطار تيليجرام معه. */
export function applyColorScheme(): ColorScheme {
  const scheme = getColorScheme();
  document.documentElement.dataset.theme = scheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', FRAME_COLORS[scheme]);
  safely('setHeaderColor', () => webApp?.setHeaderColor?.(FRAME_COLORS[scheme]));
  safely('setBackgroundColor', () => webApp?.setBackgroundColor?.(FRAME_COLORS[scheme]));
  return scheme;
}

/**
 * ارتفاع فعلي للواجهة: بعض عملاء تيليجرام لا يحترمون 100dvh.
 * ارتفاع التطبيق لا يتجاوز ارتفاع النافذة أبدًا، فأي قيمة أكبر من العميل تُتجاهل —
 * وإلا امتدت الصفحة خارج الشاشة واختفى التنقل السفلي.
 */
function syncViewportHeight(): void {
  let reported = 0;
  safely('viewportStableHeight', () => {
    reported = webApp?.viewportStableHeight ?? 0;
  });
  const windowHeight = window.visualViewport?.height ?? window.innerHeight;
  const height = reported > 0 ? Math.min(reported, windowHeight) : windowHeight;
  document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
}

/** المساحات الآمنة: قيم تيليجرام إن توفّرت، وإلا تبقى قيم env() في الأنماط. */
function syncSafeAreaInsets(): void {
  const root = document.documentElement;
  const outer = webApp?.safeAreaInset;
  const inner = webApp?.contentSafeAreaInset;
  if (!outer && !inner) return;

  const merge = (side: keyof TelegramInset): number =>
    Math.max(0, outer?.[side] ?? 0) + Math.max(0, inner?.[side] ?? 0);

  safely('safeAreaInset', () => {
    root.style.setProperty('--tg-safe-top', `${merge('top')}px`);
    root.style.setProperty('--tg-safe-right', `${merge('right')}px`);
    root.style.setProperty('--tg-safe-bottom', `${merge('bottom')}px`);
    root.style.setProperty('--tg-safe-left', `${merge('left')}px`);
  });
}

/** هل الواجهة الآن أعرض من طولها؟ */
export function isLandscape(): boolean {
  const width = window.visualViewport?.width ?? window.innerWidth;
  const height = window.visualViewport?.height ?? window.innerHeight;
  return width > height;
}

/**
 * وضع اللعب بالعرض: ملء الشاشة ثم قفل الاتجاه — كلاهما Bot API 8.0.
 * غير مدعوم أو مرفوض ⇐ تستمر اللعبة كما هي بلا أي رسالة للمستخدم.
 */
export function enterLandscapeMode(): void {
  safely('requestFullscreen', () => webApp?.requestFullscreen?.());
  safely('lockOrientation', () => webApp?.lockOrientation?.('landscape'));
  // احتياط للمتصفح خارج تيليجرام أو لنسخه الأقدم.
  safely('screen.orientation.lock', () => {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (value: string) => Promise<void>;
    };
    void orientation?.lock?.('landscape')?.catch(() => undefined);
  });
  syncViewportHeight();
  syncSafeAreaInsets();
}

/** إعادة الحالة الطبيعية عند مغادرة اللعب. */
export function exitLandscapeMode(): void {
  safely('unlockOrientation', () => webApp?.unlockOrientation?.());
  safely('exitFullscreen', () => webApp?.exitFullscreen?.());
  safely('screen.orientation.unlock', () => {
    const orientation = screen.orientation as ScreenOrientation & { unlock?: () => void };
    orientation?.unlock?.();
  });
  syncViewportHeight();
  syncSafeAreaInsets();
}

/** يشترك في كل ما قد يغيّر أبعاد الواجهة الفعلية. */
export function onViewportChange(handler: () => void): () => void {
  const wrapped = () => {
    syncViewportHeight();
    syncSafeAreaInsets();
    handler();
  };
  window.addEventListener('resize', wrapped);
  window.addEventListener('orientationchange', wrapped);
  window.visualViewport?.addEventListener('resize', wrapped);
  const events = ['viewportChanged', 'fullscreenChanged', 'safeAreaChanged', 'contentSafeAreaChanged'];
  for (const event of events) safely(`onEvent(${event})`, () => webApp?.onEvent?.(event, wrapped));

  return () => {
    window.removeEventListener('resize', wrapped);
    window.removeEventListener('orientationchange', wrapped);
    window.visualViewport?.removeEventListener('resize', wrapped);
    for (const event of events) safely(`offEvent(${event})`, () => webApp?.offEvent?.(event, wrapped));
  };
}

export function initTelegram(): void {
  syncViewportHeight();
  syncSafeAreaInsets();
  // إعادة القياس بعد تطبيق meta viewport وعند أي تغيّر لاحق.
  window.addEventListener('load', syncViewportHeight);
  window.addEventListener('resize', syncViewportHeight);
  window.addEventListener('orientationchange', syncViewportHeight);
  window.visualViewport?.addEventListener('resize', syncViewportHeight);

  applyColorScheme();
  if (!webApp) return;

  safely('ready', () => webApp.ready());
  safely('expand', () => webApp.expand());
  // يمنع إغلاق التطبيق بالسحب لأسفل أثناء استخدام عصا التحكم (نسخ 7.7+).
  safely('disableVerticalSwipes', () => webApp.disableVerticalSwipes?.());

  safely('onEvent(themeChanged)', () => webApp.onEvent?.('themeChanged', () => applyColorScheme()));
  safely('onEvent(viewportChanged)', () => webApp.onEvent?.('viewportChanged', syncViewportHeight));
  safely('onEvent(safeAreaChanged)', () => webApp.onEvent?.('safeAreaChanged', syncSafeAreaInsets));
  safely('onEvent(contentSafeAreaChanged)', () =>
    webApp.onEvent?.('contentSafeAreaChanged', syncSafeAreaInsets),
  );
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
  safely('BackButton', () => {
    if (backHandler) button.offClick(backHandler);
    backHandler = handler;
    if (handler) {
      button.onClick(handler);
      button.show();
    } else {
      button.hide();
    }
  });
}

export function setClosingConfirmation(enabled: boolean): void {
  if (!webApp) return;
  safely('ClosingConfirmation', () => {
    if (enabled) webApp.enableClosingConfirmation?.();
    else webApp.disableClosingConfirmation?.();
  });
}
