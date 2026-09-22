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
  /** بلا معاملات: تُثبّت الاتجاه الحالي ولا تختار اتجاهًا. */
  lockOrientation?(): void;
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
    // عند التدوير: أعلى الجهاز يصبح يسار المحتوى، ويمينه أسفله… وهكذا.
    const map = rotated
      ? { top: 'right', right: 'bottom', bottom: 'left', left: 'top' }
      : { top: 'top', right: 'right', bottom: 'bottom', left: 'left' };
    root.style.setProperty('--tg-safe-top', `${merge(map.top as keyof TelegramInset)}px`);
    root.style.setProperty('--tg-safe-right', `${merge(map.right as keyof TelegramInset)}px`);
    root.style.setProperty('--tg-safe-bottom', `${merge(map.bottom as keyof TelegramInset)}px`);
    root.style.setProperty('--tg-safe-left', `${merge(map.left as keyof TelegramInset)}px`);
  });
}

/** هل الواجهة الآن أعرض من طولها؟ */
export function isLandscape(): boolean {
  const width = window.visualViewport?.width ?? window.innerWidth;
  const height = window.visualViewport?.height ?? window.innerHeight;
  return width > height;
}

/* ===================== وضع العرض =====================
 * ملاحظة جوهرية: lockOrientation() في تيليجرام **لا تختار** اتجاهًا،
 * بل تُثبّت الاتجاه الحالي. استدعاؤها والشاشة طولية يُجمّد الطول —
 * عكس المطلوب تمامًا. لذلك لا تُستدعى إلا بعد أن نصبح بالعرض فعلًا.
 *
 * الذي يستطيع فرض العرض هو screen.orientation.lock('landscape')،
 * وهو يحتاج عادةً أن تكون الصفحة في ملء الشاشة، وملء شاشة DOM يحتاج
 * سياق لمسة من المستخدم. لذلك نطلب التسلسل عند الإقلاع وعند الضغط معًا.
 */

let landscapeWanted = false;
let landscapeLocked = false;
let pendingAttempts = 0;

type LockableOrientation = ScreenOrientation & {
  lock?: (value: string) => Promise<void>;
  unlock?: () => void;
};

function orientationApi(): LockableOrientation | null {
  try {
    return (screen?.orientation as LockableOrientation) ?? null;
  } catch {
    return null;
  }
}

/** يثبّت الاتجاه الحالي عبر تيليجرام — بشرط أن نكون بالعرض. */
function keepLandscapeLocked(): void {
  if (!landscapeWanted || landscapeLocked || !isLandscape()) return;
  safely('lockOrientation', () => webApp?.lockOrientation?.());
  landscapeLocked = true;
}

/** محاولة فرض العرض عبر واجهة المتصفح. تُعيد true عند النجاح. */
async function lockToLandscape(): Promise<boolean> {
  const orientation = orientationApi();
  if (!orientation?.lock) return false;
  try {
    await orientation.lock('landscape');
    keepLandscapeLocked();
    return true;
  } catch {
    return false;
  }
}

/** ملء شاشة DOM — ينجح فقط داخل سياق لمسة، وفشله غير مؤثر. */
function requestDocumentFullscreen(): void {
  const element = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  safely('document.requestFullscreen', () => {
    const result = element.requestFullscreen?.({ navigationUI: 'hide' });
    if (result && typeof result.catch === 'function') void result.catch(() => undefined);
    else element.webkitRequestFullscreen?.();
  });
}

/**
 * يبدأ تسلسل الدخول إلى العرض. آمن للاستدعاء أكثر من مرة.
 * الترتيب: ready (تمت في التهيئة) ← ملء شاشة تيليجرام ← ملء شاشة DOM
 * ← قفل العرض ← تثبيت بقفل تيليجرام بعد التأكد أننا بالعرض.
 */
export function requestLandscape(): void {
  landscapeWanted = true;

  safely('requestFullscreen', () => webApp?.requestFullscreen?.());
  requestDocumentFullscreen();
  // لا ننتظر نتيجة القفل: العرض يظهر فورًا، ثم يُلغى التدوير إن دار الجهاز.
  applyRotation();

  void lockToLandscape().then((locked) => {
    syncViewportHeight();
    syncSafeAreaInsets();
    applyRotation();
    if (locked || pendingAttempts >= 4) return;
    // ملء الشاشة قد يتأخر: نعيد المحاولة قليلًا بدل افتراض التنفيذ الفوري.
    pendingAttempts++;
    window.setTimeout(() => {
      if (landscapeWanted && !landscapeLocked) requestLandscapeRetry();
    }, 260 * pendingAttempts);
  });
}

function requestLandscapeRetry(): void {
  void lockToLandscape().then((locked) => {
    syncViewportHeight();
    syncSafeAreaInsets();
    applyRotation();
    if (locked || pendingAttempts >= 4) return;
    pendingAttempts++;
    window.setTimeout(() => {
      if (landscapeWanted && !landscapeLocked) requestLandscapeRetry();
    }, 260 * pendingAttempts);
  });
}

/** يفك القفل ويعيد الحالة الطبيعية. */
export function releaseLandscape(): void {
  landscapeWanted = false;
  landscapeLocked = false;
  pendingAttempts = 0;
  applyRotation();
  safely('unlockOrientation', () => webApp?.unlockOrientation?.());
  safely('screen.orientation.unlock', () => orientationApi()?.unlock?.());
  safely('document.exitFullscreen', () => {
    const result = document.exitFullscreen?.();
    if (result && typeof result.catch === 'function') void result.catch(() => undefined);
  });
  safely('exitFullscreen', () => webApp?.exitFullscreen?.());
  syncViewportHeight();
  syncSafeAreaInsets();
}

/* ---------- التدوير البرمجي ----------
 * تيليجرام لا يملك واجهة تفرض العرض، وقفل المتصفح مرفوض في أغلب عملائه.
 * فالسبيل الوحيد لفتح اللعبة بالعرض فورًا هو تدوير محتوى التطبيق نفسه 90
 * درجة داخل النافذة الطولية. يُلغى التدوير لحظة أن يصبح الجهاز بالعرض فعلًا.
 */
let rotated = false;

export function isRotated(): boolean {
  return rotated;
}

/** التدوير للهواتف داخل تيليجرام فقط: لا سطح مكتب ولا متصفح عادي. */
function isMobileTelegramClient(): boolean {
  const platform = webApp?.platform ?? '';
  return platform === 'android' || platform === 'ios';
}

function applyRotation(): void {
  const root = document.documentElement;
  const width = Math.round(window.visualViewport?.width ?? window.innerWidth);
  const height = Math.round(window.visualViewport?.height ?? window.innerHeight);
  const shouldRotate = landscapeWanted && height > width && isMobileTelegramClient();

  if (shouldRotate) {
    rotated = true;
    root.dataset.rotated = '1';
    // الإطار المُدار يشغل كامل الشاشة: عرضه = ارتفاع النافذة والعكس.
    root.style.setProperty('--rot-width', `${height}px`);
    root.style.setProperty('--rot-height', `${width}px`);
    // مركز الدوران المحسوب كي تنطبق الحواف الأربع على الشاشة تمامًا.
    root.style.setProperty('--rot-origin', `${width / 2}px`);
  } else if (rotated) {
    rotated = false;
    delete root.dataset.rotated;
    root.style.removeProperty('--rot-width');
    root.style.removeProperty('--rot-height');
    root.style.removeProperty('--rot-origin');
  }

  applyLayoutMode();
}

/**
 * وضع التخطيط الذي تبني عليه الأنماط.
 * لا يصح الاعتماد على @media (orientation) لأنها تقيس اتجاه **الجهاز**،
 * فيبقى التصميم طوليًا رغم أن المحتوى مُدار — ولا يتبدّل إلا بقلب الهاتف.
 * هنا نقيس اتجاه **المحتوى** نفسه.
 */
function applyLayoutMode(): void {
  const landscapeLayout = rotated || isLandscape();
  document.documentElement.dataset.layout = landscapeLayout ? 'landscape' : 'portrait';
}

/**
 * يُستدعى عند كل تغيّر في ملء الشاشة أو الاتجاه أو المقاس:
 * يعيد قياس الواجهة، ويكمل ما تبقّى من تسلسل العرض.
 */
function onEnvironmentChanged(): void {
  syncViewportHeight();
  syncSafeAreaInsets();
  if (!landscapeWanted) {
    applyRotation();
    return;
  }
  if (isLandscape()) {
    // صرنا بالعرض (بالقفل أو بتدوير المستخدم) — نثبّته ونلغي التدوير البرمجي.
    keepLandscapeLocked();
  } else if (!landscapeLocked) {
    void lockToLandscape();
  }
  applyRotation();
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
  applyLayoutMode();
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

  // كل ما قد يعني أن ملء الشاشة أو الاتجاه تغيّر.
  for (const event of ['fullscreenChanged', 'fullscreenFailed', 'orientationChanged']) {
    safely(`onEvent(${event})`, () => webApp.onEvent?.(event, onEnvironmentChanged));
  }
  document.addEventListener('fullscreenchange', onEnvironmentChanged);
  window.addEventListener('orientationchange', onEnvironmentChanged);
  window.visualViewport?.addEventListener('resize', onEnvironmentChanged);

  // العرض مطلوب منذ لحظة فتح التطبيق، لا عند بدء الجولة فقط.
  requestLandscape();
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
