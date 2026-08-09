// Отрисовка. Правило: рендер ничего не считает и не меняет — только рисует то,
// что уже лежит в state. Захотим перейти на WebGL — меняем только этот файл.

import { CONFIG } from '../config.js';
import { state } from '../core/state.js';
import { terrainById } from '../world/map.js';
import { UnitSheet, ObjectSet, BuildingSprites, AnimalSheets, WallSheet, loadImage, TREES, ROCKS, BUSHES } from './sprites.js';
import { WALL_TYPES, wallMask } from '../world/walls.js';
import { MOAT_TYPES, moatMask } from '../world/moat.js';
import { isSelected } from '../military/orders.js';
import { ActorSheet, dirIndex, stepAnim } from './actorsheet.js';
import { SPECIES } from '../world/animals.js';
import { buildMode } from '../ui/buildpanel.js';

const CARRY_COLOR = {
  wood: '#9a6a38', stone: '#b9b6ad', iron: '#8d94a0',
  wheat: '#d9be6a', flour: '#e6ddc4', bread: '#c08a4a',
};

export class Renderer {
  constructor(canvas, camera, map) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.camera = camera;
    this.map = map;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.units = new UnitSheet();
    this.trees = new ObjectSet('./assets/craftpix/trees', TREES);
    this.rocks = new ObjectSet('./assets/craftpix/rocks', ROCKS);
    this.bushes = new ObjectSet('./assets/craftpix/bushes', BUSHES);
    this.buildings = new BuildingSprites();
    this.animals = new AnimalSheets();
    this.wallSheet = new WallSheet();
    // мечник — готовый пак: 16 направлений и свои анимации
    this.swordsman = new ActorSheet('./assets/sprites/swordsman');
    this.moatSheet = loadImage('./assets/sprites/moat.png').img;

    // атлас местности: строка = тип, столбец = вариант
    const atlasRec = loadImage('./assets/sprites/terrain2.png');
    this.tileAtlas = atlasRec.img;
    const edgeRec = loadImage('./assets/sprites/edges.png');
    this.edgeAtlas = edgeRec.img;
    Promise.all([atlasRec.ready, edgeRec.ready]).then(() => this.buildTerrain());

    this.terrain = document.createElement('canvas');
    this.buildTerrain();
    this.resize();

    // общий список того, что сортируется по глубине
    this.drawList = [];

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.camera.clamp();
  }

  buildTerrain() {
    const T = CONFIG.TILE;
    this.terrain.width = this.map.w * T;
    this.terrain.height = this.map.h * T;
    const g = this.terrain.getContext('2d');
    g.imageSmoothingEnabled = false;

    // 1) текстурные тайлы; если атлас ещё не загружен — временная заливка цветом
    const atlas = this.tileAtlas;
    const ready = atlas && atlas.complete && atlas.naturalWidth;
    for (let y = 0; y < this.map.h; y++) {
      for (let x = 0; x < this.map.w; x++) {
        const id = this.map.tiles[this.map.idx(x, y)];
        if (ready) {
          const v = (x * 7 + y * 13 + ((x * y) % 3)) % 4;   // вариант тайла
          g.drawImage(atlas, v * T, id * T, T, T, x * T, y * T, T, T);
        } else {
          g.fillStyle = terrainById(id).color;
          g.fillRect(x * T, y * T, T, T);
        }
      }
    }

    // 2) переходы: сосед «главнее» наползает каймой, у воды берег,
    //    у скалы вертикальная стенка обрыва
    const edges = this.edgeAtlas;
    if (!edges || !edges.complete || !edges.naturalWidth) return;

    const ROW_CLIFF = 7, ROW_SHORE = 8;
    const WATER = 3, ROCK = 2;
    // кто на кого наползает: чем больше, тем «главнее»
    const PRIO = [0, 2, 4, 5, 1, 3, 4];

    const nb = (x, y, kind) => {
      let m = 0;
      if (this.map.inBounds(x, y - 1) && this.map.tiles[this.map.idx(x, y - 1)] === kind) m |= 1;
      if (this.map.inBounds(x + 1, y) && this.map.tiles[this.map.idx(x + 1, y)] === kind) m |= 2;
      if (this.map.inBounds(x, y + 1) && this.map.tiles[this.map.idx(x, y + 1)] === kind) m |= 4;
      if (this.map.inBounds(x - 1, y) && this.map.tiles[this.map.idx(x - 1, y)] === kind) m |= 8;
      return m;
    };

    for (let y = 0; y < this.map.h; y++) {
      for (let x = 0; x < this.map.w; x++) {
        const mine = this.map.tiles[this.map.idx(x, y)];

        for (let src = 0; src < 7; src++) {
          if (src === mine || PRIO[src] <= PRIO[mine]) continue;
          const m = nb(x, y, src);
          if (m) g.drawImage(edges, m * T, src * T, T, T, x * T, y * T, T, T);
        }

        if (mine !== WATER) {
          const m = nb(x, y, WATER);
          if (m) g.drawImage(edges, m * T, ROW_SHORE * T, T, T, x * T, y * T, T, T);
        }

        // обрыв рисуется на клетке ПОД скалой
        if (mine !== ROCK && this.map.inBounds(x, y - 1)
            && this.map.tiles[this.map.idx(x, y - 1)] === ROCK) {
          g.drawImage(edges, 1 * T, ROW_CLIFF * T, T, T, x * T, y * T, T, T);
        }
      }
    }
  }

  draw() {
    const ctx = this.ctx;
    const cam = this.camera;
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;

    ctx.fillStyle = '#0d0c0a';
    ctx.fillRect(0, 0, cw, ch);

    const tl = cam.screenToWorld(0, 0);
    const br = cam.screenToWorld(cw, ch);

    // --- слой местности ---
    const sx = Math.max(0, tl.x), sy = Math.max(0, tl.y);
    const ex = Math.min(this.terrain.width, br.x), ey = Math.min(this.terrain.height, br.y);
    if (ex > sx && ey > sy) {
      const p = cam.worldToScreen(sx, sy);
      ctx.drawImage(this.terrain, sx, sy, ex - sx, ey - sy,
                    p.x, p.y, (ex - sx) * cam.zoom, (ey - sy) * cam.zoom);
    }

    this.drawMoat(tl, br);
    if (state.showGrid) this.drawGrid(tl, br);
    this.drawSorted(tl, br);
    if (buildMode.active) this.drawGhost();
  }

  drawGrid(tl, br) {
    const ctx = this.ctx, cam = this.camera, T = CONFIG.TILE;
    if (cam.zoom < 0.6) return;

    const x0 = Math.max(0, Math.floor(tl.x / T));
    const x1 = Math.min(this.map.w, Math.ceil(br.x / T));
    const y0 = Math.max(0, Math.floor(tl.y / T));
    const y1 = Math.min(this.map.h, Math.ceil(br.y / T));

    ctx.strokeStyle = 'rgba(217,204,169,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x <= x1; x++) {
      const a = cam.worldToScreen(x * T, y0 * T), b = cam.worldToScreen(x * T, y1 * T);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    for (let y = y0; y <= y1; y++) {
      const a = cam.worldToScreen(x0 * T, y * T), b = cam.worldToScreen(x1 * T, y * T);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  /**
   * Всё, что стоит на земле, рисуется в порядке глубины: кто ниже по карте —
   * тот поверх. Иначе юнит будет закрывать дерево, за которым он стоит.
   */
  drawSorted(tl, br) {
    const ctx = this.ctx, cam = this.camera, T = CONFIG.TILE;
    const list = this.drawList;
    list.length = 0;

    const padX = 4 * T, padY = 5 * T;

    for (const d of this.map.decor) {
      const wx = d.x * T, wy = d.y * T;
      if (wx < tl.x - padX || wx > br.x + padX || wy < tl.y - padY || wy > br.y + padY) continue;
      list.push(d);
    }
    for (const e of state.entities) {
      const wx = e.x * T, wy = e.y * T;
      if (wx < tl.x - padX || wx > br.x + padX || wy < tl.y - padY || wy > br.y + padY) continue;
      list.push(e);
    }
    // стены: каждая клетка со стеной — отдельный объект сортировки
    const wx0 = Math.max(0, Math.floor(tl.x / T) - 1);
    const wx1 = Math.min(this.map.w - 1, Math.ceil(br.x / T) + 1);
    const wy0 = Math.max(0, Math.floor(tl.y / T) - 2);
    const wy1 = Math.min(this.map.h - 1, Math.ceil(br.y / T) + 1);
    for (let y = wy0; y <= wy1; y++) {
      for (let x = wx0; x <= wx1; x++) {
        const t = this.map.walls[this.map.idx(x, y)];
        if (!t) continue;
        list.push({ wall: t, x, y, sortY: y });
      }
    }

    for (const b of state.buildings) {
      const wx = b.x * T, wy = b.sortY * T;
      if (wx < tl.x - padX * 3 || wx > br.x + padX || wy < tl.y - padY * 3 || wy > br.y + padY) continue;
      list.push(b);
    }

    list.sort((a, b) => (a.sortY !== undefined ? a.sortY : a.y) - (b.sortY !== undefined ? b.sortY : b.y));

    for (const o of list) {
      if (o.wall) {
        const p = cam.worldToScreen(o.x * T, (o.y + 1) * T);
        this.wallSheet.draw(ctx, WALL_TYPES[o.wall].row, wallMask(this.map, o.x, o.y),
                            p.x, p.y, cam.zoom);
      } else if (o.def) {
        // здание
        const p = cam.worldToScreen(o.x * T, (o.y + o.h) * T);
        const sprite = o.def.stages ? `${o.def.id}_${o.growth | 0}` : o.def.id;
        this.buildings.draw(ctx, sprite, p.x, p.y, o.w, cam.zoom);

        // здание требует рабочих, но их нет — предупреждаем значком
        if ((o.def.workers || 0) > o.workers) {
          const s2 = Math.max(5, 10 * cam.zoom);
          const cx = p.x + o.w * T * cam.zoom / 2;
          ctx.fillStyle = 'rgba(200,80,70,0.92)';
          ctx.fillRect(cx - s2 / 2, p.y - s2 * 3.2, s2, s2);
          ctx.fillStyle = '#f2e8d6';
          ctx.fillRect(cx - 1, p.y - s2 * 3.2 + 2, 2, s2 - 4);
        }
      } else if (o.type === 'enemy') {
        const cx = (o.x + 0.5) * T, foot = (o.y + 1) * T;
        const p = cam.worldToScreen(cx, foot);
        const size = CONFIG.UNIT * cam.zoom;
        ctx.strokeStyle = 'rgba(226,96,80,0.9)';
        ctx.lineWidth = Math.max(1, 2 * cam.zoom);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y - 2 * cam.zoom, 11 * cam.zoom, 5 * cam.zoom, 0, 0, 6.3);
        ctx.stroke();
        const drawnFoe = o.role === 'swordsman' && this.swordsman.meta
          ? this.swordsman.draw(ctx, o.animName || 'idle', o.facing | 0,
                                o.animFrame | 0, p.x, p.y, cam.zoom * 2)
          : false;
        if (!drawnFoe) {
          this.units.draw(ctx, o.role, o.dir, o.frame | 0,
                          p.x - size / 2, p.y - size, cam.zoom);
        }
        if (o.hp < o.maxHp) {
          const bw = 20 * cam.zoom, bh = Math.max(2, 3 * cam.zoom);
          const by = p.y - size + 2 * cam.zoom;
          ctx.fillStyle = 'rgba(20,18,14,0.8)';
          ctx.fillRect(p.x - bw / 2, by, bw, bh);
          ctx.fillStyle = '#c0503f';
          ctx.fillRect(p.x - bw / 2, by, bw * Math.max(0, o.hp / o.maxHp), bh);
        }
      } else if (o.type === 'animal') {
        const sp = SPECIES[o.species];
        const cx = (o.x + 0.5) * T, foot = (o.y + 1) * T;
        const p = cam.worldToScreen(cx, foot);
        this.animals.draw(ctx, sp.file, o.dir, o.frame | 0, sp.frames, p.x, p.y, cam.zoom);
      } else if (o.kind) {
        const cx = (o.x + 0.5) * T, foot = (o.y + 1) * T;
        const p = cam.worldToScreen(cx, foot);
        const set = o.kind === 'tree' ? this.trees : (o.kind === 'rock' ? this.rocks : this.bushes);
        set.draw(ctx, o.v, p.x, p.y, o.s * cam.zoom);
      } else {
        // якорь юнита — низ спрайта на нижней грани его клетки
        const cx = (o.x + 0.5) * T, foot = (o.y + 1) * T;
        const p = cam.worldToScreen(cx, foot);
        const size = CONFIG.UNIT * cam.zoom;
        this.units.draw(ctx, o.role, o.dir, o.frame | 0,
                        p.x - size / 2, p.y - size, cam.zoom);

        // кольцо под выделенным солдатом
        if (o.type === 'soldier' && isSelected(o)) {
          ctx.strokeStyle = 'rgba(200,232,150,0.9)';
          ctx.lineWidth = Math.max(1, 2 * cam.zoom);
          ctx.beginPath();
          ctx.ellipse(p.x, p.y - 2 * cam.zoom, 11 * cam.zoom, 5 * cam.zoom, 0, 0, 6.3);
          ctx.stroke();
        }

        // полоска здоровья у раненых
        if (o.type === 'soldier' && o.hp < o.maxHp) {
          const bw = 20 * cam.zoom, bh = Math.max(2, 3 * cam.zoom);
          const by = p.y - size + 2 * cam.zoom;
          ctx.fillStyle = 'rgba(20,18,14,0.8)';
          ctx.fillRect(p.x - bw / 2, by, bw, bh);
          ctx.fillStyle = o.hp / o.maxHp > 0.4 ? '#7cc46a' : '#c0503f';
          ctx.fillRect(p.x - bw / 2, by, bw * (o.hp / o.maxHp), bh);
        }

        // ноша над головой — видно, кто уже несёт ресурс
        if (o.carry) {
          const s2 = Math.max(3, 7 * cam.zoom);
          const cy = p.y - size + 6 * cam.zoom;
          ctx.fillStyle = CARRY_COLOR[o.carry.res] || '#d9cca9';
          ctx.fillRect(p.x - s2 / 2, cy - s2, s2, s2);
          ctx.strokeStyle = 'rgba(20,18,14,0.8)';
          ctx.lineWidth = 1;
          ctx.strokeRect(p.x - s2 / 2, cy - s2, s2, s2);
        }
      }
    }
  }
}

Renderer.prototype.drawGhost = function () {
  const ctx = this.ctx, cam = this.camera, T = CONFIG.TILE;

  // линия стены или рва
  if (buildMode.wall) {
    for (const c of buildMode.tiles) {
      const i = this.map.idx(c.x, c.y);
      const ok = this.map.walkableTerrain(c.x, c.y)
        && !this.map.occupied[i] && !this.map.walls[i]
        && !(buildMode.moat && this.map.moat[i]);
      const p = cam.worldToScreen(c.x * T, c.y * T);
      ctx.fillStyle = ok ? 'rgba(120,200,110,0.34)' : 'rgba(200,80,70,0.36)';
      ctx.fillRect(p.x, p.y, T * cam.zoom, T * cam.zoom);
    }
    return;
  }

  const def = buildMode.def;
  const [w, h] = def.size;

  // подсветка пятна застройки
  const p0 = cam.worldToScreen(buildMode.tx * T, buildMode.ty * T);
  const sw = w * T * cam.zoom, sh = h * T * cam.zoom;
  ctx.fillStyle = buildMode.valid ? 'rgba(120,200,110,0.30)' : 'rgba(200,80,70,0.34)';
  ctx.fillRect(p0.x, p0.y, sw, sh);
  ctx.strokeStyle = buildMode.valid ? 'rgba(160,235,150,0.9)' : 'rgba(235,120,105,0.9)';
  ctx.lineWidth = 2;
  ctx.strokeRect(p0.x, p0.y, sw, sh);

  // клетчатая разметка по клеткам
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  for (let i = 1; i < w; i++) {
    ctx.beginPath(); ctx.moveTo(p0.x + i * T * cam.zoom, p0.y);
    ctx.lineTo(p0.x + i * T * cam.zoom, p0.y + sh); ctx.stroke();
  }
  for (let i = 1; i < h; i++) {
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y + i * T * cam.zoom);
    ctx.lineTo(p0.x + sw, p0.y + i * T * cam.zoom); ctx.stroke();
  }

  // сам призрак здания
  const pf = cam.worldToScreen(buildMode.tx * T, (buildMode.ty + h) * T);
  this.buildings.draw(ctx, def.id, pf.x, pf.y, w, cam.zoom, 0.62);
};

/** Ров лежит в земле, поэтому рисуется сразу после местности */
Renderer.prototype.drawMoat = function (tl, br) {
  const img = this.moatSheet;
  if (!img.complete || !img.naturalWidth) return;
  const ctx = this.ctx, cam = this.camera, T = CONFIG.TILE, map = this.map;

  const x0 = Math.max(0, Math.floor(tl.x / T));
  const x1 = Math.min(map.w - 1, Math.ceil(br.x / T));
  const y0 = Math.max(0, Math.floor(tl.y / T));
  const y1 = Math.min(map.h - 1, Math.ceil(br.y / T));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = map.moat[map.idx(x, y)];
      if (!t) continue;
      const p = cam.worldToScreen(x * T, y * T);
      const size = Math.ceil(T * cam.zoom) + 1;
      ctx.drawImage(img, moatMask(map, x, y) * T, MOAT_TYPES[t].row * T, T, T,
                    Math.round(p.x), Math.round(p.y), size, size);
    }
  }

  // стрелы
  for (const sh of state.shots) {
    const a = cam.worldToScreen((sh.x0 + 0.5) * T, (sh.y0 + 0.4) * T);
    const b = cam.worldToScreen((sh.x1 + 0.5) * T, (sh.y1 + 0.4) * T);
    ctx.strokeStyle = 'rgba(240,232,206,0.85)';
    ctx.lineWidth = Math.max(1, 1.5 * cam.zoom);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  // очаги огня поверх рва
  for (const f of state.fires) {
    const p = cam.worldToScreen((f.x + 0.5) * T, (f.y + 0.6) * T);
    const r = (6 + Math.sin(state.tick * 0.4 + f.x) * 2) * cam.zoom;
    ctx.fillStyle = 'rgba(226,110,40,0.75)';
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.3); ctx.fill();
    ctx.fillStyle = 'rgba(250,204,120,0.85)';
    ctx.beginPath(); ctx.arc(p.x, p.y - r * 0.3, r * 0.5, 0, 6.3); ctx.fill();
  }
};

/** Анимации многокадровых актёров крутятся отдельно от логики */
Renderer.prototype.stepActors = function (dt) {
  if (!this.swordsman.meta) return;
  for (const e of state.entities) {
    if (e.role !== 'swordsman') continue;
    stepAnim(e, this.swordsman, dt);
  }
};
