#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Рисует кадр игры из настоящих данных карты (world.json от node),
чтобы предпросмотр совпадал с тем, что реально в коде."""

import sys, json, random
sys.path.insert(0, 'tools')
from PIL import Image
from gen_sprites_v4 import draw_unit

T = 32
UNIT = 64
SCR_W, SCR_H = 1080, 1400

world = json.load(open('/tmp/world.json'))
tiles, decor, MW, MH = world['tiles'], world['decor'], world['w'], world['h']

COL = {0: (92, 122, 61), 1: (124, 100, 68), 2: (128, 126, 120),
       3: (44, 88, 118), 4: (78, 88, 62), 5: (56, 80, 44), 6: (120, 104, 84)}
ATLAS = Image.open('assets/sprites/terrain2.png').convert('RGBA')
EDGES = Image.open('assets/sprites/edges.png').convert('RGBA')
PRIO = [0, 2, 4, 5, 1, 3, 4]        # кто на кого наползает

img = Image.new('RGB', (SCR_W, SCR_H), (13, 12, 10))
px = img.load()
OX, OY = 4, 2
cols, rows = SCR_W // T + 1, SCR_H // T + 1

def at(mx, my):
    return tiles[(my % MH) * MW + (mx % MW)]

for ty in range(rows):
    for tx in range(cols):
        mx, my = tx + OX, ty + OY
        c = COL[at(mx, my)]
        n = ((mx * 31 + my * 57) % 5) - 3
        if n > 0:
            c = tuple(int(v * (1 - n * 0.010)) for v in c)
        tid = at(mx, my)
        v = (mx * 7 + my * 13 + ((mx * my) % 3)) % 4
        tile = ATLAS.crop((v * T, tid * T, (v + 1) * T, (tid + 1) * T))
        img.paste(tile, (tx * T, ty * T))

def nb(mx, my, kind):
    m = 0
    if at(mx, my - 1) == kind: m |= 1
    if at(mx + 1, my) == kind: m |= 2
    if at(mx, my + 1) == kind: m |= 4
    if at(mx - 1, my) == kind: m |= 8
    return m

for ty in range(rows):
    for tx in range(cols):
        mx, my = tx + OX, ty + OY
        mine = at(mx, my)
        for src in range(7):
            if src == mine or PRIO[src] <= PRIO[mine]:
                continue
            m = nb(mx, my, src)
            if m:
                e = EDGES.crop((m * T, src * T, (m + 1) * T, (src + 1) * T))
                img.paste(e, (tx * T, ty * T), e)
        if mine != 3:
            m = nb(mx, my, 3)
            if m:
                e = EDGES.crop((m * T, 8 * T, (m + 1) * T, 9 * T))
                img.paste(e, (tx * T, ty * T), e)
        if mine != 2 and at(mx, my - 1) == 2:
            e = EDGES.crop((1 * T, 7 * T, 2 * T, 8 * T))
            img.paste(e, (tx * T, ty * T), e)

def h32(a, b, c):
    h = (a * 374761393 + b * 668265263 + c * 2147483647) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 4294967296

DEPTH = [0.62, 0.34, 0.14, 0.05]
for ty in range(rows):
    for tx in range(cols):
        mx, my = tx + OX, ty + OY
        mine = at(mx, my)
        c = COL[mine]
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if at(mx + dx, my + dy) == mine:
                continue
            ntx, nty = tx + dx, ty + dy
            if not (0 <= ntx < cols and 0 <= nty < rows):
                continue
            for d in range(len(DEPTH)):
                for k in range(T):
                    xx = ntx * T + (d if dx > 0 else (T - 1 - d)) if dx else ntx * T + k
                    yy = nty * T + (d if dy > 0 else (T - 1 - d)) if dy else nty * T + k
                    if 0 <= xx < SCR_W and 0 <= yy < SCR_H and h32(xx, yy, d) < DEPTH[d]:
                        px[xx, yy] = c

def L(p): return Image.open(p).convert('RGBA')
TREES = [L(f'assets/craftpix/trees/{n}') for n in
         ['Tree1.png', 'Tree2.png', 'Tree3.png', 'Fruit_tree2.png']]
ROCKS = [L(f'assets/craftpix/rocks/{n}') for n in
         ['Rock1_1.png', 'Rock1_2.png', 'Rock2_1.png', 'Rock2_2.png', 'Rock3_1.png', 'Rock3_2.png']]
BUSHES = [L(f'assets/craftpix/bushes/{n}') for n in
          ['Bush_blue_flowers2.png', 'Bush_orange_flowers2.png',
           'Autumn_bush2.png', 'Bush_blue_flowers3.png']]

draw_items = []
for d in decor:
    sx, sy = d['x'] - OX, d['y'] - OY
    if not (-3 <= sx <= cols + 3 and -4 <= sy <= rows + 4):
        continue
    draw_items.append((sy, d))

random.seed(11)
roles = ['peasant', 'archer', 'spearman']
dirs = ['down', 'left', 'up', 'right']
for i in range(22):
    ux, uy = random.randrange(2, cols - 2), random.randrange(2, rows - 2)
    if tiles[((uy + OY) % MH) * MW + ((ux + OX) % MW)] in (2, 3, 5):
        continue
    draw_items.append((uy, {'kind': 'unit', 'x': ux + OX, 'y': uy + OY,
                            'role': roles[i % len(roles)], 'dir': dirs[i % 4],
                            'frame': random.randrange(8)}))

# постройки: донжон в центре и хозяйство вокруг
BUILD = [('keep', 15, 20, 5, 5), ('stockpile', 21, 22, 3, 3),
         ('hovel', 13, 27, 2, 2), ('hovel', 16, 27, 2, 2),
         ('granary', 21, 26, 3, 3), ('bakery', 12, 16, 3, 3),
         ('mill', 16, 15, 3, 3), ('woodcutter', 8, 12, 2, 2),
         ('wheatfarm_3', 20, 33, 3, 3), ('wheatfarm_1', 24, 33, 3, 3),
         ('barracks', 11, 32, 4, 3)]
BSPR = {b: Image.open(f'assets/sprites/buildings/{b}.png').convert('RGBA')
        for b, *_ in BUILD}

# кольцо стен вокруг замка
WALLS = Image.open('assets/sprites/walls.png').convert('RGBA')
wall_cells = set()
WX0, WY0, WX1, WY1 = 12, 17, 25, 30
for x in range(WX0, WX1 + 1):
    wall_cells.add((x, WY0)); wall_cells.add((x, WY1))
for y in range(WY0, WY1 + 1):
    wall_cells.add((WX0, y)); wall_cells.add((WX1, y))
for gx in (18, 19):                      # проём под ворота
    wall_cells.discard((gx, WY1))
for (wx, wy) in wall_cells:
    m = 0
    if (wx, wy - 1) in wall_cells: m |= 1
    if (wx + 1, wy) in wall_cells: m |= 2
    if (wx, wy + 1) in wall_cells: m |= 4
    if (wx - 1, wy) in wall_cells: m |= 8
    draw_items.append((wy, {'kind': 'wall', 'x': wx + OX, 'y': wy + OY, 'mask': m}))
for bid, bx, by, bw, bh in BUILD:
    draw_items.append((by + bh - 1, {'kind': 'building', 'id': bid,
                                     'x': bx + OX, 'y': by + OY, 'w': bw, 'h': bh}))

draw_items.sort(key=lambda p: p[0])

for _, o in draw_items:
    sx, sy = o['x'] - OX, o['y'] - OY
    if o['kind'] == 'wall':
        t = WALLS.crop((o['mask'] * 32, 0, (o['mask'] + 1) * 32, 48))
        img.paste(t, (sx * T, (sy + 1) * T - 48), t)
    elif o['kind'] == 'building':
        src = BSPR[o['id']]
        w = o['w'] * T
        sc = w / src.width
        hgt = int(src.height * sc)
        s2 = src.resize((w, hgt), Image.NEAREST)
        img.paste(s2, (sx * T, (sy + o['h']) * T - hgt), s2)
    elif o['kind'] == 'unit':
        sp = draw_unit(o['role'], o['dir'], o['frame'])
        img.paste(sp, (sx * T + T // 2 - UNIT // 2, (sy + 1) * T - UNIT), sp)
    else:
        src = {'tree': TREES, 'rock': ROCKS, 'bush': BUSHES}[o['kind']][o['v']]
        w, h = int(src.width * o['s']), int(src.height * o['s'])
        s2 = src.resize((w, h), Image.NEAREST)
        img.paste(s2, (sx * T + T // 2 - w // 2, (sy + 1) * T - h), s2)

img.save('/tmp/scene.png')
print('ok', img.size, len(draw_items))
