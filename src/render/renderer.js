// Отрисовка. Правило: рендер ничего не считает и не меняет — только рисует то,
// что уже лежит в state. Захотим перейти на WebGL — меняем только этот файл.

import { CONFIG } from '../config.js';
import { state } from '../core/state.js';
import { terrainById } from '../world/map.js';
import { UnitSheet, ObjectSet, BuildingSprites, AnimalSheets, WallSheet, loadImage, TREES, ROCKS, BUSHES } from './sprites.js';
import { WALL_TYPES, wallMask } from '../world/walls.js';
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

    // атлас местности: строка = тип, столбец = вариант
    const atlasRec = loadImage('./assets/sprites/terrain.png');
    this.tileAtlas = atlasRec.img;
    atlasRec.ready.then(() => this.buildTerrain());   // перерисовать, когда придёт

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

    // 2) размытая кромка: соседние типы вгрызаются друг в друга рваной полосой,
    //    иначе границы выглядят лестницей из квадратов
    const hash = (a, b, c) => {
      let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
      h = (h ^ (h >> 13)) * 1274126177;
      return ((h ^ (h >> 16)) >>> 0) / 4294967296;
    };
    const DEPTH = [0.62, 0.34, 0.14, 0.05];

    for (let y = 0; y < this.map.h; y++) {
      for (let x = 0; x < this.map.w; x++) {
        const mine = this.map.tiles[this.map.idx(x, y)];
        const color = terrainById(mine).color;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (!this.map.inBounds(nx, ny)) continue;
          if (this.map.tiles[this.map.idx(nx, ny)] === mine) continue;

          g.fillStyle = color;
          for (let d = 0; d < DEPTH.length; d++) {
            for (let k = 0; k < T; k++) {
              const px = dx !== 0 ? nx * T + (dx > 0 ? d : T - 1 - d) : nx * T + k;
              const py = dy !== 0 ? ny * T + (dy > 0 ? d : T - 1 - d) : ny * T + k;
              if (hash(px, py, d) < DEPTH[d]) g.fillRect(px, py, 1, 1);
            }
          }
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

  // линия стены
  if (buildMode.wall) {
    for (const c of buildMode.tiles) {
      const ok = this.map.walkableTerrain(c.x, c.y)
        && !this.map.occupied[this.map.idx(c.x, c.y)]
        && !this.map.walls[this.map.idx(c.x, c.y)];
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
