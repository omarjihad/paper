import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, BotController } from '../dist/index.js';

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

function run(engine, seconds) {
  const steps = Math.round(seconds / config.tickSeconds);
  for (let i = 0; i < steps; i++) engine.step(config.tickSeconds);
}

function runUntil(engine, predicate, maxSeconds = 20) {
  const steps = Math.round(maxSeconds / config.tickSeconds);
  for (let i = 0; i < steps; i++) {
    engine.step(config.tickSeconds);
    if (predicate()) return true;
  }
  return false;
}

/** تحكّم اختباري يتبع نقاط طريق: يحاذي المحور الأفقي أولًا ثم الرأسي. */
function waypointController(actorId, waypoints) {
  let index = 0;
  return {
    actorId,
    decide(_world, actor) {
      while (index < waypoints.length) {
        const [tx, ty] = waypoints[index];
        if (actor.cx === tx && actor.cy === ty) {
          index++;
          continue;
        }
        if (actor.cx !== tx) return actor.cx < tx ? 0 : 2;
        return actor.cy < ty ? 1 : 3;
      }
      return null;
    },
  };
}

test('أرض البداية تساوي مربع نصف القطر', () => {
  const engine = new GameEngine({ config, seed: 7 });
  const actor = engine.addParticipant({ id: 1, kind: 'human', name: 'لاعب', colorIndex: 0 });
  assert.equal(actor.area, 7 * 7);
  assert.equal(actor.alive, true);
});

test('إغلاق حلقة خارج الأرض يستحوذ على المساحة المحصورة', () => {
  const engine = new GameEngine({ config, seed: 11 });
  const actor = engine.addParticipant({ id: 1, kind: 'human', name: 'لاعب', colorIndex: 0 });
  const startArea = actor.area;
  const x0 = actor.cx;
  const y0 = actor.cy;

  engine.setController(
    1,
    waypointController(1, [
      [x0 + 8, y0],
      [x0 + 8, y0 + 8],
      [x0, y0 + 8],
      [x0, y0],
    ]),
  );

  let captured = 0;
  const closed = runUntil(engine, () => {
    for (const event of engine.events) if (event.type === 'capture') captured += event.gained;
    engine.events.length = 0;
    return captured > 0;
  });

  assert.equal(closed, true, 'يجب أن تُغلق الحلقة خلال المهلة');
  assert.equal(actor.alive, true, 'يجب ألا يموت أثناء حلقة صحيحة');
  assert.equal(actor.outside, false, 'المسار يجب أن يُغلق عند العودة');
  assert.equal(actor.trail.length, 0);
  assert.ok(actor.area > startArea + 40, `المساحة يجب أن تزيد بوضوح (${startArea} → ${actor.area})`);
});

test('الارتطام بالمسار الذاتي يُخرج اللاعب من الجولة', () => {
  const engine = new GameEngine({ config, seed: 3 });
  const actor = engine.addParticipant({ id: 1, kind: 'human', name: 'لاعب', colorIndex: 0 });
  const x0 = actor.cx;
  const y0 = actor.cy;

  // يخرج يمينًا، يصعد، يرجع يسارًا، ثم ينزل فيقطع مساره الأفقي الأول.
  engine.setController(
    1,
    waypointController(1, [
      [x0 + 8, y0],
      [x0 + 8, y0 - 3],
      [x0 + 6, y0 - 3],
      [x0 + 6, y0 + 3],
    ]),
  );

  const died = runUntil(engine, () => !actor.alive);
  assert.equal(died, true, 'قطع المسار الذاتي يجب أن يُنهي الجولة');
  assert.equal(engine.status, 'ended');
  assert.equal(engine.endReason, 'eliminated');
});

test('قطع مسار خصم يقتله ويعيده لاحقًا', () => {
  const engine = new GameEngine({ config, seed: 5 });
  const hunter = engine.addParticipant({ id: 1, kind: 'human', name: 'صياد', colorIndex: 0 });
  const prey = engine.addParticipant({ id: 2, kind: 'bot', name: 'بوت', colorIndex: 1, difficulty: 'easy' });

  prey.cx = hunter.cx + 4;
  prey.cy = hunter.cy;
  prey.outside = true;
  const trailIndex = engine.grid.index(hunter.cx + 2, hunter.cy);
  engine.grid.trail[trailIndex] = prey.id;
  prey.trail.push(trailIndex);

  engine.setController(1, { actorId: 1, decide: () => 0 });
  engine.setController(2, { actorId: 2, decide: () => null });

  run(engine, 1);
  assert.equal(prey.alive, false, 'صاحب المسار المقطوع يخرج من الجولة');
  assert.equal(hunter.kills, 1);
  assert.equal(engine.grid.trail[trailIndex], 0, 'يُنظَّف المسار بعد الموت');

  run(engine, 3);
  assert.equal(prey.alive, true, 'البوت يعود بعد مهلة العودة');
});

test('البوتات تتحرك وتوسّع أراضيها دون أخطاء', () => {
  const engine = new GameEngine({ config, seed: 42 });
  engine.addParticipant({ id: 1, kind: 'human', name: 'لاعب', colorIndex: 0 });
  const bots = [];
  for (let i = 0; i < 5; i++) {
    const difficulty = ['easy', 'medium', 'hard'][i % 3];
    const bot = engine.addParticipant({
      id: 2 + i,
      kind: 'bot',
      name: `بوت ${i + 1}`,
      colorIndex: i + 1,
      difficulty,
    });
    engine.setController(bot.id, new BotController(bot.id, difficulty, engine.rng));
    bots.push(bot);
  }
  engine.setController(1, { actorId: 1, decide: () => null });

  const before = bots.map((b) => b.area);
  run(engine, 30);

  let grew = 0;
  for (let i = 0; i < bots.length; i++) {
    assert.ok(Number.isFinite(bots[i].area), 'المساحة يجب أن تبقى رقمًا صحيحًا');
    assert.ok(bots[i].cx >= 0 && bots[i].cx < config.gridWidth, 'البوت داخل الحدود');
    if (bots[i].area > before[i]) grew++;
  }
  assert.ok(grew >= 3, `أغلب البوتات يجب أن توسّع أراضيها (${grew}/5)`);

  const counted = new Map();
  for (const owner of engine.grid.owner) {
    if (owner !== 0) counted.set(owner, (counted.get(owner) ?? 0) + 1);
  }
  for (const actor of engine.actors) {
    assert.equal(actor.area, counted.get(actor.id) ?? 0, `محاسبة المساحة للمشارك ${actor.id}`);
  }
});
