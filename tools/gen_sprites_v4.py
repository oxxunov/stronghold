#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генератор пиксельных юнитов v4 — 64x64.

Главное отличие от 32x32: силуэт больше не собирается из прямоугольников.
Каждая часть тела задаётся списком строк «с какого по какой пиксель заполнено»,
поэтому плечи сужаются к талии, голова имеет скулы и подбородок, сапог —
подъём. На 32 пикселях это было не нужно, на 64 без этого фигура выглядит
деревянной.

  * рампа из 6 оттенков на материал
  * свет сверху-слева: блик по верхней и левой кромке, тень по нижней и правой
  * контактная тень на стыке материалов
  * ходьба 8 кадров: вынос ноги, подъём стопы, противоход рук, качание корпуса
  * лицо: брови, белки, зрачки, нос, рот, скула, ухо
  * ткань: воротник, две складки, кайма подола, манжеты
  * кольчуга — кольцами со смещением рядов, а не шахматкой

Направления: down, left, up, right (left — отражение right).
"""

from PIL import Image, ImageDraw, ImageFont
import math

W = H = 64
FRAMES = 8
DIRS = ['down', 'left', 'up', 'right']
RU_DIR = {'down': 'вниз', 'left': 'влево', 'up': 'вверх', 'right': 'вправо'}
CX = 32                       # центр фигуры


def mix(c, k):
    if k >= 1:
        return tuple(min(255, int(v + (255 - v) * (k - 1))) for v in c)
    return tuple(max(0, int(v * k)) for v in c)


class Ramp:
    """Шесть ступеней одного материала."""
    def __init__(self, base):
        self.hi = mix(base, 1.42)
        self.lt = mix(base, 1.20)
        self.base = base
        self.md = mix(base, 0.86)
        self.sh = mix(base, 0.70)
        self.dk = mix(base, 0.48)


SKIN = Ramp((226, 176, 130))
STEEL = Ramp((170, 176, 188))
IRON = Ramp((104, 108, 118))
WOOD = Ramp((138, 102, 60))
LEATHER = Ramp((110, 76, 46))
LINEN = Ramp((214, 202, 174))

ROLES = {
    'peasant': {
        'name': 'Крестьянин',
        'cloth': Ramp((166, 132, 80)), 'legs': Ramp((104, 84, 56)),
        'boots': Ramp((72, 52, 34)), 'hair': Ramp((120, 78, 44)),
        'belt': Ramp((84, 58, 36)),
        'head': 'hair', 'weapon': None, 'shield': False, 'mail': False,
    },
    'archer': {
        'name': 'Лучник',
        'cloth': Ramp((98, 126, 70)), 'legs': Ramp((86, 72, 50)),
        'boots': Ramp((62, 46, 32)), 'hair': Ramp((82, 56, 34)),
        'belt': Ramp((80, 58, 38)),
        'head': 'hood', 'weapon': 'bow', 'shield': False, 'mail': False,
    },
    'spearman': {
        'name': 'Копейщик',
        'cloth': Ramp((142, 72, 58)), 'legs': Ramp((84, 70, 54)),
        'boots': Ramp((60, 44, 32)), 'hair': Ramp((74, 50, 30)),
        'belt': Ramp((78, 54, 36)),
        'head': 'kettle', 'weapon': 'spear', 'shield': False, 'mail': False,
    },
    'swordsman': {
        'name': 'Мечник',
        'cloth': Ramp((128, 134, 144)), 'legs': Ramp((92, 94, 102)),
        'boots': Ramp((58, 52, 46)), 'hair': Ramp((70, 48, 30)),
        'belt': Ramp((76, 52, 34)),
        'head': 'nasal', 'weapon': 'sword', 'shield': True, 'mail': True,
    },
}


# ----------------------------------------------------------------- холст
class Sprite:
    def __init__(self):
        self.px = {}
        self.mat = {}
        self.lock = set()
        self.shadow = {}

    def set(self, x, y, c, m='m', shade=True):
        if c is None or not (0 <= x < W and 0 <= y < H):
            return
        self.px[(x, y)] = c
        self.mat[(x, y)] = m
        (self.lock.discard if shade else self.lock.add)((x, y))

    def rect(self, x0, y0, x1, y1, c, m='m', shade=True):
        for y in range(min(y0, y1), max(y0, y1) + 1):
            for x in range(min(x0, x1), max(x0, x1) + 1):
                self.set(x, y, c, m, shade)

    def spans(self, spans, ramp, m='m', lit=2, shd=2):
        """Заливка силуэта по строкам с боковой светотенью.
        spans: {y: (x0, x1)}. lit/shd — ширина светлой и тёмной кромки."""
        ys = sorted(spans)
        for i, y in enumerate(ys):
            x0, x1 = spans[y]
            for x in range(x0, x1 + 1):
                c = ramp.base
                if x < x0 + lit:
                    c = ramp.lt
                if x > x1 - shd:
                    c = ramp.md
                if x == x1:
                    c = ramp.sh
                self.set(x, y, c, m)
            if i == 0:                                   # верхняя кромка ловит свет
                for x in range(x0, x1 + 1):
                    self.set(x, y, ramp.lt, m)
            if i == len(ys) - 1:                         # низ уходит в тень
                for x in range(x0, x1 + 1):
                    self.set(x, y, ramp.sh, m)

    # --- проходы ---
    def contact_shadow(self):
        out = dict(self.px)
        for (x, y), c in self.px.items():
            if (x, y) in self.lock:
                continue
            a = self.mat.get((x, y - 1))
            if a and a != self.mat[(x, y)]:
                out[(x, y)] = mix(c, 0.80)
            a2 = self.mat.get((x, y - 2))
            if a2 and a2 != self.mat[(x, y)] and a == self.mat[(x, y)]:
                out[(x, y)] = mix(c, 0.92)
        self.px = out

    def edge_light(self):
        out = dict(self.px)
        for (x, y), c in self.px.items():
            if (x, y) in self.lock:
                continue
            if (x, y - 1) not in self.px:
                out[(x, y)] = mix(c, 1.16)
            elif (x, y + 1) not in self.px:
                out[(x, y)] = mix(c, 0.78)
        self.px = out

    def outline(self):
        ring = {}
        for (x, y), c in self.px.items():
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (x + dx, y + dy)
                if n in self.px or not (0 <= n[0] < W and 0 <= n[1] < H):
                    continue
                cand = mix(c, 0.28)
                if n not in ring or sum(cand) < sum(ring[n]):
                    ring[n] = cand
        self.px.update(ring)

    def image(self):
        im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        p = im.load()
        for (x, y), a in self.shadow.items():
            if 0 <= x < W and 0 <= y < H and (x, y) not in self.px:
                p[x, y] = (0, 0, 0, a)
        for (x, y), c in self.px.items():
            p[x, y] = (*c, 255)
        return im


# ------------------------------------------------------- формы по строкам
def taper(y0, y1, w0, w1, cx=CX, bulge=0.0):
    """Сужающаяся форма: полуширина плавно идёт от w0 к w1."""
    out = {}
    n = max(1, y1 - y0)
    for i, y in enumerate(range(y0, y1 + 1)):
        t = i / n
        w = w0 + (w1 - w0) * t + bulge * math.sin(t * math.pi)
        hw = max(1, int(round(w)))
        out[y] = (cx - hw, cx + hw - 1)
    return out


def head_shape(y0, y1, hw, cx=CX):
    """Голова: скруглённый череп, скулы, сужение к подбородку."""
    out = {}
    n = y1 - y0
    for i, y in enumerate(range(y0, y1 + 1)):
        t = i / n
        if t < 0.12:
            w = hw - 3
        elif t < 0.25:
            w = hw - 1
        elif t < 0.62:
            w = hw
        elif t < 0.82:
            w = hw - 1
        else:
            w = hw - 2 - int((t - 0.82) * 8)
        w = max(2, w)
        out[y] = (cx - w, cx + w - 1)
    return out


def limb(y0, y1, x0, wide, lean=0):
    """Конечность: колонка с наклоном."""
    out = {}
    n = max(1, y1 - y0)
    for i, y in enumerate(range(y0, y1 + 1)):
        sx = x0 + int(round(lean * i / n))
        out[y] = (sx, sx + wide - 1)
    return out


# ---------------------------------------------------------------- фигура
def draw_unit(role_id, direction, frame):
    r = ROLES[role_id]
    s = Sprite()
    side = direction in ('left', 'right')
    flip = direction == 'left'

    # --- фазы ходьбы ---
    ph = 2 * math.pi * (frame % FRAMES) / FRAMES
    swing = math.sin(ph)                     # -1..1, вынос правой ноги
    bob = 1 if abs(math.sin(ph)) < 0.4 else 0

    cl, lg, bt, hr, bl = r['cloth'], r['legs'], r['boots'], r['hair'], r['belt']

    HEAD_T = 6 + bob
    HEAD_B = 21 + bob
    NECK_T = HEAD_B + 1
    SH_T = NECK_T + 2                        # плечи
    TORSO_B = 44
    LEG_T = 43
    BOOT_B = 59

    hw = 6 if not side else 5                # полуширина головы
    sw_ = 10 if not side else 7              # полуширина плеч
    ww = 7 if not side else 5                # полуширина талии

    # ---------------- тень на земле ----------------
    for x in range(CX - 11, CX + 11):
        d = abs(x - CX)
        s.shadow[(x, 61)] = 90 if d < 8 else 55
        s.shadow[(x, 62)] = 55 if d < 6 else 30
    for x in range(CX - 7, CX + 7):
        s.shadow[(x, 60)] = 70

    # ---------------- ноги ----------------
    # правая нога выносится вперёд при swing>0, левая при swing<0
    def leg(x_center, phase, back=False):
        dx = int(round(phase * (2 if side else 1)))
        raise_ = 2 if phase > 0.6 else (1 if phase > 0.15 else 0)   # вынесенная нога поднята
        top = LEG_T
        bot = BOOT_B - 4 - raise_
        ramp = lg if not back else Ramp(mix(lg.base, 0.80))
        sp = limb(top, bot, x_center - 3 + dx, 6, lean=(int(round(-phase)) if side else 0))
        s.spans(sp, ramp, 'leg')
        # колено — складка
        ky = top + (bot - top) // 2
        if ky in sp:
            a, b = sp[ky]
            s.rect(a + 1, ky, b - 1, ky, mix(ramp.base, 0.80), 'leg')
        # сапог
        by = bot + 1
        bsp = {}
        for i, y in enumerate(range(by, by + 4)):
            a, b = sp[bot]
            grow = 1 if i >= 2 else 0
            bsp[y] = (a - grow, b + grow + (1 if not side and i >= 2 else 0))
        s.spans(bsp, bt, 'boot')
        s.rect(sp[bot][0], by, sp[bot][1], by, bt.lt, 'boot')      # отворот

    if side:
        leg(CX + 1, swing)
        leg(CX - 2, -swing, back=True)
    else:
        leg(CX - 4, -swing)
        leg(CX + 4, swing)

    # ---------------- туловище ----------------
    torso = {}
    torso.update(taper(SH_T, SH_T + 3, sw_ - 1, sw_))              # плечи
    torso.update(taper(SH_T + 4, 37, sw_ - 1, ww))                 # грудь → талия
    torso.update(taper(38, TORSO_B, ww, ww + 2))                   # бёдра, подол
    s.spans(torso, cl, 'cloth', lit=3, shd=3)

    if r['mail']:                                                   # кольчуга кольцами
        for y in range(SH_T, TORSO_B + 1):
            a, b = torso[y]
            off = 0 if (y % 2 == 0) else 1
            for x in range(a + 1 + off, b, 2):
                s.set(x, y, mix(cl.base, 1.12), 'cloth')

    # складки на ткани
    for fx in (-3, 2):
        for y in range(SH_T + 6, 37):
            a, b = torso[y]
            x = CX + fx
            if a < x < b:
                s.set(x, y, mix(cl.base, 0.86), 'cloth')

    # воротник
    a, b = torso[SH_T]
    s.rect(CX - 4, SH_T, CX + 3, SH_T + 1, mix(cl.base, 0.72), 'collar')
    if direction == 'down':
        s.rect(CX - 2, SH_T, CX + 1, SH_T + 2, SKIN.md, 'neck')

    # кайма подола
    a, b = torso[TORSO_B]
    s.rect(a, TORSO_B - 1, b, TORSO_B - 1, mix(cl.base, 0.66), 'hem')

    # ---------------- пояс ----------------
    a, b = torso[38]
    s.rect(a, 38, b, 40, bl.base, 'belt')
    s.rect(a, 38, b, 38, bl.lt, 'belt')
    s.rect(CX - 2, 38, CX + 1, 40, bl.hi, 'buckle')
    s.rect(CX - 1, 39, CX, 39, bl.dk, 'buckle')
    if direction != 'up':                                           # поясная сумка
        px = b - 5
        s.rect(px, 41, px + 4, 46, LEATHER.base, 'pouch')
        s.rect(px, 41, px + 4, 41, LEATHER.lt, 'pouch')
        s.rect(px + 1, 44, px + 3, 44, LEATHER.sh, 'pouch')

    # ---------------- руки ----------------
    def arm(x0, phase, mirror=False):
        drop = int(round(phase * 2))
        top = SH_T + 3
        bot = 46 + drop
        sp = limb(top, bot - 4, x0, 4, lean=int(round(phase * 1.5)))
        s.spans(sp, Ramp(mix(cl.base, 0.88)), 'arm')
        # манжет
        a2, b2 = sp[bot - 4]
        s.rect(a2, bot - 4, b2, bot - 3, mix(cl.base, 0.62), 'cuff')
        # кисть
        hsp = limb(bot - 2, bot + 1, a2 - 1, 5, lean=0)
        s.spans(hsp, SKIN, 'hand')
        s.rect(a2 + 1, bot + 1, b2 - 1, bot + 1, SKIN.sh, 'hand')

    if side:
        arm(CX + sw_ - 1, swing)
    else:
        arm(CX - sw_ - 3, -swing)
        arm(CX + sw_ - 1, swing)

    # ---------------- шея ----------------
    s.rect(CX - 3, NECK_T, CX + 2, SH_T - 1, SKIN.md, 'neck')
    s.rect(CX - 3, NECK_T, CX + 2, NECK_T, SKIN.sh, 'neck')

    # ---------------- голова ----------------
    head = head_shape(HEAD_T, HEAD_B, hw)
    s.spans(head, SKIN, 'head', lit=2, shd=2)

    ht = r['head']
    if ht == 'hair':
        for y in range(HEAD_T, HEAD_T + 6):
            a, b = head[y]
            s.rect(a, y, b, y, hr.base, 'hair')
        a, b = head[HEAD_T]
        s.rect(a, HEAD_T, b, HEAD_T, hr.lt, 'hair')
        for y in range(HEAD_T + 6, HEAD_T + 9):                     # виски
            a, b = head[y]
            s.rect(a, y, a + 1, y, hr.sh, 'hair')
            s.rect(b - 1, y, b, y, hr.sh, 'hair')
        for i, x in enumerate(range(head[HEAD_T + 6][0] + 2, head[HEAD_T + 6][1] - 1, 3)):
            s.set(x, HEAD_T + 6, hr.md, 'hair')                     # чёлка прядями
            s.set(x + 1, HEAD_T + 6, hr.base, 'hair')
    elif ht == 'hood':
        hd = Ramp(mix(cl.base, 0.82))
        for y in range(HEAD_T - 1, HEAD_T + 7):
            a, b = head.get(y, head[HEAD_T])
            s.rect(a - 1, y, b + 1, y, hd.base, 'hood')
        s.rect(head[HEAD_T][0] - 1, HEAD_T - 1, head[HEAD_T][1] + 1, HEAD_T - 1, hd.lt, 'hood')
        for y in range(HEAD_T + 7, HEAD_B + 2):                     # ткань у щёк
            a, b = head.get(y, head[HEAD_B])
            s.rect(a - 1, y, a, y, hd.base, 'hood')
            s.rect(b, y, b + 1, y, hd.sh, 'hood')
        s.spans(taper(NECK_T, SH_T + 4, sw_ - 2, sw_), hd, 'mantle')  # пелерина
    elif ht in ('kettle', 'nasal'):
        for y in range(HEAD_T - 2, HEAD_T + 6):
            a, b = head.get(y, head[HEAD_T])
            s.rect(a, y, b, y, STEEL.base, 'steel')
        s.rect(head[HEAD_T][0] + 1, HEAD_T - 2, head[HEAD_T][1] - 1, HEAD_T - 2, STEEL.hi, 'steel')
        for y in range(HEAD_T - 1, HEAD_T + 6):                     # блик и тень на куполе
            a, b = head.get(y, head[HEAD_T])
            s.rect(a, y, a + 1, y, STEEL.lt, 'steel')
            s.rect(b - 1, y, b, y, STEEL.sh, 'steel')
        if ht == 'kettle':
            a, b = head[HEAD_T + 6]
            s.rect(a - 3, HEAD_T + 6, b + 3, HEAD_T + 6, STEEL.base, 'brim')
            s.rect(a - 3, HEAD_T + 7, b + 3, HEAD_T + 7, STEEL.dk, 'brim')
        else:
            for y in range(HEAD_T + 6, HEAD_B + 3):                 # бармица
                a, b = head.get(y, head[HEAD_B])
                s.rect(a - 1, y, a + 1, y, IRON.base, 'mail')
                s.rect(b - 1, y, b + 1, y, IRON.sh, 'mail')
                for x in range(a - 1, b + 2, 2):
                    if x < a + 2 or x > b - 2:
                        s.set(x, y, mix(IRON.base, 1.12), 'mail')

    # ---------------- лицо ----------------
    ey = HEAD_T + 8
    if direction == 'down':
        a, b = head[ey]
        s.rect(a + 1, ey - 2, a + 4, ey - 2, mix(SKIN.base, 0.70), 'brow')
        s.rect(b - 4, ey - 2, b - 1, ey - 2, mix(SKIN.base, 0.70), 'brow')
        s.rect(a + 2, ey, a + 3, ey + 1, (242, 236, 224), 'eye', shade=False)
        s.rect(b - 3, ey, b - 2, ey + 1, (242, 236, 224), 'eye', shade=False)
        s.set(a + 3, ey, (52, 38, 28), 'eye', shade=False)
        s.set(b - 3, ey, (52, 38, 28), 'eye', shade=False)
        s.rect(CX - 1, ey + 2, CX, ey + 3, SKIN.md, 'head')          # нос
        s.set(CX + 1, ey + 3, SKIN.sh, 'head')
        s.rect(CX - 1, ey + 5, CX, ey + 5, mix(SKIN.base, 0.66), 'mouth')
        s.rect(b - 1, ey - 1, b, ey + 2, SKIN.md, 'head')            # скула в тени
    elif direction == 'up':
        for y in range(HEAD_T, HEAD_B + 1):
            a, b = head[y]
            if ht == 'hair':
                s.rect(a, y, b, y, hr.base, 'hair')
            elif ht == 'hood':
                s.rect(a - 1, y, b + 1, y, mix(cl.base, 0.76), 'hood')
            elif y > HEAD_T + 5:
                s.rect(a - 1, y, b + 1, y, IRON.base, 'mail')
                for x in range(a, b + 1, 2):
                    s.set(x, y, mix(IRON.base, 1.10), 'mail')
        if ht == 'hair':
            a, b = head[HEAD_T]
            s.rect(a, HEAD_T, b, HEAD_T + 1, hr.lt, 'hair')
            s.rect(CX - 1, HEAD_T + 4, CX, HEAD_B, hr.sh, 'hair')    # пробор
    else:
        a, b = head[ey]
        s.rect(b - 4, ey - 2, b - 1, ey - 2, mix(SKIN.base, 0.68), 'brow')
        s.rect(b - 3, ey, b - 2, ey + 1, (242, 236, 224), 'eye', shade=False)
        s.set(b - 3, ey, (52, 38, 28), 'eye', shade=False)
        s.rect(b + 1, ey + 1, b + 1, ey + 3, SKIN.base, 'head')      # нос в профиль
        s.set(b + 1, ey + 4, SKIN.sh, 'head')
        s.rect(b - 2, ey + 5, b, ey + 5, mix(SKIN.base, 0.62), 'mouth')
        if ht == 'hair':
            for y in range(HEAD_T, HEAD_B - 1):
                a2, b2 = head[y]
                s.rect(a2, y, a2 + 3, y, hr.base, 'hair')            # затылок
                s.set(a2, y, hr.sh, 'hair')
        s.rect(a + 2, ey + 1, a + 3, ey + 2, SKIN.md, 'ear')         # ухо

    # ---------------- оружие ----------------
    wp = r['weapon']
    if wp == 'bow':
        bx = 47
        arc = []
        for y in range(8, 53):
            t = (y - 8) / 44
            off = int(round(4 * math.sin(t * math.pi)))
            arc.append((bx + off, y))
        for (x, y) in arc:
            s.set(x, y, WOOD.base, 'bow')
            s.set(x + 1, y, WOOD.sh, 'bow')
            s.set(x - 1, y, WOOD.lt, 'bow')
        s.rect(bx - 1, 28, bx + 2, 33, LEATHER.base, 'grip')          # рукоять лука
        for y in range(9, 52):
            s.set(bx - 1, y, (238, 230, 210), 'string', shade=False)  # тетива
        s.rect(38, 29, bx - 2, 30, WOOD.lt, 'arrow')                  # стрела
        s.rect(bx - 2, 29, bx - 1, 30, STEEL.lt, 'arrow', shade=False)
        s.rect(36, 28, 38, 31, LINEN.base, 'fletch')                  # оперение
    elif wp == 'spear':
        sx = 46
        s.rect(sx, 8, sx + 2, 60, WOOD.base, 'shaft')
        s.rect(sx, 8, sx, 60, WOOD.lt, 'shaft')
        s.rect(sx + 2, 8, sx + 2, 60, WOOD.sh, 'shaft')
        s.rect(sx, 30, sx + 2, 34, LEATHER.base, 'grip')              # обмотка
        for y in range(30, 35, 2):
            s.rect(sx, y, sx + 2, y, LEATHER.sh, 'grip')
        head_sp = {}
        for i, y in enumerate(range(1, 9)):                            # листовидное перо
            t = i / 7
            hw2 = int(round(3 * math.sin(t * math.pi))) + 1
            head_sp[y] = (sx + 1 - hw2, sx + 1 + hw2)
        s.spans(head_sp, STEEL, 'tip')
        s.rect(sx + 1, 2, sx + 1, 8, STEEL.hi, 'tip', shade=False)     # ребро жёсткости
    elif wp == 'sword':
        sx = 46
        blade = {}
        for i, y in enumerate(range(8, 34)):
            blade[y] = (sx, sx + 3) if y < 31 else (sx + 1, sx + 2)
        s.spans(blade, STEEL, 'blade')
        s.rect(sx, 8, sx, 30, STEEL.hi, 'blade', shade=False)          # блик
        s.rect(sx + 2, 8, sx + 2, 30, STEEL.md, 'blade', shade=False)  # дол
        s.rect(sx + 1, 6, sx + 2, 8, STEEL.lt, 'blade')                # остриё
        s.rect(sx - 3, 35, sx + 6, 37, mix(STEEL.base, 0.62), 'guard') # гарда
        s.rect(sx - 3, 35, sx + 6, 35, mix(STEEL.base, 0.8), 'guard')
        s.rect(sx, 38, sx + 3, 45, LEATHER.base, 'grip')
        for y in range(38, 46, 2):
            s.rect(sx, y, sx + 3, y, LEATHER.sh, 'grip')               # обмотка рукояти
        s.rect(sx - 1, 46, sx + 4, 48, (192, 158, 84), 'pommel')       # навершие
        s.set(sx, 46, (232, 206, 140), 'pommel', shade=False)

    if r['shield'] and direction != 'up':
        px = 17
        sh_sp = {}
        for i, y in enumerate(range(24, 50)):
            t = i / 25
            wd = 5 if t < 0.7 else int(round(5 - (t - 0.7) * 14))
            wd = max(1, wd)
            sh_sp[y] = (px - wd, px + wd)
        s.spans(sh_sp, Ramp((150, 104, 64)), 'shield')
        for y in range(24, 50, 6):                                     # доски
            a, b = sh_sp[y]
            s.rect(a, y, b, y, mix((150, 104, 64), 0.72), 'shield')
        s.rect(px - 4, 33, px + 4, 39, STEEL.base, 'boss')             # умбон
        s.rect(px - 3, 34, px + 3, 37, STEEL.lt, 'boss')
        s.rect(px - 1, 35, px + 1, 36, STEEL.hi, 'boss', shade=False)

    s.contact_shadow()
    s.edge_light()
    s.outline()
    im = s.image()
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    return im


# ----------------------------------------------------------------- вывод
def build_sheet(path):
    roles = list(ROLES)
    sheet = Image.new('RGBA', (W * FRAMES, H * len(DIRS) * len(roles)), (0, 0, 0, 0))
    row = 0
    for role in roles:
        for d in DIRS:
            for f in range(FRAMES):
                sheet.paste(draw_unit(role, d, f), (f * W, row * H))
            row += 1
    sheet.save(path)


def build_preview(path, roles=None, frames=(0, 2, 4, 6), scale=4):
    roles = roles or list(ROLES)
    pad, label_w, header = 8, 70, 36
    cell = W * scale
    img_w = label_w + len(frames) * (cell + pad) + pad
    img_h = header + len(roles) * (len(DIRS) * (cell + pad) + 26) + pad
    canvas = Image.new('RGB', (img_w, img_h), (20, 19, 15))
    d = ImageDraw.Draw(canvas)
    try:
        ft = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 17)
        fs = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
    except OSError:
        ft = fs = None
    d.text((pad, 9), 'Пиксельные юниты 64x64 — версия 4', fill=(195, 154, 63), font=ft)
    y = header
    for role in roles:
        d.text((pad, y), ROLES[role]['name'], fill=(217, 204, 169), font=ft)
        y += 24
        for di, dr in enumerate(DIRS):
            x = label_w
            d.text((pad, y + cell // 2 - 8), RU_DIR[dr], fill=(142, 131, 106), font=fs)
            for f in frames:
                sp = draw_unit(role, dr, f).resize((cell, cell), Image.NEAREST)
                bg = Image.new('RGB', (cell, cell), (62, 78, 46) if di % 2 == 0 else (54, 68, 40))
                bg.paste(sp, (0, 0), sp)
                canvas.paste(bg, (x, y))
                x += cell + pad
            y += cell + pad
        y += 12
    canvas.save(path)


if __name__ == '__main__':
    build_sheet('assets/sprites/units64.png')
    build_preview('preview_units_v4.png')
    print('готово')
