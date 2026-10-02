import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, HumanController } from '../dist/index.js';

const config = {
  gridWidth: 80, gridHeight: 80, cellSize: 20, tickSeconds: 1 / 60,
  speedCellsPerSecond: 7.5, startAreaRadius: 3, roundSeconds: 0, botRespawnSeconds: 2,
};
const TICK = config.tickSeconds;

function solo(seed = 1) {
  const engine = new GameEngine({ config, seed });
  const actor = engine.addParticipant({ id: 1, kind: 'human', name: 'لاعب', colorIndex: 0 });
  const control = new HumanController(1);
  engine.setController(1, control);
  return { engine, actor, control };
}

const run = (engine, seconds) => {
  const steps = Math.round(seconds / TICK);
  for (let i = 0; i < steps; i++) engine.step(TICK);
};

test('يتحرك بأي زاوية 360 درجة لا بأربعة اتجاهات', () => {
  const angles = [0, 0.3, Math.PI / 6, Math.PI / 4, 1.1, 2.4, -0.7, 3.9];
  for (const heading of angles) {
    const { engine, actor, control } = solo(3);
    const x0 = actor.x;
    const y0 = actor.y;
    control.setIntent(heading, 1);
    run(engine, 0.4);

    const moved = Math.hypot(actor.x - x0, actor.y - y0);
    const actual = Math.atan2(actor.y - y0, actor.x - x0);
    const diff = Math.abs(Math.atan2(Math.sin(actual - heading), Math.cos(actual - heading)));
    assert.ok(moved > 2, `يجب أن يقطع مسافة (${moved.toFixed(2)})`);
    assert.ok(diff < 0.02, `الزاوية الفعلية يجب أن تطابق المطلوبة (فرق ${diff.toFixed(3)} راد)`);
  }
});

test('الموضع عشري مستمر — لا قفز بين مراكز الخلايا', () => {
  const { engine, actor, control } = solo(5);
  control.setIntent(Math.PI / 5, 1);
  const positions = [];
  for (let i = 0; i < 30; i++) {
    engine.step(TICK);
    positions.push([actor.x, actor.y]);
  }
  const fractional = positions.filter(([x, y]) => x % 1 !== 0.5 || y % 1 !== 0.5);
  assert.ok(fractional.length > 25, 'أغلب المواضع يجب ألا تكون على مراكز الخلايا');

  let maxJump = 0;
  for (let i = 1; i < positions.length; i++) {
    maxJump = Math.max(maxJump, Math.hypot(positions[i][0] - positions[i - 1][0], positions[i][1] - positions[i - 1][1]));
  }
  const perTick = config.speedCellsPerSecond * TICK;
  assert.ok(maxJump <= perTick * 1.05, `لا قفزات: أكبر خطوة ${maxJump.toFixed(4)} مقابل ${perTick.toFixed(4)}`);
});

test('المسار القطري متصل من أربع جهات (وإلا تسرّب الملء)', () => {
  const { engine, actor, control } = solo(7);
  control.setIntent(Math.PI / 4, 1);
  run(engine, 2);

  assert.ok(actor.trail.length > 10, 'يجب أن يترك مسارًا');
  const w = config.gridWidth;
  for (let i = 1; i < actor.trail.length; i++) {
    const a = actor.trail[i - 1];
    const b = actor.trail[i];
    const distance = Math.abs((a % w) - (b % w)) + Math.abs(Math.floor(a / w) - Math.floor(b / w));
    assert.equal(distance, 1, `خليتان متتاليتان يجب أن تتجاورا بضلع (المسافة ${distance})`);
  }
});

test('حلقة قطرية تُغلق وتستحوذ على مساحة', () => {
  const { engine, actor, control } = solo(11);
  const startArea = actor.area;
  let captured = 0;

  // معيّن كامل بأربعة أضلاع قطرية: لا ضلع منها على محور أصلي.
  const legs = [-Math.PI / 4, Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4];
  outer: for (const heading of legs) {
    control.setIntent(heading, 1);
    for (let i = 0; i < Math.round(1 / TICK); i++) {
      engine.step(TICK);
      for (const event of engine.events) if (event.type === 'capture') captured += event.gained;
      engine.events.length = 0;
      if (!actor.alive || captured > 0) break outer;
    }
  }
  // مهلة إضافية لإكمال العودة إلى الأرض
  for (let i = 0; i < 240 && actor.alive && captured === 0; i++) {
    engine.step(TICK);
    for (const event of engine.events) if (event.type === 'capture') captured += event.gained;
    engine.events.length = 0;
  }

  assert.ok(actor.alive, 'يجب ألا يموت في حلقة قطرية سليمة');
  assert.ok(captured > 0, 'يجب أن يُغلق المسار ويستحوذ');
  assert.ok(actor.area > startArea, `المساحة تزيد (${startArea} → ${actor.area})`);
  assert.equal(actor.outside, false);
});

test('تغيير الاتجاه أثناء الحركة سلس وبلا توقف', () => {
  const { engine, actor, control } = solo(13);
  let previous = { x: actor.x, y: actor.y };
  let minStep = Infinity;

  for (let i = 0; i < 180; i++) {
    control.setIntent((i / 180) * Math.PI * 2, 1); // دوران كامل تدريجي
    engine.step(TICK);
    minStep = Math.min(minStep, Math.hypot(actor.x - previous.x, actor.y - previous.y));
    previous = { x: actor.x, y: actor.y };
  }
  const perTick = config.speedCellsPerSecond * TICK;
  assert.ok(actor.alive, 'الدوران الكامل يجب ألا يقتل اللاعب');
  assert.ok(minStep > perTick * 0.9, `لا توقف أثناء الدوران (أصغر خطوة ${minStep.toFixed(4)})`);
});

test('نسبة السرعة تقلّل السرعة ولا تلغيها', () => {
  const measure = (throttle) => {
    const { engine, actor, control } = solo(17);
    control.setIntent(0, throttle);
    const x0 = actor.x;
    run(engine, 0.5);
    return actor.x - x0;
  };
  const full = measure(1);
  const half = measure(0.5);
  assert.ok(half < full * 0.75, `نصف الدفع أبطأ (${half.toFixed(2)} مقابل ${full.toFixed(2)})`);
  assert.ok(half > 0.5, 'ويبقى يتحرك');
});

test('التفاف حاد مسموح، وقطع مسار قديم يقتل', () => {
  const sharp = solo(19);
  sharp.control.setIntent(0, 1);
  run(sharp.engine, 1.2);
  sharp.control.setIntent(Math.PI, 1); // انعكاس فوري 180 درجة
  run(sharp.engine, 0.25);
  assert.equal(sharp.actor.alive, true, 'الالتفاف الحاد يجب ألا يقتل فورًا');

  const cross = solo(23);
  cross.control.setIntent(0, 1);
  run(cross.engine, 1.5);
  cross.control.setIntent(-Math.PI / 2, 1);
  run(cross.engine, 0.6);
  cross.control.setIntent(Math.PI, 1);
  run(cross.engine, 0.9);
  cross.control.setIntent(Math.PI / 2, 1); // ينزل فيقطع مساره الأفقي القديم
  run(cross.engine, 1.2);
  assert.equal(cross.actor.alive, false, 'قطع المسار القديم يجب أن يقتل');
});

// ---------------------------------------------------------- الحركة على الحدّ

/** يضع اللاعب عند نقطة محدّدة بأرض نظيفة تحته، ثم يدفعه باتجاه ثابت. */
function pushFrom(startX, startY, heading, seconds = 2) {
  const engine = new GameEngine({ config, seed: 7, authoritative: true, endOnHumanDeath: false });
  const actor = engine.addParticipant({ id: 1, kind: 'human', name: 'لاعب', colorIndex: 0 });
  const controller = new HumanController(1);
  engine.setController(1, controller);

  engine.grid.owner.fill(0);
  engine.grid.trail.fill(0);
  actor.x = startX;
  actor.y = startY;
  actor.cx = Math.floor(startX);
  actor.cy = Math.floor(startY);
  actor.trail.length = 0;
  actor.outside = false;
  actor.wallSlide = Number.NaN;
  for (let y = actor.cy - 2; y <= actor.cy + 2; y++) {
    for (let x = actor.cx - 2; x <= actor.cx + 2; x++) {
      if (engine.inBounds(x, y)) engine.grid.owner[y * engine.width + x] = 1;
    }
  }
  actor.exitCell = engine.grid.index(actor.cx, actor.cy);

  const from = { x: actor.x, y: actor.y };
  const steps = Math.round(seconds / config.tickSeconds);
  for (let i = 0; i < steps; i++) {
    controller.setIntent(heading, 1);
    engine.step(config.tickSeconds);
  }
  return { actor, travelled: Math.hypot(actor.x - from.x, actor.y - from.y) };
}

const FULL = config.speedCellsPerSecond * 2;
const W = config.gridWidth;
/** منتصف الجدار: بعيد عن الزاويتين فلا يلتقي بحدٍّ ثانٍ أثناء القياس. */
const MID = config.gridWidth / 2;

test('الدفع في الحائط ينزلق بمحاذاته بدل أن يتجمّد', () => {
  // قبل الانزلاق كان هذا يتحرّك 0.6 خلية من أصل 15: يتسمّر اللاعب عند
  // الحافّة بلا سبب ظاهر، وهو ما يراه «تقطّعًا» في اللعبة.
  for (const [label, x, y, heading] of [
    ['الحائط الأيسر', 0.6, MID, Math.PI],
    ['الحائط الأيمن', W - 0.6, MID, 0],
    ['الحائط العلوي', MID, 0.6, -Math.PI / 2],
    ['الحائط السفلي', MID, W - 0.6, Math.PI / 2],
  ]) {
    const { travelled } = pushFrom(x, y, heading);
    assert.ok(travelled > FULL * 0.9, `${label}: تحرّك ${travelled.toFixed(2)} من أصل ${FULL}`);
  }
});

test('الميل الطفيف عن الحائط لا يُبطئ اللاعب', () => {
  // وهذا كان يزحف بـ26٪ من سرعته: يفقد كل مركّبة عمودية على الجدار.
  const { travelled } = pushFrom(0.6, MID, Math.PI - 0.26);
  assert.ok(travelled > FULL * 0.9, `تحرّك ${travelled.toFixed(2)} من أصل ${FULL}`);
});

test('الزاوية لا تحبس اللاعب', () => {
  const { travelled } = pushFrom(0.6, 0.6, Math.PI + Math.PI / 4);
  assert.ok(travelled > FULL * 0.8, `تحرّك ${travelled.toFixed(2)} من أصل ${FULL}`);
});

test('اتجاه الانزلاق ثابت فلا يذبذب اللاعب في مكانه', () => {
  // بلا ذاكرة الاتجاه ينقلب الترجيح كل نبضة عند منتصف الجدار بالضبط،
  // فيروح اللاعب ويجيء بين نفس الخليتين إلى الأبد.
  const { actor } = pushFrom(0.6, MID, Math.PI, 3);
  assert.ok(Math.abs(actor.y - MID) > 15, `ابتعد ${Math.abs(actor.y - MID).toFixed(2)} خلية عن نقطة الملامسة`);
});

test('مغادرة الحدّ تُنسي الانزلاق', () => {
  const engine = new GameEngine({ config, seed: 3, authoritative: true, endOnHumanDeath: false });
  const actor = engine.addParticipant({ id: 1, kind: 'human', name: 'لاعب', colorIndex: 0 });
  const controller = new HumanController(1);
  engine.setController(1, controller);
  actor.x = 0.05;
  actor.y = MID;
  actor.cx = 0;
  actor.cy = MID;
  controller.setIntent(Math.PI, 1);
  engine.step(config.tickSeconds);
  assert.ok(Number.isFinite(actor.wallSlide), 'يجب أن يُسجَّل الانزلاق عند الملامسة');
  controller.setIntent(0, 1);
  engine.step(config.tickSeconds);
  assert.ok(!Number.isFinite(actor.wallSlide), 'ويُنسى فور الابتعاد');
});
