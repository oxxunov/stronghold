#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Осадные машины — 64x64, по три кадра: взведена, натянута, выстрел.

Катапульта: рама на колёсах, рычаг с ковшом.
Требушет: высокая рама, длинный рычаг с противовесом и пращой.
Таран: навес на колёсах с бревном.

Выход: assets/sprites/engines.png — строка на машину, 3 столбца.
"""

import math
from PIL import Image, ImageDraw

F = 64
FRAMES = 3

WOOD = (128, 92, 52)
WOOD_L = (162, 122, 74)
WOOD_D = (86, 62, 36)
IRON = (108, 112, 120)
ROPE = (196, 176, 132)
STONE = (146, 142, 132)


def mix(c, k):
    if k >= 1:
        return tuple(min(255, int(v + (255 - v) * (k - 1))) for v in c)
    return tuple(max(0, int(v * k)) for v in c)


class Cv:
    def __init__(self):
        self.im = Image.new('RGBA', (F, F), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def rect(self, x0, y0, x1, y1, c):
        self.d.rectangle([x0, y0, x1, y1], fill=(*c, 255))

    def line(self, x0, y0, x1, y1, c, w=1):
        self.d.line([x0, y0, x1, y1], fill=(*c, 255), width=w)

    def wheel(self, cx, cy, r):
        self.d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*WOOD_D, 255))
        self.d.ellipse([cx - r + 2, cy - r + 2, cx + r - 2, cy + r - 2], fill=(*WOOD, 255))
        self.d.ellipse([cx - 2, cy - 2, cx + 2, cy + 2], fill=(*IRON, 255))

    def outline(self):
        px = self.im.load()
        add = []
        for y in range(F):
            for x in range(F):
                if px[x, y][3] == 0:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < F and 0 <= ny < F and px[nx, ny][3] == 0:
                        add.append((nx, ny))
        for (x, y) in add:
            px[x, y] = (26, 20, 15, 255)


def shadow(cv, x0, x1, y):
    ov = Image.new('RGBA', (F, F), (0, 0, 0, 0))
    ImageDraw.Draw(ov).ellipse([x0, y - 3, x1, y + 3], fill=(0, 0, 0, 70))
    cv.im = Image.alpha_composite(ov, cv.im)
    cv.d = ImageDraw.Draw(cv.im)


def catapult(frame):
    cv = Cv()
    base_y = 52
    # рама
    cv.rect(12, base_y - 8, 52, base_y - 4, WOOD)
    cv.rect(12, base_y - 8, 52, base_y - 7, WOOD_L)
    cv.rect(16, base_y - 16, 20, base_y - 8, WOOD_D)
    cv.rect(44, base_y - 16, 48, base_y - 8, WOOD_D)
    cv.line(20, base_y - 16, 44, base_y - 16, WOOD, 2)
    # колёса
    cv.wheel(18, base_y - 2, 6)
    cv.wheel(46, base_y - 2, 6)
    # рычаг: угол зависит от кадра
    ang = {0: -55, 1: -20, 2: -95}[frame]
    a = math.radians(ang)
    px, py = 32, base_y - 16
    ex, ey = px + math.cos(a) * 26, py + math.sin(a) * 26
    cv.line(px, py, ex, ey, WOOD_L, 3)
    # ковш и камень
    cv.d.ellipse([ex - 5, ey - 5, ex + 5, ey + 5], fill=(*WOOD_D, 255))
    if frame < 2:
        cv.d.ellipse([ex - 3, ey - 4, ex + 3, ey + 2], fill=(*STONE, 255))
    else:
        cv.d.ellipse([ex - 12, ey - 14, ex - 6, ey - 8], fill=(*STONE, 255))
    # канат натяжения
    if frame == 1:
        cv.line(20, base_y - 12, ex, ey, ROPE, 1)
    shadow(cv, 12, 52, base_y + 4)
    cv.outline()
    return cv.im


def trebuchet(frame):
    cv = Cv()
    base_y = 56
    # опоры
    cv.rect(14, base_y - 6, 50, base_y - 2, WOOD)
    cv.line(22, base_y - 6, 32, 14, WOOD, 3)
    cv.line(42, base_y - 6, 32, 14, WOOD, 3)
    cv.rect(30, 12, 34, 18, WOOD_D)
    cv.wheel(20, base_y, 5)
    cv.wheel(44, base_y, 5)
    # рычаг через ось
    ang = {0: 30, 1: 5, 2: 150}[frame]
    a = math.radians(ang)
    cx, cy = 32, 16
    lx, ly = cx - math.cos(a) * 20, cy - math.sin(a) * 20
    sx, sy = cx + math.cos(a) * 26, cy + math.sin(a) * 26
    cv.line(lx, ly, sx, sy, WOOD_L, 3)
    # противовес
    cv.rect(lx - 5, ly - 4, lx + 5, ly + 7, STONE)
    cv.rect(lx - 5, ly - 4, lx + 5, ly - 2, mix(STONE, 1.2))
    # праща
    if frame < 2:
        cv.line(sx, sy, sx, sy + 10, ROPE, 1)
        cv.d.ellipse([sx - 4, sy + 8, sx + 4, sy + 15], fill=(*STONE, 255))
    else:
        cv.line(sx, sy, sx + 8, sy - 6, ROPE, 1)
        cv.d.ellipse([sx + 10, sy - 14, sx + 17, sy - 7], fill=(*STONE, 255))
    shadow(cv, 14, 50, base_y + 3)
    cv.outline()
    return cv.im


def ram(frame):
    cv = Cv()
    base_y = 50
    # навес
    cv.rect(10, base_y - 22, 54, base_y - 12, WOOD)
    for x in range(10, 54, 5):
        cv.rect(x, base_y - 22, x + 1, base_y - 12, WOOD_D)
    cv.rect(10, base_y - 23, 54, base_y - 21, WOOD_L)
    # стойки
    cv.rect(14, base_y - 12, 17, base_y - 2, WOOD_D)
    cv.rect(47, base_y - 12, 50, base_y - 2, WOOD_D)
    cv.wheel(16, base_y + 2, 5)
    cv.wheel(48, base_y + 2, 5)
    # бревно на канатах, ходит вперёд-назад
    off = {0: 0, 1: -5, 2: 7}[frame]
    cv.line(22, base_y - 12, 22, base_y - 8, ROPE, 1)
    cv.line(44, base_y - 12, 44, base_y - 8, ROPE, 1)
    cv.rect(14 + off, base_y - 9, 50 + off, base_y - 4, WOOD_L)
    cv.rect(14 + off, base_y - 9, 50 + off, base_y - 8, mix(WOOD_L, 1.15))
    cv.rect(48 + off, base_y - 10, 54 + off, base_y - 3, IRON)   # окованный нос
    shadow(cv, 10, 54, base_y + 6)
    cv.outline()
    return cv.im


def ladder(frame):
    """Приставная лестница: несут плашмя, у стены встаёт стоймя."""
    cv = Cv()
    if frame < 2:
        # несут: лежит наискось
        y0 = 34 + frame
        cv.rect(8, y0, 56, y0 + 3, WOOD)
        cv.rect(8, y0, 56, y0 + 1, WOOD_L)
        for x in range(10, 55, 6):
            cv.rect(x, y0 - 3, x + 2, y0 + 6, WOOD_D)
    else:
        # приставлена: стоит вертикально
        cv.rect(24, 6, 28, 58, WOOD)
        cv.rect(36, 6, 40, 58, WOOD)
        cv.rect(24, 6, 28, 8, WOOD_L)
        cv.rect(36, 6, 40, 8, WOOD_L)
        for y in range(12, 56, 7):
            cv.rect(26, y, 38, y + 2, WOOD_D)
            cv.rect(26, y, 38, y, WOOD_L)
    shadow(cv, 12, 52, 60)
    cv.outline()
    return cv.im


def siegetower(frame):
    """Осадная башня: обшитый сруб на колёсах, сверху откидной мостик."""
    cv = Cv()
    base = 56
    # корпус
    cv.rect(14, 12, 50, base - 6, WOOD)
    for x in range(14, 50, 5):
        cv.rect(x, 12, x + 1, base - 6, WOOD_D)
    cv.rect(14, 12, 50, 14, WOOD_L)
    # мокрые шкуры от огня
    cv.rect(14, 26, 50, 33, (122, 96, 72))
    cv.rect(14, 26, 50, 27, (150, 120, 92))
    # бойницы
    for x in (20, 30, 40):
        cv.rect(x, 18, x + 3, 24, (34, 28, 22))
    # колёса
    cv.wheel(20, base - 2, 6)
    cv.wheel(44, base - 2, 6)
    # мостик: сложен, опускается, лёг
    if frame == 0:
        cv.rect(16, 6, 48, 11, WOOD_L)
    elif frame == 1:
        cv.d.polygon([(16, 10), (48, 10), (52, 2), (20, 2)], fill=(*WOOD_L, 255))
    else:
        cv.rect(10, 4, 54, 9, WOOD_L)
        cv.rect(10, 4, 54, 5, mix(WOOD_L, 1.2))
        for x in range(12, 54, 6):
            cv.rect(x, 4, x + 1, 9, WOOD_D)
    shadow(cv, 14, 50, base + 4)
    cv.outline()
    return cv.im


ENGINES = [('catapult', catapult), ('trebuchet', trebuchet), ('ram', ram),
           ('ladder', ladder), ('siegetower', siegetower)]


def build(path='assets/sprites/engines.png'):
    sheet = Image.new('RGBA', (F * FRAMES, F * len(ENGINES)), (0, 0, 0, 0))
    for row, (name, fn) in enumerate(ENGINES):
        for fr in range(FRAMES):
            sheet.paste(fn(fr), (fr * F, row * F))
    sheet.save(path)
    return sheet


def preview(path='/tmp/engines.png', scale=4):
    sheet = build()
    big = sheet.resize((sheet.width * scale, sheet.height * scale), Image.NEAREST)
    bg = Image.new('RGB', big.size, (92, 122, 61))
    bg.paste(big, (0, 0), big)
    bg.save(path)


if __name__ == '__main__':
    build()
    preview()
    print('готово')
