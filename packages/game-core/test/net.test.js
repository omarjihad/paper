import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GameEngine,
  buildWorld,
  encodeRle,
  decodeRle,
  encodeKeyframe,
  applyKeyframe,
  packActor,
  unpackActor,
  resolveBotProfile,
  BOT_BEHAVIORS_TABLE,
  RemoteController,
} from '../dist/index.js';

const config = {
  gridWidth: 60,
  gridHeight: 60,
  cellSize: 20,
  tickSeconds: 1 / 60,
  speedCellsPerSecond: 7.5,
  startAreaRadius: 3,
  roundSeconds: 0,
  botRespawnSeconds: 2,
};

const participants = [
  { kind: 'human', actorId: 1, name: 'لاعب', colorIndex: 0 },
  { kind: 'bot', actorId: 2, name: 'بوت 1', colorIndex: 1, difficulty: 'medium', behavior: 'aggressive' },
  { kind: 'bot', actorId: 3, name: 'بوت 2', colorIndex: 2, difficulty: 'hard', behavior: 'explorer' },
];

test('ترميز الأطوال يعيد الشبكة كما هي', () => {
  const data = new Uint8Array(22500);
  for (let i = 0; i < data.length; i++) data[i] = i % 700 < 340 ? 0 : ((i / 97) | 0) % 11;
  const text = encodeRle(data);
  const back = new Uint8Array(data.length);
  assert.equal(decodeRle(text, back), true);
  assert.deepEqual([...back], [...data]);
  // شبكة مفهرسة كهذه يجب أن تنضغط بوضوح، وإلا لا معنى للترميز.
  assert.ok(text.length < data.length, `الحجم ${text.length} مقابل ${data.length}`);
});

test('ترميز شبكة فارغة تمامًا يبقى صغيرًا جدًا', () => {
  const empty = new Uint8Array(22500);
  const text = encodeRle(empty);
  assert.ok(text.length < 16, `الحجم ${text.length}`);
  const back = new Uint8Array(empty.length);
  assert.equal(decodeRle(text, back), true);
  assert.equal(back.some((v) => v !== 0), false);
});

test('ترميز تالف يُرفض ولا يُفسد الشبكة', () => {
  const out = new Uint8Array(100);
  assert.equal(decodeRle('AAAA', out), false);
});

test('حزم المشارك وفكّه يحفظان الموضع والزاوية والحالة', () => {
  const engine = new GameEngine({ config, seed: 7 });
  const actor = engine.addParticipant({ id: 1, kind: 'human', name: 'لاعب', colorIndex: 0 });
  actor.x = 12.345;
  actor.y = 40.987;
  actor.heading = 1.2345;
  actor.outside = true;
  const state = unpackActor(packActor(actor, 3.5));
  assert.equal(state.id, 1);
  assert.ok(Math.abs(state.x - actor.x) <= 0.01);
  assert.ok(Math.abs(state.y - actor.y) <= 0.01);
  assert.ok(Math.abs(state.heading - actor.heading) <= 0.001);
  assert.equal(state.alive, true);
  assert.equal(state.outside, true);
  assert.equal(state.areaPercent, 3.5);
});

test('الإطار المفتاحي ينقل الأرض والمساحات من المرجع إلى المرآة', () => {
  const server = buildWorld({ config, seed: 99, participants, localActorId: 0 });
  const steps = Math.round(6 / config.tickSeconds);
  for (let i = 0; i < steps; i++) server.engine.step(config.tickSeconds);

  const mirror = buildWorld({
    config,
    seed: 99,
    participants,
    localActorId: 1,
    authoritative: false,
    endOnHumanDeath: false,
    networked: true,
  });
  // قبل المزامنة النسختان مختلفتان (البوتات لم تعمل في المرآة إطلاقًا).
  const beforeDiff = diffCells(server.engine, mirror.engine);
  assert.ok(beforeDiff > 0, 'يفترض وجود فارق قبل المزامنة');

  assert.equal(applyKeyframe(mirror.engine, encodeKeyframe(server.engine)), true);
  assert.equal(diffCells(server.engine, mirror.engine), 0, 'الأرض يجب أن تتطابق بعد الإطار المفتاحي');

  for (const actor of server.engine.actors) {
    const copy = mirror.engine.actorById(actor.id);
    assert.equal(copy.area, actor.area, `مساحة ${actor.id}`);
    assert.equal(copy.trail.length, actor.trail.length, `مسار ${actor.id}`);
  }
});

test('المرآة لا تقتل ولا تنهي الجولة من عندها', () => {
  const mirror = new GameEngine({ config, seed: 5, authoritative: false, endOnHumanDeath: false });
  const a = mirror.addParticipant({ id: 1, kind: 'human', name: 'لاعب', colorIndex: 0 });
  const b = mirror.addParticipant({ id: 2, kind: 'bot', name: 'بوت 1', colorIndex: 1, difficulty: 'easy' });

  // نضع الاثنين في خلية واحدة وكلاهما خارج أرضه: في المرجع موتٌ مؤكّد.
  a.outside = true;
  b.outside = true;
  b.x = a.x;
  b.y = a.y;
  b.cx = a.cx;
  b.cy = a.cy;
  mirror.step(config.tickSeconds);

  assert.equal(a.alive, true, 'المرآة لا تُصدر حكم موت');
  assert.equal(mirror.status, 'running');

  // قرار الخادم وحده هو ما يُنفَّذ.
  mirror.applyDeath(1, 'collision');
  assert.equal(a.alive, false);
});

test('موت اللاعب البشري لا ينهي الغرفة حين تُعطَّل هذه القاعدة', () => {
  const room = new GameEngine({ config, seed: 3, endOnHumanDeath: false });
  const human = room.addParticipant({ id: 1, kind: 'human', name: 'لاعب', colorIndex: 0 });
  room.addParticipant({ id: 2, kind: 'bot', name: 'بوت 1', colorIndex: 1, difficulty: 'easy' });
  room.applyDeath(human.id, 'trail');
  assert.equal(human.alive, false);
  assert.equal(room.status, 'running', 'الغرفة تكمل بعد خروج لاعب');
});

test('أنماط البوتات الخمسة تعطي أرقامًا مختلفة فعليًا', () => {
  const names = Object.keys(BOT_BEHAVIORS_TABLE);
  assert.equal(names.length, 5, names.join(','));

  const profiles = names.map((behavior) => resolveBotProfile('medium', behavior));
  const signatures = new Set(profiles.map((p) => `${p.maxTrail}/${p.maxDepth}/${p.huntRadius}/${p.huntChance.toFixed(2)}/${p.caution.toFixed(2)}/${p.roam}`));
  assert.equal(signatures.size, 5, [...signatures].join(' | '));

  const byName = Object.fromEntries(names.map((n, i) => [n, profiles[i]]));
  assert.ok(byName.aggressive.huntChance > byName.defensive.huntChance, 'المهاجم يطارد أكثر من المدافع');
  assert.ok(byName.defensive.caution > byName.aggressive.caution, 'المدافع أكثر حذرًا');
  assert.ok(byName.explorer.maxDepth > byName.defensive.maxDepth, 'المستكشف يبتعد أكثر');
  assert.equal(byName.opportunist.opportunistic, true);
});

test('الصعوبة والنمط يتركّبان دون أن يلغي أحدهما الآخر', () => {
  const easy = resolveBotProfile('easy', 'aggressive');
  const hard = resolveBotProfile('hard', 'aggressive');
  assert.ok(hard.maxTrail > easy.maxTrail, 'الأصعب يخاطر أكثر بنفس النمط');
  const hardDefensive = resolveBotProfile('hard', 'defensive');
  assert.ok(hard.huntChance > hardDefensive.huntChance, 'النمط يفرّق بين بوتين بنفس الصعوبة');
});

function diffCells(a, b) {
  let diff = 0;
  for (let i = 0; i < a.grid.owner.length; i++) {
    if (a.grid.owner[i] !== b.grid.owner[i]) diff++;
    if (a.grid.trail[i] !== b.grid.trail[i]) diff++;
  }
  return diff;
}

test('كل جهاز يتابع لاعبه هو في غرفة فيها أكثر من بشري', () => {
  const crowd = [
    { kind: 'human', actorId: 1, name: 'اللاعب الأول', colorIndex: 0 },
    { kind: 'human', actorId: 2, name: 'اللاعب الثاني', colorIndex: 1 },
    { kind: 'bot', actorId: 3, name: 'بوت 1', colorIndex: 2, difficulty: 'easy', behavior: 'balanced' },
  ];
  const first = buildWorld({ config, seed: 11, participants: crowd, localActorId: 1, authoritative: false, networked: true });
  const second = buildWorld({ config, seed: 11, participants: crowd, localActorId: 2, authoritative: false, networked: true });
  assert.equal(first.engine.focus.id, 1, 'جهاز اللاعب الأول يتابع اللاعب الأول');
  assert.equal(second.engine.focus.id, 2, 'جهاز اللاعب الثاني يتابع اللاعب الثاني');
  assert.equal(first.local.id, 1);
  assert.equal(second.remotes.has(1), true, 'اللاعب الآخر تقوده لقطات الخادم');
  assert.equal(second.remotes.has(3), true, 'والبوتات كذلك — لا محاكاة محلية لها');
});

test('اللاعب البعيد يلحق بموضع الخادم ويرسم مساره أثناء ذلك', () => {
  const crowd = [
    { kind: 'human', actorId: 1, name: 'أنا', colorIndex: 0 },
    { kind: 'human', actorId: 2, name: 'خصم', colorIndex: 1 },
  ];
  const world = buildWorld({
    config,
    seed: 21,
    participants: crowd,
    localActorId: 1,
    authoritative: false,
    endOnHumanDeath: false,
    networked: true,
  });
  const remote = world.engine.actorById(2);
  const controller = world.remotes.get(2);
  assert.ok(controller instanceof RemoteController);

  // هدف من الخادم على بُعد خمس خلايا أفقيًا.
  const target = { x: remote.x + 5, y: remote.y };
  const startGap = Math.hypot(target.x - remote.x, target.y - remote.y);
  controller.setTarget(target.x, target.y, 0, 1, Date.now());

  for (let i = 0; i < Math.round(1 / config.tickSeconds); i++) world.engine.step(config.tickSeconds);

  const gap = Math.hypot(target.x - remote.x, target.y - remote.y);
  assert.ok(gap < startGap, `الفارق ${gap.toFixed(2)} يجب أن يقلّ عن ${startGap.toFixed(2)}`);
  assert.ok(remote.x > target.x - 1.5, `وصل إلى ${remote.x.toFixed(2)} والهدف ${target.x.toFixed(2)}`);
  // الأهم: مرّ بمنطق دخول الخلايا فكُتب له مسار يُرسم على الشاشة.
  assert.ok(remote.outside, 'اللاعب البعيد خرج من أرضه كما يفعل على الخادم');
  assert.ok(remote.trail.length > 0, 'وله مسار مرسوم');
});

test('بلا لقطات لا يُستقرأ اللاعب البعيد إلى ما لا نهاية', () => {
  const crowd = [
    { kind: 'human', actorId: 1, name: 'أنا', colorIndex: 0 },
    { kind: 'human', actorId: 2, name: 'خصم', colorIndex: 1 },
  ];
  const world = buildWorld({ config, seed: 22, participants: crowd, localActorId: 1, authoritative: false, networked: true });
  const remote = world.engine.actorById(2);
  const before = { x: remote.x, y: remote.y };
  // لا setTarget إطلاقًا: لا نيّة، فلا يخترع العميل حركة لخصم لم يسمع عنه شيئًا.
  for (let i = 0; i < 30; i++) world.engine.step(config.tickSeconds);
  assert.ok(Math.hypot(remote.x - before.x, remote.y - before.y) <= 4, 'لا انطلاق عشوائي بلا بيانات');
});
