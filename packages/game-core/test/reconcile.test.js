import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, reconcileLocal, unpackActor, packActor } from '../dist/index.js';

const config = {
  gridWidth: 150, gridHeight: 150, cellSize: 20, tickSeconds: 1 / 60,
  speedCellsPerSecond: 7.5, startAreaRadius: 3, roundSeconds: 0, botRespawnSeconds: 4,
};
const participants = [{ kind: 'human', actorId: 1, name: 'لاعب', colorIndex: 0 }];
const SPEED = config.speedCellsPerSecond;

/**
 * يحاكي الشبكة فعلًا: محرّك محلي يتلقى نيّة اللاعب فورًا، ومحرّك خادم
 * يتلقاها متأخرًا بنصف رحلة. ثم نطابق كما تفعل الواجحة ونقيس ما يراه اللاعب.
 */
function simulate({ rttMs, steering, reconcile, seconds = 10 }) {
  const local = buildWorld({ config, seed: 5, participants, localActorId: 1, authoritative: false, endOnHumanDeath: false });
  const server = buildWorld({ config, seed: 5, participants, localActorId: 1, endOnHumanDeath: false });
  const oneWay = rttMs / 2 / 1000;
  const queue = [];
  const inbox = [];
  let t = 0, nextSample = 1 / 15;
  let worstError = 0, corrections = 0, backwardTravel = 0, headingOverwritten = 0;

  for (let i = 0; i < 60 * seconds; i++) {
    // قوس واسع لا يقطع مساره — وإلا قِسنا موتًا لا انحرافًا.
    const heading = steering ? 0.6 + t * 0.55 : 0.6;
    local.localController.setIntent(heading, 1);
    queue.push({ at: t + oneWay, heading });
    while (queue.length > 0 && queue[0].at <= t) server.localController.setIntent(queue.shift().heading, 1);

    local.engine.step(config.tickSeconds);
    server.engine.step(config.tickSeconds);
    t += config.tickSeconds;

    // اللقطة تُلتقط الآن، لكنها لا تصل إلى الجهاز إلا بعد نصف رحلة.
    if (t >= nextSample) {
      nextSample += 1 / 15;
      inbox.push({ at: t + oneWay, state: unpackActor(packActor(server.engine.actorById(1), 0)) });
    }
    if (inbox.length === 0 || inbox[0].at > t) continue;
    const { state } = inbox.shift();

    const mine = local.engine.actorById(1);
    const theirs = server.engine.actorById(1);
    if (!mine.alive || !theirs.alive || !state.alive) break;

    const before = { x: mine.x, y: mine.y, heading: mine.heading };

    if (reconcile) {
      const result = reconcileLocal(mine, state, { speed: SPEED, latencyMs: rttMs });
      if (result !== 'ignored') corrections++;
    } else {
      // السلوك القديم: مقارنة ساذجة وقفز يكتب زاوية الخادم فوق زاوية اللاعب.
      const drift = Math.hypot(state.x - mine.x, state.y - mine.y);
      if (drift > 2.5) {
        mine.x = state.x; mine.y = state.y; mine.heading = state.heading;
        corrections++;
      }
    }

    if (mine.heading !== before.heading) headingOverwritten++;
    // ما يُحسّ «تعليقًا» هو مقدار ما يُسحبه التصحيح عكس اتجاه السير.
    const moveX = mine.x - before.x, moveY = mine.y - before.y;
    const along = moveX * Math.cos(before.heading) + moveY * Math.sin(before.heading);
    if (along < 0) backwardTravel += -along;
    const err = Math.hypot(theirs.x - mine.x, theirs.y - mine.y);
    if (err > worstError) worstError = err;
  }
  return { worstError, corrections, backwardTravel, headingOverwritten };
}

test('التصحيح لا يلمس زاوية اللاعب مهما بلغ التأخير', () => {
  for (const rttMs of [60, 250, 400, 700]) {
    const r = simulate({ rttMs, steering: true, reconcile: true });
    assert.equal(r.headingOverwritten, 0, `عند ${rttMs} م.ث كُتبت الزاوية ${r.headingOverwritten} مرة`);
  }
});

test('السحب للخلف أثناء المناورة يكاد ينعدم على شبكة بطيئة', () => {
  const fixed = simulate({ rttMs: 400, steering: true, reconcile: true });
  assert.ok(fixed.backwardTravel < 0.5, `سُحب للخلف ${fixed.backwardTravel.toFixed(2)} خلية خلال 10 ثوانٍ`);
});

test('السلوك القديم كان يسحب اللاعب للخلف فعلًا — وهذا ما يُصلَح', () => {
  const old = simulate({ rttMs: 400, steering: true, reconcile: false });
  const fixed = simulate({ rttMs: 400, steering: true, reconcile: true });
  assert.ok(old.backwardTravel > 1, `القديم سحب ${old.backwardTravel.toFixed(2)} خلية`);
  assert.ok(
    fixed.backwardTravel < old.backwardTravel / 4,
    `سحب للخلف: قديم ${old.backwardTravel.toFixed(2)} ← جديد ${fixed.backwardTravel.toFixed(2)} خلية`,
  );
  assert.ok(old.headingOverwritten > 0, 'والقديم كان يكتب زاوية الخادم فوق انعطاف اللاعب');
});

test('السير المستقيم على شبكة معقولة لا يستدعي أي تصحيح', () => {
  const r = simulate({ rttMs: 150, steering: false, reconcile: true });
  assert.equal(r.corrections, 0, `تصحيحات بلا داعٍ: ${r.corrections}`);
});

test('الانحراف يبقى محدودًا فلا ينفصل اللاعب عن حقيقة الخادم', () => {
  for (const rttMs of [150, 400, 700]) {
    const r = simulate({ rttMs, steering: true, reconcile: true });
    const allowance = SPEED * (rttMs / 1000) + 1.5;
    assert.ok(r.worstError <= allowance, `عند ${rttMs} م.ث الانحراف ${r.worstError.toFixed(2)} > المسموح ${allowance.toFixed(2)}`);
  }
});

test('الانفصال الحقيقي يُصحَّح قفزًا لا تدريجًا', () => {
  const world = buildWorld({ config, seed: 9, participants, localActorId: 1, authoritative: false, endOnHumanDeath: false });
  const actor = world.engine.actorById(1);
  const far = { id: 1, x: actor.x + 40, y: actor.y + 40, heading: 0, alive: true, outside: false, areaPercent: 0 };
  assert.equal(reconcileLocal(actor, far, { speed: SPEED, latencyMs: 100 }), 'snapped');
  assert.ok(Math.abs(actor.x - far.x) < 1.5 && Math.abs(actor.y - far.y) < 1.5, 'وصل إلى موضع الخادم');
});

test('فارق داخل النافذة الميتة يُترك للتنبؤ المحلي', () => {
  const world = buildWorld({ config, seed: 9, participants, localActorId: 1, authoritative: false, endOnHumanDeath: false });
  const actor = world.engine.actorById(1);
  const before = { x: actor.x, y: actor.y };
  const near = { id: 1, x: actor.x + 0.3, y: actor.y, heading: 0, alive: true, outside: false, areaPercent: 0 };
  assert.equal(reconcileLocal(actor, near, { speed: SPEED, latencyMs: 0, ageMs: 0 }), 'ignored');
  assert.equal(actor.x, before.x);
  assert.equal(actor.y, before.y);
});
