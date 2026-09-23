import { REALTIME_PATH } from '@riqaa/shared';
import { configProblems, runtimeConfig, type WorkerEnv } from './config.js';

export { GameServer } from './gameServer.js';

/** اسم النسخة الوحيدة من خادم اللعب. */
const INSTANCE = 'riqaa-main';

/**
 * مدخل عامل Cloudflare.
 *
 * العامل نفسه عديم الحالة ويعمل في أقرب مدينة للاعب، فدوره هنا التوجيه
 * لا أكثر: ملفّات الواجهة تُقدَّم من حافة الشبكة، وكل ما يخصّ اللعب يُمرَّر
 * إلى الكائن الدائم الواحد حيث يلتقي اللاعبون فعلًا.
 */
export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === REALTIME_PATH || url.pathname.startsWith('/api/')) {
      const problems = configProblems(runtimeConfig(env));
      if (problems.length > 0) {
        // إعداد ناقص يجب أن يُقال صراحةً، لا أن يظهر كخطأ غامض للاعب.
        return new Response(
          JSON.stringify({ error: 'misconfigured', message: problems.join(' ') }),
          { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } },
        );
      }
      return gameServer(env).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};

/**
 * مقبض الكائن الدائم.
 *
 * التلميح بالمكان يُقرأ عند أول إنشاء فقط: بعدها يثبت الكائن حيث أُنشئ،
 * ولا يغيّره نشرٌ لاحق ولا تغيير الإعداد. لذلك يُضبط قبل أول لاعب.
 */
function gameServer(env: WorkerEnv): DurableObjectStub {
  const id = env.GAME.idFromName(INSTANCE);
  const hint = (env.DO_LOCATION_HINT ?? '').trim();
  return hint
    ? env.GAME.get(id, { locationHint: hint as DurableObjectLocationHint })
    : env.GAME.get(id);
}
