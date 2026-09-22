import {
  NET_ANGLE_SCALE,
  NET_FLAG_ALIVE,
  NET_FLAG_OUTSIDE,
  NET_POS_SCALE,
  type NetActor,
} from '@riqaa/shared';
import type { GameEngine } from '../engine.js';
import { headingToDir, type Actor } from '../types.js';
import { decodeRle, encodeRle } from './codec.js';

/** يحزم مشاركًا في ستة أعداد صحيحة — هذا ما يُبث 15 مرة في الثانية. */
export function packActor(actor: Actor, areaPercent: number): NetActor {
  let flags = 0;
  if (actor.alive) flags |= NET_FLAG_ALIVE;
  if (actor.outside) flags |= NET_FLAG_OUTSIDE;
  return [
    actor.id,
    Math.round(actor.x * NET_POS_SCALE),
    Math.round(actor.y * NET_POS_SCALE),
    Math.round(actor.heading * NET_ANGLE_SCALE),
    flags,
    Math.round(areaPercent * 100),
  ];
}

export interface UnpackedActor {
  id: number;
  x: number;
  y: number;
  heading: number;
  alive: boolean;
  outside: boolean;
  areaPercent: number;
}

export function unpackActor(net: NetActor): UnpackedActor {
  return {
    id: net[0],
    x: net[1] / NET_POS_SCALE,
    y: net[2] / NET_POS_SCALE,
    heading: net[3] / NET_ANGLE_SCALE,
    alive: (net[4] & NET_FLAG_ALIVE) !== 0,
    outside: (net[4] & NET_FLAG_OUTSIDE) !== 0,
    areaPercent: net[5] / 100,
  };
}

/** يضع مشاركًا في موضع بعينه بلا محاكاة — يُستخدم عند التصحيح القاسي. */
export function placeAt(actor: Actor, x: number, y: number, heading: number): void {
  actor.x = x;
  actor.y = y;
  actor.cx = Math.floor(x);
  actor.cy = Math.floor(y);
  actor.heading = heading;
  actor.dir = headingToDir(heading);
}

/**
 * يعيد المشارك إلى الحياة على نسخة المرآة بعد أن أعاده الخادم.
 * لا ننشئ أرضًا هنا: الإطار المفتاحي التالي هو من يعيد رسم الملكية.
 */
export function reviveActor(engine: GameEngine, actor: Actor, state: UnpackedActor): void {
  const grid = engine.grid;
  for (const index of actor.trail) grid.trail[index] = 0;
  actor.trail.length = 0;
  actor.outside = state.outside;
  actor.alive = true;
  actor.respawnAt = -1;
  actor.blocked = false;
  placeAt(actor, state.x, state.y, state.heading);
  actor.minX = actor.cx;
  actor.maxX = actor.cx;
  actor.minY = actor.cy;
  actor.maxY = actor.cy;
  actor.exitCell = grid.index(actor.cx, actor.cy);
}

export interface Keyframe {
  owner: string;
  trail: string;
}

/** الإطار المفتاحي: صورة كاملة للأرض والمسارات كما يراها الخادم. */
export function encodeKeyframe(engine: GameEngine): Keyframe {
  return { owner: encodeRle(engine.grid.owner), trail: encodeRle(engine.grid.trail) };
}

/**
 * يستبدل شبكة المرآة بشبكة الخادم ثم يعيد بناء ما اشتُقّ منها
 * (المساحات، المسارات، الصناديق المحيطة). هذا هو سقف الانحراف:
 * أي خطأ تراكمي في التنبؤ المحلي يُمحى هنا.
 */
export function applyKeyframe(engine: GameEngine, frame: Keyframe): boolean {
  const grid = engine.grid;
  if (!decodeRle(frame.owner, grid.owner)) return false;
  if (!decodeRle(frame.trail, grid.trail)) return false;

  for (const actor of engine.actors) {
    actor.area = 0;
    actor.trail.length = 0;
    actor.minX = grid.width;
    actor.minY = grid.height;
    actor.maxX = 0;
    actor.maxY = 0;
  }

  const total = grid.owner.length;
  for (let index = 0; index < total; index++) {
    const owner = grid.owner[index];
    if (owner !== 0) {
      const actor = engine.actorById(owner);
      if (actor) {
        actor.area++;
        const x = index % grid.width;
        const y = (index / grid.width) | 0;
        if (x < actor.minX) actor.minX = x;
        if (y < actor.minY) actor.minY = y;
        if (x > actor.maxX) actor.maxX = x;
        if (y > actor.maxY) actor.maxY = y;
      }
    }
    const trailOwner = grid.trail[index];
    if (trailOwner !== 0) engine.actorById(trailOwner)?.trail.push(index);
  }

  for (const actor of engine.actors) {
    if (actor.minX > actor.maxX) {
      actor.minX = actor.cx;
      actor.maxX = actor.cx;
      actor.minY = actor.cy;
      actor.maxY = actor.cy;
    }
    actor.outside = actor.trail.length > 0;
  }
  return true;
}
