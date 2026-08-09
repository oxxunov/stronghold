#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генератор стен — 16 вариантов стыковки на материал.

Стена рисуется не квадратом в клетку, а тайлом 32 в ширину и 48 в высоту:
нижние 32 пикселя — сама клетка, верхние 16 — высота кладки. Якорь снизу,
поэтому стена перекрывает то, что за ней, как и здания.

Стыковка задаётся битовой маской соседей: N=1, E=2, S=4, W=8.
Выход: assets/sprites/walls.png — строка на материал, 16 столбцов по маске.
"""

from PIL import Image, ImageDraw

T = 32
H = 48            # полная высота тайла
TOP = H - T       # насколько кладка поднимается над клеткой
THICK = 20        # толщина стены в пикселях


def mix(c, k):
    if k >= 1:
        return tuple(min(255, int(v + (255 - v) * (k - 1))) for v in c)
    return tuple(max(0, int(v * k)) for v in c)


def h(x, y, s=0):
    n = (x * 374761393 + y * 668265263 + s * 2147483647) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFFFFFF) / 4294967296


MATERIALS = {
    'stone': {'base': (146, 142, 132), 'block': (5, 9), 'merlon': True},
    'wood':  {'base': (132, 96, 56),   'block': None,   'merlon': False},
}


class Tile:
    def __init__(self):
        self.im = Image.new('RGBA', (T, H), (0, 0, 0, 0))
        self.p = self.im.load()

    def px(self, x, y, c):
        if 0 <= x < T and 0 <= y < H:
            self.p[int(x), int(y)] = (*c, 255)

    def rect(self, x0, y0, x1, y1, c):
        for y in range(max(0, int(y0)), min(H, int(y1) + 1)):
            for x in range(max(0, int(x0)), min(T, int(x1) + 1)):
                self.p[x, y] = (*c, 255)


def texture(t, x0, y0, x1, y1, mat, seed):
    """Кладка или частокол в заданном прямоугольнике."""
    base = mat['base']
    blk = mat['block']
    for y in range(int(y0), int(y1) + 1):
        for x in range(int(x0), int(x1) + 1):
            k = 0.94 + h(x, y, seed) * 0.16
            c = mix(base, k)
            if blk:
                bh, bw = blk
                row = (y - int(y0)) // bh
                off = (row % 2) * (bw // 2)
                if (y - int(y0)) % bh == 0 or (x - int(x0) + off) % bw == 0:
                    c = mix(base, 0.74)
            else:
                if (x - int(x0)) % 4 == 0:
                    c = mix(base, 0.72)          # стык брёвен частокола
            t.px(x, y, c)


def draw_tile(kind, mask):
    """mask: N=1 E=2 S=4 W=8 — куда стена продолжается."""
    mat = MATERIALS[kind]
    t = Tile()
    base = mat['base']

    half = THICK // 2
    cx0, cx1 = T // 2 - half, T // 2 + half - 1        # горизонтальные границы стержня
    top = TOP                                          # верх кладки
    bot = H - 1

    n, e, s, w = mask & 1, mask & 2, mask & 4, mask & 8

    # --- вертикальный ход стены (север-юг) ---
    if n or s or mask == 0:
        y0 = 0 if n else top + 4
        y1 = bot if s else bot - 6
        texture(t, cx0, y0, cx1, y1, mat, 1)
        # боковые кромки
        for y in range(int(y0), int(y1) + 1):
            t.px(cx0, y, mix(base, 1.16))
            t.px(cx1, y, mix(base, 0.76))

    # --- горизонтальный ход (запад-восток) ---
    if e or w:
        x0 = 0 if w else cx0
        x1 = T - 1 if e else cx1
        y0, y1 = top + 4, bot - 6
        texture(t, x0, y0, x1, y1, mat, 2)
        for x in range(int(x0), int(x1) + 1):
            t.px(x, y0, mix(base, 1.20))               # освещённый верх
            t.px(x, y1, mix(base, 0.70))               # тень снизу

    # --- зубцы поверх ---
    if mat['merlon']:
        # зубцы вдоль горизонтального хода — по верхней кромке
        if e or w:
            x0 = 0 if w else cx0
            x1 = T - 1 if e else cx1
            ytop = top + 4
            for mx in range(int(x0), int(x1) + 1, 7):
                t.rect(mx, ytop - 6, min(mx + 3, x1), ytop - 1, mix(base, 1.06))
                t.rect(mx, ytop - 6, min(mx + 3, x1), ytop - 5, mix(base, 1.26))

        # вдоль вертикального хода зубцы идут по обеим боковым кромкам:
        # сверху мы видим дорожку между двумя рядами зубцов
        if n or s or mask == 0:
            y0 = 0 if n else top + 4
            y1 = bot if s else bot - 6
            for my in range(int(y0), int(y1) + 1, 6):
                t.rect(cx0 - 2, my, cx0, min(my + 3, y1), mix(base, 1.14))
                t.rect(cx1, my, cx1 + 2, min(my + 3, y1), mix(base, 0.84))
    else:
        # частокол: заострённые верхушки
        if e or w:
            x0 = 0 if w else cx0
            x1 = T - 1 if e else cx1
            for x in range(int(x0), int(x1) + 1):
                if x % 4 == 1:
                    t.px(x, top + 2, mix(base, 1.2))
                    t.px(x, top + 3, mix(base, 1.1))
        if n or s or mask == 0:
            for x in range(cx0, cx1 + 1):
                if x % 4 == 1:
                    t.px(x, max(0, (0 if n else top + 4) - 2), mix(base, 1.2))

    # --- обводка ---
    px = t.im.load()
    add = []
    for y in range(H):
        for x in range(T):
            if px[x, y][3] == 0:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < T and 0 <= ny < H and px[nx, ny][3] == 0:
                    add.append((nx, ny))
    dark = mix(base, 0.34)
    for (x, y) in add:
        px[x, y] = (*dark, 255)

    return t.im


def build(path='assets/sprites/walls.png'):
    kinds = list(MATERIALS)
    sheet = Image.new('RGBA', (T * 16, H * len(kinds)), (0, 0, 0, 0))
    for row, kind in enumerate(kinds):
        for mask in range(16):
            sheet.paste(draw_tile(kind, mask), (mask * T, row * H))
    sheet.save(path)
    return sheet


def preview(path='/tmp/walls_preview.png', scale=4):
    sheet = build()
    big = sheet.resize((sheet.width * scale, sheet.height * scale), Image.NEAREST)
    bg = Image.new('RGB', big.size, (92, 122, 61))
    bg.paste(big, (0, 0), big)
    bg.save(path)


if __name__ == '__main__':
    build()
    preview()
    print('готово')
