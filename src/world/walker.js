// Юнит, ходящий по маршруту. На этапе 2 из него вырастет рабочий:
// поля path/pathStep/speed остаются, меняется только выбор цели.

import { CONFIG } from '../config.js';
import { state, addEntity } from '../core/state.js';
import { requestPath } from './pathfinding.js';
import { UNIT_ROLES } from '../render/sprites.js';
import { dirIndex } from '../render/actorsheet.js';

// в тестовой толпе показываем и мечника из пака — иначе его не увидеть,
// пока не построишь казарму и не наберёшь снаряжение
const TEST_ROLES = [...UNIT_ROLES, 'swordsman'];

/** Призвать только мечников — чтобы проверить пак, не разводя толпу */
export function spawnSwordsmen(map, count) {
  spawnWalkers(map, count, 'swordsman');
}

export function spawnWalkers(map, count, forceRole = null) {
  for (let i = 0; i < count; i++) {
    const p = map.randomWalkable();
    addEntity({
      type: 'walker',
      role: forceRole || TEST_ROLES[i % TEST_ROLES.length],
      x: p.x, y: p.y,
      speed: 1.4 + Math.random() * 1.2,   // клеток в секунду
      path: null,
      pathStep: 0,
      pathPending: false,
      idle: Math.random() * 2,
      dir: 'down',
      frame: 0,
      facing: 8,
      animState: 'idle', animName: 'idle', animFrame: 0, animTime: 0,
      anim: Math.random() * 8,            // фаза ходьбы, чтобы толпа не шагала в ногу
    });
  }
}

export function updateWalkers(map, dt) {
  for (const e of state.entities) {
    if (e.type !== 'walker') continue;

    if (!e.path || e.pathStep >= e.path.length) {
      if (e.pathPending) continue;
      e.idle -= dt;
      e.frame = 0;                        // стоит — первый кадр
      e.animState = 'idle';
      if (e.idle > 0) continue;
      const t = map.randomWalkable();
      requestPath(e, t.x, t.y);
      e.idle = 0.5 + Math.random() * 2.5;
      continue;
    }

    const node = e.path[e.pathStep];
    const dx = node.x - e.x, dy = node.y - e.y;
    const dist = Math.hypot(dx, dy);
    const step = e.speed * dt;

    if (dist > 0.001) {
      // направление взгляда по большей составляющей движения
      if (Math.abs(dx) > Math.abs(dy)) e.dir = dx > 0 ? 'right' : 'left';
      else e.dir = dy > 0 ? 'down' : 'up';
      e.facing = dirIndex(dx, dy);
      e.animState = 'walk';
    }

    if (dist <= step) {
      e.x = node.x; e.y = node.y;
      e.pathStep++;
    } else {
      e.x += (dx / dist) * step;
      e.y += (dy / dist) * step;
    }

    // кадр ходьбы привязан к пройденному пути, а не к времени —
    // тогда медленный юнит не семенит ногами на месте
    e.anim = (e.anim + step * 4) % CONFIG.UNIT_FRAMES;
    e.frame = Math.floor(e.anim);
  }
}
