import type { FastifyInstance } from 'fastify';

/**
 * مستقبِل أخطاء الواجهة.
 * غرضه تشخيصي بحت: انهيار داخل WebView تيليجرام لا يظهر في أي سجل،
 * فترسله الواجهة إلى هنا ليظهر في سجل الاستضافة.
 */
export async function registerClientErrorRoute(app: FastifyInstance): Promise<void> {
  app.post('/api/client-error', async (request, reply) => {
    const body = (request.body ?? {}) as { stage?: unknown; message?: unknown; version?: unknown };

    const stage = short(body.stage, 40);
    const message = short(body.message, 300);
    const version = short(body.version, 12);

    if (message) {
      request.log.warn(`خطأ في واجهة اللاعب [${version || '?'} / ${stage || '?'}]: ${message}`);
    }
    reply.status(204);
    return null;
  });
}

/** يقصّ أي نص قادم من الخارج ويزيل الأسطر كي لا يلوّث السجل. */
function short(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}
