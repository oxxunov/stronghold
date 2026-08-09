#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Тайлсет v2 — с переходами.

Что добавлено против первой версии:
  * ярче и насыщеннее палитра
  * кайма на стыке типов: земля вылезает на траву мягким краем
  * берег: отмель и пена там, где вода касается суши
  * обрыв: у скалы видна вертикальная стенка с тенью снизу
  * мелочь россыпью — травинки, камешки, цветы

Выход:
  assets/sprites/terrain2.png  — базовые тайлы (строка = тип, 4 варианта)
  assets/sprites/edges.png     — каймы: строка = тип, 16 столбцов по маске
"""

from PIL import Image
import math

T = 32
VARIANTS = 4
TYPES = ['grass', 'dirt', 'rock', 'water', 'marsh', 'forest', 'ore']

# палитра ярче прежней: свет сверху, тени холоднее
PAL = {
    'grass':  {'base': (116, 168, 76),  'dark': (86, 134, 58),  'light': (150, 196, 96)},
    'dirt':   {'base': (166, 128, 82),  'dark': (128, 96, 60),  'light': (192, 156, 106)},
    'rock':   {'base': (148, 148, 148), 'dark': (104, 104, 108), 'light': (182, 182, 180)},
    'water':  {'base': (58, 128, 186),  'dark': (38, 96, 152),  'light': (108, 176, 218)},
    'marsh':  {'base': (96, 120, 72),   'dark': (66, 88, 56),   'light': (128, 148, 92)},
    'forest': {'base': (72, 122, 58),   'dark': (48, 92, 44),   'light': (98, 148, 72)},
    'ore':    {'base': (150, 124, 92),  'dark': (110, 90, 66),  'light': (184, 152, 110)},
}


def mix(c, k):
    if k >= 1:
        return tuple(min(255, int(v + (255 - v) * (k - 1))) for v in c)
    return tuple(max(0, int(v * k)) for v in c)


def h(x, y, s=0):
    x %= T; y %= T
    n = (x * 374761393 + y * 668265263 + s * 2147483647) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFFFFFF) / 4294967296


def blob(x, y, s, scale=8):
    v = 0.0
    for oct_ in (1, 2):
        sx, sy = (x / scale) * oct_, (y / scale) * oct_
        v += (math.sin(sx * 2.19 + s + oct_) * math.cos(sy * 1.87 - s * 1.3)) / oct_
    return (v + 1.5) / 3.0


# ------------------------------------------------------------- базовые тайлы
def base_tile(kind, var):
    im = Image.new('RGBA', (T, T))
    p = im.load()
    pal = PAL[kind]
    s = var * 7 + 3

    for y in range(T):
        for x in range(T):
            k = 0.94 + blob(x, y, s, 9) * 0.16
            c = mix(pal['base'], k)
            r = h(x, y, s)
            if r > 0.972:
                c = pal['light']
            elif r < 0.03:
                c = pal['dark']
            p[x, y] = (*c, 255)

    # характерная мелочь по типу
    if kind == 'grass':
        for i in range(3 + var):                     # кустики травы
            gx, gy = int(h(i, var, 11) * T), int(h(var, i, 13) * T)
            for dy in range(4):
                p[gx % T, (gy + dy) % T] = (*mix(pal['light'], 1.0 - dy * 0.05), 255)
                if dy < 2:
                    p[(gx + 1) % T, (gy + dy) % T] = (*pal['base'], 255)
        if var % 2 == 0:                             # цветок
            fx, fy = int(h(var, 5, 17) * T), int(h(5, var, 19) * T)
            col = (232, 214, 96) if var % 4 == 0 else (226, 128, 152)
            for (dx, dy) in ((0, 0), (1, 0), (0, 1), (1, 1), (0, -1)):
                p[(fx + dx) % T, (fy + dy) % T] = (*col, 255)
    elif kind == 'dirt':
        for i in range(5):                           # камешки
            gx, gy = int(h(i, var, 21) * T), int(h(var, i, 23) * T)
            p[gx % T, gy % T] = (*mix(pal['light'], 1.1), 255)
            p[(gx + 1) % T, gy % T] = (*pal['dark'], 255)
    elif kind == 'water':
        for i in range(3):                           # блики волн
            wy = int(h(i, var, 41) * T)
            wx = int(h(var, i, 43) * T)
            for dx in range(4 + var):
                p[(wx + dx) % T, (wy + (dx // 3)) % T] = (*pal['light'], 255)
    elif kind == 'forest':
        for i in range(6):                           # листва на земле
            gx, gy = int(h(i, var, 31) * T), int(h(var, i, 33) * T)
            p[gx % T, gy % T] = (*(132, 106, 58), 255)
    elif kind == 'ore':
        for i in range(7):
            gx, gy = int(h(i, var, 51) * T), int(h(var, i, 53) * T)
            p[gx % T, gy % T] = (*(206, 146, 62), 255)

    return im


# --------------------------------------------------------------- каймы
def edge_tile(kind, mask):
    """Кайма типа `kind`, наползающая на соседнюю клетку.
    mask: N=1 E=2 S=4 W=8 — с каких сторон подходит наш тип."""
    im = Image.new('RGBA', (T, T), (0, 0, 0, 0))
    p = im.load()
    pal = PAL[kind]
    n, e, s, w = mask & 1, mask & 2, mask & 4, mask & 8

    DEPTH = 7

    def rim(x, y):
        """Насколько глубоко в клетку заходит кайма с ближайшей стороны."""
        best = 99
        if n: best = min(best, y)
        if s: best = min(best, T - 1 - y)
        if w: best = min(best, x)
        if e: best = min(best, T - 1 - x)
        return best

    for y in range(T):
        for x in range(T):
            d = rim(x, y)
            if d > DEPTH:
                continue
            # рваный край: глубина гуляет по шуму
            wob = h(x, y, 61) * 3.0
            if d > DEPTH - 3 + wob:
                continue
            k = 1.06 - (d / DEPTH) * 0.20
            c = mix(pal['base'], k)
            if d <= 1:
                c = pal['light'] if n and y <= 1 else mix(pal['base'], 1.10)
            p[x, y] = (*c, 255)

    return im


def cliff_tile(mask):
    """Обрыв: у скалы снизу видна вертикальная стенка с тенью.
    Рисуется поверх соседней клетки, поэтому строка отдельная."""
    im = Image.new('RGBA', (T, T), (0, 0, 0, 0))
    p = im.load()
    pal = PAL['rock']
    if not (mask & 1):            # стенка нужна только если скала сверху
        return im

    FACE = 12
    for y in range(FACE):
        for x in range(T):
            k = 1.02 - (y / FACE) * 0.42
            c = mix(pal['base'], k + h(x, y, 71) * 0.10)
            if (x + (y // 3) * 2) % 7 == 0:
                c = mix(c, 0.84)             # швы кладки обрыва
            p[x, y] = (*c, 255)
    for x in range(T):                        # тень под обрывом
        p[x, FACE] = (0, 0, 0, 90)
        p[x, FACE + 1] = (0, 0, 0, 45)
    return im


def shore_tile(mask):
    """Берег: отмель и пена там, где вода подходит к суше."""
    im = Image.new('RGBA', (T, T), (0, 0, 0, 0))
    p = im.load()
    pal = PAL['water']
    n, e, s, w = mask & 1, mask & 2, mask & 4, mask & 8
    if not mask:
        return im

    for y in range(T):
        for x in range(T):
            d = 99
            if n: d = min(d, y)
            if s: d = min(d, T - 1 - y)
            if w: d = min(d, x)
            if e: d = min(d, T - 1 - x)
            if d > 6:
                continue
            wob = h(x, y, 81) * 2.0
            if d <= 1 + wob:
                p[x, y] = (238, 246, 250, 235)          # пена
            elif d <= 5 + wob:
                p[x, y] = (*mix(pal['light'], 1.06), 200)   # отмель
    return im


# ----------------------------------------------------------------- сборка
def build(base_path='assets/sprites/terrain2.png',
          edge_path='assets/sprites/edges.png'):
    sheet = Image.new('RGBA', (T * VARIANTS, T * len(TYPES)))
    for row, kind in enumerate(TYPES):
        for v in range(VARIANTS):
            sheet.paste(base_tile(kind, v), (v * T, row * T))
    sheet.save(base_path)

    # каймы: по строке на тип + отдельные строки под обрыв и берег
    rows = TYPES + ['cliff', 'shore']
    edges = Image.new('RGBA', (T * 16, T * len(rows)), (0, 0, 0, 0))
    for row, kind in enumerate(rows):
        for mask in range(16):
            if kind == 'cliff':
                tile = cliff_tile(mask)
            elif kind == 'shore':
                tile = shore_tile(mask)
            else:
                tile = edge_tile(kind, mask)
            edges.paste(tile, (mask * T, row * T))
    edges.save(edge_path)
    return sheet, edges


if __name__ == '__main__':
    build()
    print('готово')
