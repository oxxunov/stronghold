#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генератор рва — 16 вариантов стыковки на тип.

Ров не поднимается над землёй, а уходит вниз, поэтому тайл ровно 32x32
и рисуется до всего остального, как часть местности.

Типы: сухой ров (земляная выемка) и смоляной (залит смолой, горит).
Выход: assets/sprites/moat.png — строка на тип, 16 столбцов по маске.
"""

from PIL import Image

T = 32


def mix(c, k):
    if k >= 1:
        return tuple(min(255, int(v + (255 - v) * (k - 1))) for v in c)
    return tuple(max(0, int(v * k)) for v in c)


def h(x, y, s=0):
    n = (x * 374761393 + y * 668265263 + s * 2147483647) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFFFFFF) / 4294967296


TYPES = {
    'dry':   {'wall': (132, 110, 78), 'floor': (56, 44, 30), 'sheen': None},
    'pitch': {'wall': (104, 88, 66), 'floor': (34, 30, 28), 'sheen': (78, 70, 62)},
}


def draw_tile(kind, mask):
    """mask: N=1 E=2 S=4 W=8 — с какой стороны ров продолжается."""
    cfg = TYPES[kind]
    im = Image.new('RGBA', (T, T), (0, 0, 0, 0))
    p = im.load()

    n, e, s, w = mask & 1, mask & 2, mask & 4, mask & 8
    RIM = 6                                   # ширина откоса

    for y in range(T):
        for x in range(T):
            # расстояние до края выемки с каждой стороны
            dn = y if not n else RIM
            ds = (T - 1 - y) if not s else RIM
            dw = x if not w else RIM
            de = (T - 1 - x) if not e else RIM
            d = min(dn, ds, dw, de)

            if d < RIM:                        # откос: чем ближе к краю, тем светлее
                k = 1.10 - (d / RIM) * 0.42
                c = mix(cfg['wall'], k + h(x, y, 3) * 0.10)
                # северный откос освещён, южный в тени
                if dn == d:
                    c = mix(c, 1.12)
                if ds == d:
                    c = mix(c, 0.84)
            else:                              # дно
                c = mix(cfg['floor'], 0.94 + h(x, y, 5) * 0.16)
                if cfg['sheen'] and h(x, y, 7) > 0.90:
                    c = cfg['sheen']           # маслянистые блики на смоле

            p[x, y] = (*c, 255)

    # тёмная кромка по краю ямы, чтобы отделялась от травы
    for y in range(T):
        for x in range(T):
            edge = ((not n and y == 0) or (not s and y == T - 1)
                    or (not w and x == 0) or (not e and x == T - 1))
            if edge:
                p[x, y] = (*mix(cfg['wall'], 0.56), 255)

    return im


def build(path='assets/sprites/moat.png'):
    kinds = list(TYPES)
    sheet = Image.new('RGBA', (T * 16, T * len(kinds)), (0, 0, 0, 0))
    for row, kind in enumerate(kinds):
        for mask in range(16):
            sheet.paste(draw_tile(kind, mask), (mask * T, row * T))
    sheet.save(path)
    return sheet


def preview(path='/tmp/moat_preview.png', scale=5):
    sheet = build()
    # пример: ров буквой П
    cells = {}
    ring = [(x, 1) for x in range(1, 7)] + [(1, y) for y in range(1, 4)] + [(6, y) for y in range(1, 4)]
    for (x, y) in ring:
        m = 0
        if (x, y - 1) in ring: m |= 1
        if (x + 1, y) in ring: m |= 2
        if (x, y + 1) in ring: m |= 4
        if (x - 1, y) in ring: m |= 8
        cells[(x, y)] = m
    out = Image.new('RGB', (8 * T, 5 * T), (92, 122, 61))
    for (x, y), m in cells.items():
        out.paste(sheet.crop((m * T, 0, (m + 1) * T, T)), (x * T, y * T))
        out.paste(sheet.crop((m * T, T, (m + 1) * T, 2 * T)), (x * T, (y + 2) * T))
    out.resize((out.width * scale, out.height * scale), Image.NEAREST).save(path)


if __name__ == '__main__':
    build()
    preview()
    print('готово')
