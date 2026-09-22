import './styles/app.css';
import { App } from './app.js';
import { reportClientError } from './net/report.js';

// أي انهيار غير متوقع — حتى أثناء اللعب — يصل إلى سجل الخادم.
window.addEventListener('error', (event) => {
  reportClientError('عام', event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  reportClientError('وعد-مرفوض', event.reason);
});

const root = document.getElementById('app');
if (!root) throw new Error('عنصر الجذر #app غير موجود');

void new App(root).boot();
