import './styles/app.css';
import { App } from './app.js';

const root = document.getElementById('app');
if (!root) throw new Error('عنصر الجذر #app غير موجود');

void new App(root).boot();
