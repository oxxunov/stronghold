#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генератор пиксельных юнитов v3 — 32x32.

Что добавлено против v2 (24x24):
  * холст 32x32 — помещаются кисти, манжеты, отвороты сапог, детали лица
  * тональные рампы: у каждого материала 5 оттенков (блик / светлый / база /
    тень / глубокая тень) вместо одного цвета
  * контактная тень: на стыке двух разных материалов нижний темнеет —
    голова отделяется от плеч, рука от корпуса, сапог от штанины
  * ходьба в 6 кадров вместо 4 — движение перестаёт «щёлкать»
  * текстуры: кольчуга шахматным дизерингом, складки на подоле, манжеты
  * оружие детальнее: лук с загнутыми плечами и стрелой, копьё с обмоткой
    и листовидным пером, меч с долом и навершием
  * двухслойная тень под ногами
"""

from PIL import Image, ImageDraw, ImageFont

W = H = 32
FRAMES = 6
DIRS = ['down', 'left', 'up', 'right']
RU_DIR = {'down': 'вниз', 'left': 'влево', 'up': 'вверх', 'right': 'вправо'}


def mix(c, k):
    if k >= 1:
        return tuple(min(255, int(v + (255 - v) * (k - 1))) for v in c)
    return tuple(int(v * k) for v in c)


class Ramp:
    """Пять оттенков одного материала."""
    def __init__(self, base):
        self.hi = mix(base, 1.34)
        self.lt = mix(base, 1.15)
        self.base = base
        self.sh = mix(base, 0.76)
        self.dk = mix(base, 0.52)


SKIN = Ramp((222, 172, 126))
STEEL = Ramp((166, 172, 182))
WOOD = Ramp((132, 98, 58))
LEATHER = Ramp((104, 72, 44))
IRON = Ramp((96, 100, 108))

ROLES = {
    'peasant': {
        'name': 'Крестьянин',
        'cloth': Ramp((162, 128, 78)), 'legs': Ramp((98, 80, 54)),
        'boots': Ramp((66, 48, 32)), 'hair': Ramp((116, 76, 42)),
        'belt': Ramp((78, 54, 34)),
        'head': 'hair', 'weapon': None, 'shield': False, 'mail': False,
    },
    'archer': {
        'name': 'Лучник',
        'cloth': Ramp((96, 122, 68)), 'legs': Ramp((82, 68, 48)),
        'boots': Ramp((58, 44, 30)), 'hair': Ramp((78, 54, 32)),
        'belt': Ramp((76, 56, 36)),
        'head': 'hood', 'weapon': 'bow', 'shield': False, 'mail': False,
    },
    'spearman': {
        'name': 'Копейщик',
        'cloth': Ramp((138, 70, 56)), 'legs': Ramp((80, 66, 52)),
        'boots': Ramp((56, 42, 30)), 'hair': Ramp((70, 48, 28)),
        'belt': Ramp((74, 52, 34)),
        'head': 'kettle', 'weapon': 'spear', 'shield': False, 'mail': False,
    },
    'swordsman': {
        'name': 'Мечник',
        'cloth': Ramp((124, 130, 140)), 'legs': Ramp((88, 90, 98)),
        'boots': Ramp((54, 48, 44)), 'hair': Ramp((66, 46, 28)),
        'belt': Ramp((72, 50, 32)),
        'head': 'nasal', 'weapon': 'sword', 'shield': True, 'mail': True,
    },
}


class Sprite:
    def __init__(self):
        self.px = {}        # (x,y) -> цвет
        self.mat = {}       # (x,y) -> имя материала (для контактных теней)
        self.lock = set()   # пиксели вне светотени
        self.shadow = {}    # (x,y) -> альфа

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

    # --- проходы обработки ---
    def edge_light(self):
        """Свет сверху-слева по кромкам."""
        out = dict(self.px)
        for (x, y), c in self.px.items():
            if (x, y) in self.lock:
                continue
            up = (x, y - 1) in self.px
            dn = (x, y + 1) in self.px
            lf = (x - 1, y) in self.px
            if not up and dn:
                out[(x, y)] = mix(c, 1.18)
            elif not dn and up:
                out[(x, y)] = mix(c, 0.80)
            elif not lf:
                out[(x, y)] = mix(c, 1.08)
        self.px = out

    def contact_shadow(self):
        """На стыке разных материалов нижний слегка темнеет — части тела разделяются."""
        out = dict(self.px)
        for (x, y), c in self.px.items():
            if (x, y) in self.lock:
                continue
            above = self.mat.get((x, y - 1))
            if above and above != self.mat[(x, y)]:
                out[(x, y)] = mix(c, 0.82)
        self.px = out

    def outline(self):
        ring = {}
        for (x, y), c in self.px.items():
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (x + dx, y + dy)
                if n in self.px or not (0 <= n[0] < W and 0 <= n[1] < H):
                    continue
                cand = mix(c, 0.30)
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


# ------------------------------------------------------------------ юнит
SWING = [0, 1, 2, 0, -1, -2]        # фазы шага для 6 кадров


def draw_unit(role_id, direction, frame):
    r = ROLES[role_id]
    s = Sprite()
    sw = SWING[frame % FRAMES]
    bob = 1 if abs(sw) == 1 else 0
    side = direction in ('left', 'right')
    flip = direction == 'left'

    HT = 3 + bob                 # верх головы
    HB = HT + 8                  # низ головы (9 рядов)
    NECK = HB + 1
    SH = NECK + 1                # плечи
    TB = 22                      # низ туловища
    LT = 23                      # верх ног

    if side:
        tx0, tx1 = 13, 18        # торс в профиль уже
        sx0, sx1 = 12, 19
        hx0, hx1 = 13, 18
    else:
        tx0, tx1 = 12, 19
        sx0, sx1 = 10, 21
        hx0, hx1 = 12, 19

    cl, lg, bt, hr, bl = r['cloth'], r['legs'], r['boots'], r['hair'], r['belt']

    # ---------------- тень под ногами ----------------
    for x in range(tx0 - 1, tx1 + 2):
        s.shadow[(x, 30)] = 80
    for x in range(tx0, tx1 + 1):
        s.shadow[(x, 31)] = 45
    s.shadow[(tx0 - 2, 30)] = 40
    s.shadow[(tx1 + 2, 30)] = 40

    # ---------------- ноги ----------------
    if side:
        legs = [(13, sw, True), (16, -sw, False)]      # (x, фаза, задняя ли нога)
    else:
        legs = [(12, sw, False), (17, -sw, False)]

    for lx, sg, back in legs:
        dx = 1 if sg >= 2 else (-1 if sg <= -2 else 0)
        raise_ = 2 if abs(sg) == 2 else (1 if abs(sg) == 1 else 0)
        x0 = lx + dx
        bot = 28 - raise_
        base = lg.sh if back else lg.base
        lite = lg.base if back else lg.lt
        s.rect(x0, LT, x0 + 2, bot, base, 'leg')
        s.rect(x0, LT, x0, bot, lite, 'leg')
        s.rect(x0 + 2, LT, x0 + 2, bot, mix(base, 0.78), 'leg')
        s.rect(x0, bot - 3, x0 + 2, bot - 3, mix(base, 0.82), 'leg')     # складка под коленом
        # сапог: отворот светлее голенища
        s.rect(x0, bot + 1, x0 + 2, bot + 1, bt.lt, 'boot')
        s.rect(x0, bot + 2, x0 + 2 + (0 if side else 1), bot + 2, bt.base, 'boot')

    # ---------------- туловище ----------------
    s.rect(tx0, SH, tx1, TB, cl.base, 'cloth')
    s.rect(sx0, SH, sx1, SH + 2, cl.base, 'cloth')                 # плечи
    s.rect(sx0, SH, sx1, SH, cl.lt, 'cloth')                       # свет по плечам
    s.rect(tx0, SH, tx0, TB, cl.lt, 'cloth')                       # освещённый бок
    s.rect(tx1, SH, tx1, TB, cl.sh, 'cloth')                       # теневой бок
    s.rect(tx0 + 1, TB - 3, tx1 - 1, TB - 3, cl.sh, 'cloth')       # складка подола
    s.rect(tx0, TB, tx1, TB, cl.sh, 'cloth')

    if r['mail']:                                                   # кольчуга дизерингом
        for y in range(SH, TB + 1):
            for x in range(tx0, tx1 + 1):
                if (x + y) % 2 == 0:
                    s.set(x, y, mix(cl.base, 1.07), 'cloth')

    # пояс с сумкой
    s.rect(tx0, 19, tx1, 20, bl.base, 'belt')
    s.rect(tx0, 19, tx1, 19, bl.lt, 'belt')
    s.rect(tx0 + 3, 19, tx0 + 4, 20, bl.hi, 'buckle')               # пряжка
    s.rect(tx1 - 1, 21, tx1, 22, LEATHER.base, 'pouch')             # поясная сумка
    s.set(tx1 - 1, 21, LEATHER.lt, 'pouch')

    # ---------------- руки ----------------
    dl = 1 if sw < 0 else 0
    dr = 1 if sw > 0 else 0
    arms = []
    if side:
        arms = [(sx1, dr)]
    else:
        arms = [(sx0, dl), (sx1, dr)]
    for ax, d in arms:
        s.rect(ax, SH + 2 + d, ax + (1 if ax == sx0 else -1), SH + 6 + d, cl.sh, 'arm')
        s.rect(ax, SH + 6 + d, ax, SH + 6 + d, mix(cl.base, 0.62), 'arm')   # манжет
        s.rect(ax, SH + 7 + d, ax + (1 if ax == sx0 else -1), SH + 8 + d, SKIN.base, 'hand')

    # ---------------- шея ----------------
    s.rect(14, NECK, 17, NECK, SKIN.sh, 'neck')

    # ---------------- голова ----------------
    s.rect(hx0, HT + 1, hx1, HB, SKIN.base, 'head')
    s.rect(hx0 + 1, HT, hx1 - 1, HT, SKIN.base, 'head')
    s.rect(hx0, HT + 1, hx0, HB - 1, SKIN.lt, 'head')
    s.rect(hx1, HT + 1, hx1, HB - 1, SKIN.sh, 'head')

    head = r['head']
    if head == 'hair':
        s.rect(hx0, HT, hx1, HT + 2, hr.base, 'hair')
        s.rect(hx0 + 1, HT - 1, hx1 - 1, HT - 1, hr.base, 'hair')
        s.rect(hx0, HT, hx1, HT, hr.lt, 'hair')
        s.set(hx0, HT + 3, hr.sh, 'hair')                # висок
        s.set(hx1, HT + 3, hr.sh, 'hair')
        s.set(hx0 + 1, HT + 3, hr.base, 'hair')          # чёлка
        s.set(hx1 - 1, HT + 3, hr.base, 'hair')
    elif head == 'hood':
        hd = mix(cl.base, 0.84)
        hds = mix(cl.base, 0.62)
        s.rect(hx0, HT, hx1, HT + 3, hd, 'hood')
        s.rect(hx0 + 1, HT - 1, hx1 - 1, HT - 1, hd, 'hood')
        s.rect(hx0, HT, hx1, HT, mix(cl.base, 1.05), 'hood')        # свет на макушке
        s.rect(hx0, HT + 4, hx0, HB, hd, 'hood')                    # ткань у щёк
        s.rect(hx1, HT + 4, hx1, HB, hds, 'hood')
        s.rect(hx0 + 1, HT + 4, hx1 - 1, HB, SKIN.base, 'head')     # проём лица
        s.rect(sx0 + 1, NECK, sx1 - 1, SH + 2, hds, 'mantle')       # пелерина на плечах
        s.rect(sx0 + 1, NECK, sx1 - 1, NECK, hd, 'mantle')
    elif head == 'kettle':
        s.rect(hx0, HT, hx1, HT + 3, STEEL.base, 'steel')
        s.rect(hx0 + 1, HT - 1, hx1 - 1, HT - 1, STEEL.lt, 'steel')
        s.rect(hx0, HT, hx1, HT, STEEL.hi, 'steel')
        s.rect(hx1, HT + 1, hx1, HT + 3, STEEL.sh, 'steel')
        s.rect(hx0 - 2, HT + 4, hx1 + 2, HT + 4, STEEL.base, 'brim')   # поля
        s.rect(hx0 - 2, HT + 5, hx1 + 2, HT + 5, STEEL.dk, 'brim')
    elif head == 'nasal':
        s.rect(hx0, HT, hx1, HT + 3, STEEL.base, 'steel')
        s.rect(hx0 + 1, HT - 1, hx1 - 1, HT - 1, STEEL.lt, 'steel')
        s.rect(hx0, HT, hx1, HT, STEEL.hi, 'steel')
        s.rect(hx1, HT + 1, hx1, HT + 3, STEEL.sh, 'steel')
        s.rect(hx0 - 1, HT + 4, hx0, HB + 1, IRON.base, 'mail')        # бармица
        s.rect(hx1, HT + 4, hx1 + 1, HB + 1, IRON.sh, 'mail')

    # ---------------- лицо ----------------
    ey = HT + 5
    if direction == 'down':
        s.rect(hx0 + 1, ey - 1, hx1 - 1, ey - 1, SKIN.sh, 'head')      # тень от брови
        s.set(hx0 + 1, ey, (48, 34, 26), 'eye', shade=False)
        s.set(hx0 + 2, ey, (238, 232, 220), 'eye', shade=False)
        s.set(hx1 - 2, ey, (238, 232, 220), 'eye', shade=False)
        s.set(hx1 - 1, ey, (48, 34, 26), 'eye', shade=False)
        s.rect(15, ey + 2, 16, ey + 2, SKIN.sh, 'head')                # нос
        s.rect(14, ey + 4, 17, ey + 4, mix(SKIN.base, 0.66), 'head')   # рот
        if head == 'nasal':
            s.rect(15, HT + 3, 16, ey + 2, STEEL.base, 'steel')        # наносник
            s.set(15, ey + 2, STEEL.sh, 'steel')
    elif direction == 'up':
        if head == 'hair':
            s.rect(hx0, HT, hx1, HB, hr.base, 'hair')
            s.rect(hx0, HT, hx1, HT + 1, hr.lt, 'hair')
            s.rect(hx0 + 2, HT + 4, hx1 - 2, HB, hr.sh, 'hair')
        elif head == 'hood':
            s.rect(hx0 - 1, HT, hx1 + 1, HB + 1, mix(cl.base, 0.78), 'hood')
            s.rect(hx0 - 1, HT, hx1 + 1, HT + 1, mix(cl.base, 0.92), 'hood')
        else:
            s.rect(hx0, HT + 4, hx1, HB + 1, IRON.base, 'mail')
            for y in range(HT + 4, HB + 2):
                for x in range(hx0, hx1 + 1):
                    if (x + y) % 2 == 0:
                        s.set(x, y, mix(IRON.base, 1.08), 'mail')
    else:
        if head == 'hair':
            s.rect(hx0, HT + 1, hx0 + 1, HB - 1, hr.base, 'hair')      # затылок
            s.rect(hx0, HT + 1, hx0, HB - 1, hr.sh, 'hair')
        s.rect(hx1 - 1, ey - 1, hx1 - 1, ey - 1, SKIN.sh, 'head')
        s.set(hx1 - 1, ey, (48, 34, 26), 'eye', shade=False)
        s.set(hx1 + 1, ey + 1, SKIN.base, 'head')                      # нос в профиль
        s.rect(hx1 - 1, ey + 3, hx1, ey + 3, mix(SKIN.base, 0.68), 'head')

    # ---------------- оружие ----------------
    wp = r['weapon']
    if wp == 'bow':
        limb = [(22, 6), (23, 7), (23, 8), (24, 9), (24, 10), (24, 11), (24, 12),
                (24, 13), (24, 14), (23, 15), (23, 16), (22, 17)]
        for (x, y) in limb:
            s.set(x, y, WOOD.base, 'bow')
            s.set(x, y - 0, WOOD.base, 'bow')
        s.set(21, 5, WOOD.sh, 'bow'); s.set(21, 18, WOOD.sh, 'bow')    # загнутые плечи
        for y in range(6, 18):
            s.set(22, y, (232, 224, 204), 'string', shade=False)       # тетива
        s.rect(19, 11, 22, 11, WOOD.lt, 'arrow')                        # стрела на тетиве
        s.set(23, 11, (222, 216, 200), 'arrow', shade=False)
    elif wp == 'spear':
        sx = 23
        s.rect(sx, 5, sx + 1, 30, WOOD.base, 'shaft')
        s.rect(sx, 5, sx, 30, WOOD.lt, 'shaft')
        s.rect(sx, 12, sx + 1, 13, LEATHER.base, 'grip')               # обмотка
        s.rect(sx, 2, sx + 1, 4, STEEL.base, 'tip')                    # перо
        s.set(sx, 1, STEEL.lt, 'tip'); s.set(sx + 1, 1, STEEL.base, 'tip')
        s.set(sx - 1, 4, STEEL.sh, 'tip'); s.set(sx + 2, 4, STEEL.sh, 'tip')
    elif wp == 'sword':
        sx = 23
        s.rect(sx, 6, sx + 1, 18, STEEL.hi, 'blade', shade=False)
        s.rect(sx + 1, 6, sx + 1, 18, STEEL.base, 'blade', shade=False)  # дол
        s.set(sx, 5, STEEL.lt, 'blade', shade=False)
        s.rect(sx - 1, 19, sx + 2, 19, mix(WOOD.base, 0.8), 'guard')     # гарда
        s.rect(sx, 20, sx + 1, 22, LEATHER.base, 'grip')
        s.rect(sx, 23, sx + 1, 23, (186, 152, 78), 'pommel')             # навершие

    if r['shield'] and direction != 'up':
        px = 7
        s.rect(px, 13, px + 3, 23, mix((118, 78, 48), 1.0), 'shield')
        s.rect(px + 1, 12, px + 2, 12, (118, 78, 48), 'shield')
        s.rect(px + 1, 24, px + 2, 24, mix((118, 78, 48), 0.8), 'shield')
        s.rect(px + 1, 14, px + 2, 22, (156, 108, 66), 'shield')
        s.rect(px + 1, 17, px + 2, 18, STEEL.base, 'boss')               # умбон
        s.set(px + 1, 17, STEEL.hi, 'boss')

    s.contact_shadow()
    s.edge_light()
    s.outline()
    im = s.image()
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    return im


# ------------------------------------------------------------------ вывод
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


def build_preview(path, scale=5):
    roles = list(ROLES)
    pad, label_w, header = 8, 68, 36
    cell = W * scale
    img_w = label_w + FRAMES * (cell + pad) + pad
    img_h = header + len(roles) * (len(DIRS) * (cell + pad) + 26) + pad
    canvas = Image.new('RGB', (img_w, img_h), (20, 19, 15))
    d = ImageDraw.Draw(canvas)
    try:
        ft = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 17)
        fs = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
    except OSError:
        ft = fs = None

    d.text((pad, 9), 'Пиксельные юниты 32x32 — версия 3, ходьба 6 кадров',
           fill=(195, 154, 63), font=ft)
    y = header
    for role in roles:
        d.text((pad, y), ROLES[role]['name'], fill=(217, 204, 169), font=ft)
        y += 24
        for di, dr in enumerate(DIRS):
            x = label_w
            d.text((pad, y + cell // 2 - 8), RU_DIR[dr], fill=(142, 131, 106), font=fs)
            for f in range(FRAMES):
                sp = draw_unit(role, dr, f).resize((cell, cell), Image.NEAREST)
                bg = Image.new('RGB', (cell, cell), (62, 78, 46) if di % 2 == 0 else (54, 68, 40))
                bg.paste(sp, (0, 0), sp)
                canvas.paste(bg, (x, y))
                x += cell + pad
            y += cell + pad
        y += 12
    canvas.save(path)


if __name__ == '__main__':
    build_sheet('assets/sprites/units32.png')
    build_preview('preview_units_v3.png')
    print('готово')
