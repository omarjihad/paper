import { APP_VERSION } from '@riqaa/shared';

/**
 * يرسل أخطاء الواجهة إلى الخادم لتظهر في سجل الاستضافة.
 * الانهيار داخل WebView تيليجرام لا يظهر في أي مكان آخر.
 * الإرسال بلا انتظار ولا يرمي أبدًا.
 */
export function reportClientError(stage: string, error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const line = error instanceof Error && error.stack ? ` @ ${firstFrame(error.stack)}` : '';

  try {
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stage, version: APP_VERSION, message: `${message}${line}` }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* لا شيء نفعله إن تعذّر الإرسال. */
  }
}

function firstFrame(stack: string): string {
  const lines = stack.split('\n');
  return (lines[1] ?? lines[0] ?? '').trim().slice(0, 120);
}
