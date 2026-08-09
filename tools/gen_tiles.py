#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генератор тайлсета местности — 32x32, по 4 варианта на тип.

Тайлы бесшовные: шум берётся по модулю 32, поэтому край стыкуется сам с собой
и повторяющаяся текстура не даёт видимой решётки.

Выход: assets/sprites/terrain.png
  строка = тип местности (порядок как в TERRAIN в src/world/map.js)
  столбец = вариант
"""

from PIL import Image
import math

T = 32
VARIANTS = 4

# порядок обязан совпадать с id в map.js
TYPES = ['grass', 'dirt', 'rock', 'water', 'marsh', 'forest', 'ore']


def h(x, y, s):
    """Детерминированный шум 0..1, замкнутый по модулю T."""
    x %= T; y %= T
    n = (x * 374761393 + y * 668265263 + s * 2147483647) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFFFFFF) / 4294967296


def blob(x, y, s, scale=8):
    """Крупные мягкие пятна — чтобы текстура не была равномерной кашей."""
    v = 0.0
    for oct_ in (1, 2):
        sx, sy = (x / scale) * oct_, (y / scale) * oct_
        v += (math.sin(sx * 2.19 + s + oct_) * math.cos(sy * 1.87 - s * 1.3)) / oct_
    return (v + 1.5) / 3.0


def mix(c, k):
    if k >= 1:
        return tuple(min(255, int(v + (255 - v) * (k - 1))) for v in c)
    return tuple(max(0, int(v * k)) for v in c)


def make_tile(kind, var):
    im = Image.new('RGBA', (T, T))
    p = im.load()
    s = var * 7 + 3

    if kind == 'grass':
        base = (92, 122, 61)
        for y in range(T):
            for x in range(T):
                k = 0.92 + blob(x, y, s) * 0.22
                c = mix(base, k)
                r = h(x, y, s)
                if r > 0.965:
                    c = mix(base, 1.30)              # светлая травинка
                elif r < 0.035:
                    c = mix(base, 0.78)              # тень у корней
                p[x, y] = (*c, 255)
        for i in range(3 + var):                     # кустики травы
            gx, gy = int(h(i, var, 11) * T), int(h(var, i, 13) * T)
            for dy in range(3):
                p[gx % T, (gy + dy) % T] = (*mix(base, 1.22 - dy * 0.06), 255)
                if dy < 2:
                    p[(gx + 1) % T, (gy + dy) % T] = (*mix(base, 1.10), 255)

    elif kind == 'dirt':
        base = (124, 100, 68)
        for y in range(T):
            for x in range(T):
                k = 0.90 + blob(x, y, s, 6) * 0.24
                c = mix(base, k)
                r = h(x, y, s)
                if r > 0.975:
                    c = mix((150, 140, 128), 1.0)    # камешек
                elif r < 0.04:
                    c = mix(base, 0.74)
                p[x, y] = (*c, 255)

    elif kind == 'rock':
        base = (128, 126, 120)
        for y in range(T):
            for x in range(T):
                k = 0.88 + blob(x, y, s, 10) * 0.26
                p[x, y] = (*mix(base, k), 255)
        for i in range(2):                            # трещины
            cx = int(h(i, var, 21) * T)
            yy = 0
            while yy < T:
                cx = (cx + (1 if h(cx, yy, 31) > 0.5 else -1)) % T
                p[cx, yy] = (*mix(base, 0.62), 255)
                p[(cx + 1) % T, yy] = (*mix(base, 0.80), 255)
                yy += 1

    elif kind == 'water':
        base = (44, 88, 118)
        for y in range(T):
            for x in range(T):
                k = 0.92 + blob(x, y, s, 12) * 0.18
                p[x, y] = (*mix(base, k), 255)
        for i in range(3):                            # блики-рябь
            wy = int(h(i, var, 41) * T)
            wx = int(h(var, i, 43) * T)
            for dx in range(5 + var):
                p[(wx + dx) % T, (wy + (dx // 3)) % T] = (*mix(base, 1.45), 255)

    elif kind == 'marsh':
        base = (78, 88, 62)
        for y in range(T):
            for x in range(T):
                k = 0.88 + blob(x, y, s, 7) * 0.26
                c = mix(base, k)
                if blob(x, y, s + 3, 5) > 0.72:
                    c = mix((52, 68, 66), 1.0)        # лужи
                p[x, y] = (*c, 255)

    elif kind == 'forest':
        base = (56, 80, 44)
        for y in range(T):
            for x in range(T):
                k = 0.86 + blob(x, y, s, 9) * 0.24
                c = mix(base, k)
                r = h(x, y, s)
                if r > 0.972:
                    c = (104, 82, 46)                 # опавшая листва
                elif r < 0.03:
                    c = mix(base, 0.70)
                p[x, y] = (*c, 255)

    elif kind == 'ore':
        base = (120, 104, 84)
        for y in range(T):
            for x in range(T):
                k = 0.88 + blob(x, y, s, 8) * 0.24
                c = mix(base, k)
                r = h(x, y, s + 5)
                if r > 0.955:
                    c = (176, 122, 60)                # рыжие вкрапления руды
                elif r > 0.94:
                    c = (86, 76, 66)
                p[x, y] = (*c, 255)

    return im


def build(path='assets/sprites/terrain.png'):
    sheet = Image.new('RGBA', (T * VARIANTS, T * len(TYPES)))
    for row, kind in enumerate(TYPES):
        for v in range(VARIANTS):
            sheet.paste(make_tile(kind, v), (v * T, row * T))
    sheet.save(path)
    return sheet


def preview(path='/tmp/terrain_preview.png', scale=6):
    sheet = build()
    big = sheet.resize((sheet.width * scale, sheet.height * scale), Image.NEAREST)
    bg = Image.new('RGB', big.size, (20, 19, 15))
    bg.paste(big, (0, 0), big)
    bg.save(path)


if __name__ == '__main__':
    build()
    preview()
    print('готово')
