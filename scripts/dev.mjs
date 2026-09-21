#!/usr/bin/env node
/**
 * تشغيل بيئة التطوير كاملة بأمر واحد:
 *   1) يبني الحزم المشتركة (shared + game-core).
 *   2) يشغّل خادم اللعبة على 3000 وواجهة Vite على 5173.
 * أوقف كل شيء بـ Ctrl+C.
 */
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(args, options = {}) {
  return spawn(npm, args, { stdio: 'inherit', ...options });
}

function wait(child) {
  return new Promise((resolve, reject) => {
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`فشل الأمر برمز ${code}`))));
    child.on('error', reject);
  });
}

const children = [];

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill('SIGINT');
  }
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

try {
  console.log('\n[رقعة] بناء الحزم المشتركة…\n');
  await wait(run(['run', 'build:packages']));

  console.log('\n[رقعة] تشغيل الخادم (3000) وواجهة التطوير (5173)…\n');
  const server = run(['run', 'dev', '-w', '@riqaa/server']);
  const miniapp = run(['run', 'dev', '-w', '@riqaa/miniapp']);
  children.push(server, miniapp);

  for (const child of children) {
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`\n[رقعة] توقّفت إحدى العمليات برمز ${code} — إيقاف الباقي.`);
        shutdown();
        process.exit(code);
      }
    });
  }
} catch (error) {
  console.error(`\n[رقعة] ${error.message}`);
  shutdown();
  process.exit(1);
}
