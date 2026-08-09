// Камера: перетаскивание одним пальцем, зум двумя, колесо мыши на десктопе.
// Держит границы карты, чтобы нельзя было улететь в пустоту.

import { CONFIG } from '../config.js';

export class Camera {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.map = map;
    this.zoom = CONFIG.ZOOM_START;
    this.x = (map.w * CONFIG.TILE) / 2;   // центр обзора в мировых пикселях
    this.y = (map.h * CONFIG.TILE) / 2;

    this.pointers = new Map();
    this.pinchDist = 0;
    this.pinchZoom = 1;
    this.moved = false;

    this._bind();
  }

  get viewW() { return this.canvas.clientWidth / this.zoom; }
  get viewH() { return this.canvas.clientHeight / this.zoom; }

  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x) * this.zoom + this.canvas.clientWidth / 2,
      y: (wy - this.y) * this.zoom + this.canvas.clientHeight / 2
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.canvas.clientWidth / 2) / this.zoom + this.x,
      y: (sy - this.canvas.clientHeight / 2) / this.zoom + this.y
    };
  }

  /** Клетка под точкой экрана — понадобится на этапе 1 для размещения зданий */
  screenToTile(sx, sy) {
    const w = this.screenToWorld(sx, sy);
    return { x: Math.floor(w.x / CONFIG.TILE), y: Math.floor(w.y / CONFIG.TILE) };
  }

  center() {
    this.x = (this.map.w * CONFIG.TILE) / 2;
    this.y = (this.map.h * CONFIG.TILE) / 2;
    this.zoom = Math.max(CONFIG.ZOOM_START, this.minZoom());
    this.clamp();
  }

  /** Меньше этого зума карта перестаёт закрывать экран и по краям чернота */
  minZoom() {
    const mw = this.map.w * CONFIG.TILE;
    const mh = this.map.h * CONFIG.TILE;
    const cw = this.canvas.clientWidth || 1;
    const ch = this.canvas.clientHeight || 1;
    return Math.max(CONFIG.ZOOM_MIN, cw / mw, ch / mh);
  }

  clamp() {
    this.zoom = Math.min(CONFIG.ZOOM_MAX, Math.max(this.minZoom(), this.zoom));
    const mw = this.map.w * CONFIG.TILE;
    const mh = this.map.h * CONFIG.TILE;
    const halfW = this.viewW / 2, halfH = this.viewH / 2;

    // если карта уже экрана — центрируем, иначе держим края
    this.x = mw < this.viewW ? mw / 2 : Math.min(mw - halfW, Math.max(halfW, this.x));
    this.y = mh < this.viewH ? mh / 2 : Math.min(mh - halfH, Math.max(halfH, this.y));
  }

  _bind() {
    const c = this.canvas;

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.moved = false;
      if (this.pointers.size === 2) {
        this.pinchDist = this._dist();
        this.pinchZoom = this.zoom;
      }
    });

    c.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;

      if (this.pointers.size === 1) {
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.moved = true;
        this.x -= dx / this.zoom;
        this.y -= dy / this.zoom;
        this.clamp();
      }

      p.x = e.clientX; p.y = e.clientY;

      if (this.pointers.size === 2 && this.pinchDist > 0) {
        this.moved = true;
        const d = this._dist();
        this.zoom = this.pinchZoom * (d / this.pinchDist);
        this.clamp();
      }
    });

    const up = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDist = 0;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom *= e.deltaY < 0 ? 1.1 : 0.9;
      this.clamp();
    }, { passive: false });

    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _dist() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}
