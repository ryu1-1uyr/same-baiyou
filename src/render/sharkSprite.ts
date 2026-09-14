import type { MutationDef, MutationId, SharkPart } from '../game/mutations.ts'
import { asset, drawLayer, onAssetLoaded } from './assets.ts'
import { isDerived, MUTATIONS } from '../game/mutations.ts'
import {
  BODY_H,
  BODY_W,
  BODY_X,
  BODY_Y,
  drawBody,
  drawFin,
  drawTail,
  FRAME_H,
  FRAME_W,
  MID_Y,
  outline,
  PALETTE,
  px,
  type RGB,
  tintBands,
} from './pixel.ts'
import { bodyBottom, bodyHalf, bodyMid, bodyTop, inBody, trunkTop } from './silhouette.ts'

/**
 * 複合サメのスプライトを組み立てる。
 *
 * 変異は 18 種あり、組み合わせは 2^18 = 262,144 通りある。
 * 差分を描き分けるのは不可能なので、変異ごとに「絵のどこをどういじるか」だけを定義し、
 * 描画時に積み上げて 1 枚に焼く。
 *
 * チャンネルが違えば無条件に重なる。
 *   part     … 部位の置換（スロットごとに排他。レア度が高い方が勝つ）
 *   attach   … 部位の追加（重複可）
 *   transform… 大きさ・体数・傾き（乗算）
 *   palette  … 色を寄せる（順に合成）
 *   overlay  … 全身のエフェクト（加算）
 *
 * 合成した結果は mask 単位でキャッシュするため、コストは
 * 「その種類が初めて描かれた 1 回」だけで済む。
 */

type Ctx = CanvasRenderingContext2D

export type PartSlot = 'head' | 'tail' | 'body'

export type Visual = {
  part?: { slot: PartSlot; draw: (ctx: Ctx) => void }
  attach?: (ctx: Ctx) => void
  transform?: { scale?: number; count?: number; tilt?: number; alpha?: number }
  palette?: { rgb: RGB; amount: number }
  overlay?: (ctx: Ctx) => void
}

const RARITY_PRIORITY = { common: 1, uncommon: 2, rare: 3, legendary: 4 } as const

/**
 * base.png の頭の部分を切り出して、ずらした位置に貼る。
 *
 * 頭を手で描くとベースの絵柄と合わないが、**元の絵から切り出せば絵柄は構造的に一致する**。
 * base.png を描き替えても追従する。画像がまだ無いときは何も描かない
 * （仮の絵しか無い状態で四角い塊を出すより、頭が 1 つのままの方がマシなため）。
 */
const HEAD_FROM = 66
const HEAD_W = BODY_W - HEAD_FROM

function stampHead(ctx: Ctx, dx: number, dy: number): void {
  const img = asset('base')
  if (!img) return
  // 引数の並びが「元の矩形 / 描く先の矩形」なので、行を分けたまま読ませる
  // prettier-ignore
  ctx.drawImage(
    img,
    HEAD_FROM, 0, HEAD_W, BODY_H,
    BODY_X + HEAD_FROM + dx, BODY_Y + dy, HEAD_W, BODY_H,
  )
}

// ---------------------------------------------------------------------------
// 変異ごとの見た目
// ---------------------------------------------------------------------------

/**
 * 変異ごとの見た目。
 *
 * 位置は base.png の実シルエット（bodyTop / bodyBottom / trunkTop）を基準にしている。
 * 式で決め打ちしていないので、**base.png を描き替えると装飾も追従する**。
 */
/** 本体座標（0〜95, 0〜43）→ フレーム座標 */
const bx = (x: number) => BODY_X + x
const by = (y: number) => BODY_Y + y

/** 背びれの範囲。背に載せる装飾はここを避ける */
const DORSAL = [46, 66] as const
const onDorsal = (x: number) => x >= DORSAL[0] && x <= DORSAL[1]

/** 背中に沿って等間隔に装飾を置くときの x 候補（背びれを避ける） */
const BACK_XS = [22, 28, 34, 40, 70, 76]

/**
 * 変異ごとの見た目。
 *
 * base.png（96×44）のピクセル地図を元に配置している。主な目印:
 *   尾びれ x0〜13 / 第二背びれ x27〜33 / 背びれ x48〜64 / 目 (81,22) /
 *   鰓 x57〜63 / 口 y25 x87〜94 / 腹の白 y25〜33 / 胸びれ x55〜63 y30〜43
 * 背中の高さは実シルエット（trunkTop）から取るので、base を描き替えても追従する。
 */
const VISUALS: Partial<Record<MutationId, Visual>> = {
  // --- 生体系 ---
  glow: {
    overlay: (ctx) => outline(ctx, FRAME_W, FRAME_H, [140, 255, 210], 0.85),
  },
  frenzy: {
    palette: { rgb: [210, 60, 50], amount: 0.42 },
    attach: (ctx) => {
      // 口を開けて牙を見せる。口は y25、x87〜94
      px(ctx, bx(84), by(25), 10, 1, PALETTE.mouth)
      for (let i = 0; i < 4; i++) px(ctx, bx(85 + i * 2), by(26), 1, 2, '#ffffff')
    },
  },
  swift: {
    transform: { scale: 0.92 },
    palette: { rgb: [150, 200, 230], amount: 0.25 },
  },
  albino: {
    palette: { rgb: [244, 240, 236], amount: 0.72 },
  },
  spike: {
    attach: (ctx) => {
      // 背中の稜線に沿って棘。背びれの区間は避ける
      for (const x of BACK_XS) {
        if (!inBody(x)) continue
        const t = trunkTop(x)
        px(ctx, bx(x), t - 4, 1, 4, '#ece6d8')
        px(ctx, bx(x) + 1, t - 6, 1, 6, '#ece6d8')
        px(ctx, bx(x) + 2, t - 4, 1, 4, '#ece6d8')
        px(ctx, bx(x), t - 1, 3, 1, PALETTE.shade)
      }
    },
  },
  poison: {
    palette: { rgb: [110, 190, 90], amount: 0.5 },
    overlay: (ctx) => {
      // 体表の毒の泡。胴の範囲 y16〜30 に散らす
      // prettier-ignore
      const spots: Array<[number, number]> = [[26, 22], [34, 19], [42, 27], [50, 17], [68, 21], [74, 28], [80, 18], [38, 24], [64, 26]]
      for (const [x, y] of spots) {
        px(ctx, bx(x), by(y), 3, 3, '#c8ff7a')
        px(ctx, bx(x) + 1, by(y) + 1, 1, 1, '#f0ffc0')
      }
    },
  },
  twinHead: {
    part: {
      slot: 'head',
      // 元の絵から頭を切り出して、上にずらして貼る
      draw: (ctx) => stampHead(ctx, 2, -13),
    },
  },
  tripleHead: {
    part: {
      slot: 'head',
      draw: (ctx) => {
        stampHead(ctx, 2, -11)
        stampHead(ctx, 2, 11)
      },
    },
  },
  swarm: {
    // 「ダブル」なので 2 体。名前と見た目を一致させる。
    // 大きさは配置表側で決めるので、ここで枠を縮めない
    transform: { count: 2 },
  },
  triple: {
    transform: { count: 3 },
  },
  giant: {
    transform: { scale: 1.5 },
  },
  fungus: {
    palette: { rgb: [180, 150, 120], amount: 0.3 },
    attach: (ctx) => {
      // 背中から生えたキノコ。傘は軸の真上に載せる
      // prettier-ignore
      for (const [x, h, cap] of [[26, 5, 7], [38, 8, 9], [72, 6, 7], [82, 4, 5]] as const) {
        if (!inBody(x)) continue
        const t = trunkTop(x)
        const cx = bx(x)
        px(ctx, cx, t - h, 2, h, '#efe4cf')                       // 軸
        px(ctx, cx - Math.floor(cap / 2) + 1, t - h - 3, cap, 3, '#d4534a') // 傘
        px(ctx, cx - Math.floor(cap / 2) + 2, t - h - 4, cap - 2, 1, '#e26a5f')
        px(ctx, cx, t - h - 2, 1, 1, '#f9e0dc')                    // 傘の斑点
      }
    },
  },
  ghost: {
    transform: { alpha: 0.45 },
    palette: { rgb: [190, 215, 255], amount: 0.5 },
    overlay: (ctx) => outline(ctx, FRAME_W, FRAME_H, [200, 230, 255], 0.4),
  },
  zombie: {
    palette: { rgb: [120, 140, 95], amount: 0.55 },
    attach: (ctx) => {
      // 欠けた体と剥き出しの肋骨。胴の中央帯 y18〜28 に置く
      // prettier-ignore
      for (const [x, y, w] of [[30, 19, 7], [44, 24, 6], [68, 18, 6]] as const) {
        px(ctx, bx(x), by(y), w, 5, '#2a2f22')
        for (let i = 0; i < w; i += 2) px(ctx, bx(x) + i, by(y) + 1, 1, 3, '#ddd6c0')
      }
      // 垂れた眼
      px(ctx, bx(81), by(23), 2, 3, '#e8ff7a')
    },
  },
  ancient: {
    palette: { rgb: [150, 128, 84], amount: 0.45 },
    attach: (ctx) => {
      // 背中の骨質の隆起。棘より鈍い
      for (const x of BACK_XS) {
        if (!inBody(x)) continue
        const t = trunkTop(x)
        px(ctx, bx(x) - 1, t - 3, 4, 4, '#e6dcc0')
        px(ctx, bx(x), t - 4, 2, 1, '#f4ecd6')
      }
    },
  },

  // --- 深海系 ---
  pressure: {
    palette: { rgb: [110, 138, 160], amount: 0.4 },
    transform: { scale: 1.12 },
  },
  abyss: {
    palette: { rgb: [40, 30, 78], amount: 0.55 },
    overlay: (ctx) => outline(ctx, FRAME_W, FRAME_H, [120, 90, 220], 0.5),
  },
  tentacle: {
    part: {
      slot: 'tail',
      draw: (ctx) => {
        // 尾びれを消した跡（x0〜12）に、付け根 (13, 22) からタコ足を生やす
        for (let t = 0; t < 5; t++) {
          const y0 = by(16 + t * 3)
          const dir = t % 2 ? 1 : -1
          for (let i = 0; i < 16; i++) {
            const wob = Math.round(Math.sin(i * 0.5 + t * 1.3) * 3) * dir
            const thick = i < 10 ? 3 : 2
            px(ctx, bx(13 - i), y0 + wob + (i > 8 ? dir * 2 : 0), 1, thick, t % 2 ? '#8c5a86' : '#a06898')
          }
          // 先端の吸盤
          px(ctx, bx(-2), y0 + Math.round(Math.sin(15 * 0.5 + t * 1.3) * 3) * dir + dir * 2, 1, 1, '#d9a9d0')
        }
      },
    },
  },
  eldritch: {
    palette: { rgb: [90, 40, 110], amount: 0.35 },
    attach: (ctx) => {
      // 体表に増えた眼。鰓（x57〜63）は避ける
      // prettier-ignore
      for (const [x, y] of [[30, 20], [40, 25], [46, 18], [68, 20], [76, 26], [36, 29]] as const) {
        px(ctx, bx(x), by(y), 4, 4, '#ffe98a')
        px(ctx, bx(x) + 1, by(y) + 1, 2, 2, '#1a0f24')
      }
    },
  },

  // --- 機械系 ---
  armor: {
    attach: (ctx) => {
      // 背中に沿った装甲板。稜線から 7px ぶん被せる
      // prettier-ignore
      for (const [x0, x1] of [[20, 30], [32, 42], [66, 76], [78, 86]] as const) {
        for (let x = x0; x <= x1; x++) {
          if (!inBody(x)) continue
          const t = trunkTop(x)
          px(ctx, bx(x), t, 1, 7, PALETTE.metal)
          px(ctx, bx(x), t, 1, 1, '#c9d1d8')
          px(ctx, bx(x), t + 6, 1, 1, PALETTE.metalDark)
        }
        px(ctx, bx(x0), trunkTop(x0), 1, 7, PALETTE.metalDark)
        px(ctx, bx(x1), trunkTop(x1), 1, 7, PALETTE.metalDark)
      }
    },
  },
  mecha: {
    part: {
      slot: 'body',
      draw: (ctx) => {
        // 尾側の胴（x14〜45）を機械に置換。ひれはそのまま
        for (let x = 14; x <= 45; x++) {
          if (!inBody(x) || onDorsal(x)) continue
          const t = trunkTop(x)
          const h = Math.min(bodyBottom(x) - t, 15)
          px(ctx, bx(x), t, 1, h, PALETTE.metal)
          px(ctx, bx(x), t + h - 3, 1, 3, '#c9d1d8')
        }
        for (const x of [20, 28, 36, 44]) px(ctx, bx(x), trunkTop(x), 1, 14, PALETTE.metalDark)
        px(ctx, bx(31), trunkTop(31) + 5, 5, 5, '#ff6a4d')
        px(ctx, bx(32), trunkTop(32) + 6, 2, 2, '#ffd2c8')
      },
    },
  },
  volt: {
    overlay: (ctx) => {
      // 体に走る電撃
      // prettier-ignore
      for (const [sx, sy] of [[24, 10], [46, 6], [70, 8], [86, 12]] as const) {
        let x = bx(sx)
        let y = by(sy)
        for (let i = 0; i < 8; i++) {
          px(ctx, x, y, 2, 2, '#8ff0ff')
          px(ctx, x + (i % 2 ? 2 : -1), y + 1, 1, 1, '#ffffff')
          x += i % 2 ? 3 : -2
          y += 3
        }
      }
    },
  },
  autonomous: {
    attach: (ctx) => {
      // 背びれの後ろ（x68〜80）に砲塔
      const t = trunkTop(74)
      px(ctx, bx(66), t - 7, 14, 7, PALETTE.metal) // 台座
      px(ctx, bx(66), t - 7, 14, 1, '#c9d1d8')
      px(ctx, bx(78), t - 5, 12, 3, PALETTE.metalDark) // 砲身
      px(ctx, bx(88), t - 6, 2, 5, PALETTE.metalDark) // 砲口
      px(ctx, bx(70), t - 10, 3, 3, '#ff4d4d') // ランプ
    },
  },

  // --- 宇宙系 ---
  zeroG: {
    transform: { tilt: -0.28 },
    palette: { rgb: [200, 220, 255], amount: 0.25 },
  },
  meteor: {
    overlay: (ctx) => {
      // 尾から後ろへ引く炎。尾びれ (x0〜13) の後方に出す
      for (let i = 0; i < 12; i++) {
        const x = bx(2 - i * 1.4)
        const y = by(22) + Math.round(Math.sin(i * 0.8) * 3)
        const c = i < 3 ? '#fff6b0' : i < 7 ? '#ffb347' : '#e0542a'
        const sz = i < 3 ? 5 : i < 8 ? 4 : 3
        px(ctx, x, y - sz / 2, sz, sz, c)
      }
      // 尾びれ自体も燃える
      // prettier-ignore
      for (const [x, y] of [[3, 12], [6, 16], [2, 30], [5, 33]] as const) px(ctx, bx(x), by(y), 3, 3, '#ffb347')
    },
  },
  cosmic: {
    palette: { rgb: [24, 16, 52], amount: 0.6 },
    overlay: (ctx) => {
      // 体表に星空
      for (let i = 0; i < 40; i++) {
        const x = 16 + ((i * 17) % 76)
        if (!inBody(x)) continue
        const t = bodyTop(x)
        const b = bodyBottom(x)
        const y = t + 2 + ((i * 11) % Math.max(2, b - t - 4))
        px(ctx, bx(x), y, 1, 1, i % 4 ? '#ffffff' : '#9fd0ff')
      }
    },
  },
  alien: {
    palette: { rgb: [80, 230, 120], amount: 0.5 },
    attach: (ctx) => {
      // 頭の触角と、目 (81,22) を覆う大きな単眼
      const t = trunkTop(80)
      px(ctx, bx(82), t - 9, 2, 9, '#c8ffd8')
      px(ctx, bx(80), t - 13, 6, 5, '#e8ff6a')
      px(ctx, bx(81), t - 12, 2, 2, '#ffffff')
      px(ctx, bx(78), by(19), 8, 8, '#111820')
      px(ctx, bx(80), by(21), 4, 4, '#c8ff6a')
      px(ctx, bx(81), by(22), 1, 1, '#ffffff')
    },
  },

  // --- 災害系 ---
  tornado: {
    transform: { tilt: 0.34 },
    overlay: (ctx) => {
      // 体に巻き付く渦
      for (let i = 0; i < 24; i++) {
        const y = by(-6 + i * 2.3)
        const w = 8 + Math.abs(Math.sin(i * 0.55)) * 40
        px(ctx, bx(48) - w / 2, y, w, 1, i % 2 ? '#c4dfee' : '#7fa8c4')
      }
    },
  },
  magma: {
    palette: { rgb: [220, 90, 30], amount: 0.55 },
  },
  frozen: {
    palette: { rgb: [190, 230, 255], amount: 0.5 },
    attach: (ctx) => {
      // 体を覆う氷塊
      // prettier-ignore
      for (const [x, y, sz] of [[24, 18, 7], [42, 25, 8], [58, 16, 6], [72, 23, 8], [84, 17, 5]] as const) {
        px(ctx, bx(x), by(y), sz, sz, '#dff2ff')
        px(ctx, bx(x) + 1, by(y) + 1, 2, 2, '#ffffff')
        px(ctx, bx(x) + sz - 2, by(y) + sz - 2, 1, 1, '#9cc8e8')
      }
    },
  },
  storm: {
    overlay: (ctx) => {
      // 吹き付ける風の筋
      for (let i = 0; i < 12; i++) {
        const y = by(-2 + i * 4)
        const x = bx(-12 + ((i * 7) % 18))
        px(ctx, x, y, 30 + (i % 3) * 14, 1, '#dbe9f3')
        px(ctx, x + 6, y + 1, 12, 1, '#a9c4d6')
      }
    },
  },
  tsunami: {
    transform: { scale: 1.35 },
    overlay: (ctx) => {
      // 巻き込む水しぶき
      for (let i = 0; i < 40; i++) {
        const x = bx(-8 + i * 2.8)
        const y = by(22) + Math.round(Math.sin(i * 0.4) * 22)
        px(ctx, x, y, 3, 3, i % 3 ? '#7fd4ff' : '#ffffff')
      }
    },
  },
}

// ---------------------------------------------------------------------------
// 合成
// ---------------------------------------------------------------------------

function newCanvas(w: number, h: number): { c: HTMLCanvasElement; g: Ctx } {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  return { c, g }
}

/**
 * ベースのサメ 1 体ぶん（部位の置換を反映して）を 1 枚に描く。
 *
 * base.png は尾びれまで含んだ完成形なので、画像があるときは仮の尾を描かない。
 * 尾を置換する変異（触手化）は、base の尾びれの領域を消してから描く。
 */
const TAIL_W = 13 // base.png の尾びれが占める幅（付け根の手前まで）

function drawOne(
  g: Ctx,
  parts: Map<PartSlot, { id: MutationId; part: NonNullable<Visual['part']> }>,
  attaches: Array<{ id: MutationId; draw: (c: Ctx) => void }>,
): void {
  const tail = parts.get('tail')
  const body = parts.get('body')
  const head = parts.get('head')
  const hasBase = asset('base') !== null

  if (hasBase) {
    // base.png だけは 96×44 なので、枠の中の本体位置に置く。
    // 他のレイヤーは枠と同じ 128×72 なので (0,0) でよい。
    g.drawImage(asset('base')!, BODY_X, BODY_Y)
    if (tail) {
      g.clearRect(BODY_X, BODY_Y, TAIL_W, BODY_H)
      drawLayer(g, `part/tail/${tail.id}`, tail.part.draw)
    }
  } else {
    // 画像が無いときだけ仮の絵を組む
    if (tail) tail.part.draw(g)
    else drawTail(g)
    drawBody(g)
    drawFin(g, BODY_X + 36, MID_Y - bodyHalf(36), 18, 14, -1)
    drawFin(g, BODY_X + 60, MID_Y + bodyHalf(60) - 2, 14, 10, 1)
    px(g, BODY_X + 82, MID_Y - 6, 4, 4, PALETTE.eye)
    px(g, BODY_X + 86, MID_Y + 4, 10, 2, PALETTE.mouth)
  }

  if (body) drawLayer(g, `part/body/${body.id}`, body.part.draw)
  if (head) drawLayer(g, `part/head/${head.id}`, head.part.draw)
  for (const a of attaches) drawLayer(g, `attach/${a.id}`, a.draw)
}

const cache = new Map<string, HTMLCanvasElement>()

/**
 * キャッシュに残す枚数。
 *
 * 変異の組み合わせは数千通りあり、突撃ビュワーは頭数の比で選んだ見た目を
 * 次々に描く。上限を置かないと 1 枚 128x72 のキャンバスが際限なく積み上がる。
 * 同時に必要なのは記録 40 + 在庫 10 + ビュワー 16 程度なので 256 で足りる。
 */
const CACHE_LIMIT = 256

const keyOf = new WeakMap<readonly SharkPart[], string>()

/**
 * 組み合わせのキャッシュキー。変異 id を定義順に連結する。
 *
 * mask はランごとにビットの割り当てが変わり、ランをまたぐと別のサメを指すので使えない。
 * 同じ配列が毎フレーム渡される（突撃ビュワー）ため、配列ごとに覚えておく。
 */
export function spriteKey(defs: readonly SharkPart[]): string {
  const hit = keyOf.get(defs)
  if (hit !== undefined) return hit
  const ids = MUTATIONS.filter((m) => defs.includes(m)).map((m) => m.id as string)
  for (const d of defs) if (isDerived(d)) ids.push(`derived:${d.id}`)
  const key = ids.join('+')
  keyOf.set(defs, key)
  return key
}

const PLAIN: readonly MutationDef[] = []

/**
 * 派生種の仮の見た目。専用の絵を描くまで、素のサメに工事中の縞を重ねる。
 * 派生種を含む個体はほかの変異の見た目を載せず、すべてこの絵にする。
 */
function placeholderSprite(scale: number): HTMLCanvasElement {
  const base = sharkSprite(PLAIN, scale)
  const { c, g } = newCanvas(base.width, base.height)
  g.drawImage(base, 0, 0)
  // 縞はサメの不透明な部分にだけ乗せる
  g.globalCompositeOperation = 'source-atop'
  g.globalAlpha = 0.6
  const stripe = 6 * scale
  for (let x = -c.height; x < c.width + c.height; x += stripe * 2) {
    g.fillStyle = '#f2c230'
    g.beginPath()
    g.moveTo(x, c.height)
    g.lineTo(x + stripe, c.height)
    g.lineTo(x + stripe + c.height, 0)
    g.lineTo(x + c.height, 0)
    g.closePath()
    g.fill()
  }
  return c
}

/**
 * 変異の組み合わせからスプライトを作る。結果は組み合わせ単位でキャッシュする。
 * scale は論理ピクセル 1 つを何 px で描くか。
 */
export function sharkSprite(mutations: readonly SharkPart[], scale = 1): HTMLCanvasElement {
  const key = `${spriteKey(mutations)}@${scale}`
  const hit = cache.get(key)
  if (hit) return hit

  if (mutations.some(isDerived)) {
    const out = placeholderSprite(scale)
    remember(key, out)
    return out
  }

  // 部位の取り合いや塗り分けの順が渡し方に左右されないよう、定義順にそろえる
  const defs: MutationDef[] = MUTATIONS.filter((m) => mutations.includes(m))

  // --- チャンネルごとに集約 ---
  const parts = new Map<PartSlot, { id: MutationId; part: NonNullable<Visual['part']> }>()
  const partPriority = new Map<PartSlot, number>()
  const attaches: Array<{ id: MutationId; draw: (c: Ctx) => void }> = []
  const palettes: Array<{ rgb: RGB; amount: number }> = []
  const overlays: Array<{ id: MutationId; draw: (c: Ctx) => void }> = []
  let scaleMult = 1
  let count = 1
  let tilt = 0
  let alpha = 1

  for (const d of defs) {
    const v = VISUALS[d.id]
    if (!v) continue
    if (v.part) {
      // 同じスロットを取り合ったらレア度が高い方が勝つ
      const p = RARITY_PRIORITY[d.rarity]
      if ((partPriority.get(v.part.slot) ?? -1) < p) {
        parts.set(v.part.slot, { id: d.id, part: v.part })
        partPriority.set(v.part.slot, p)
      }
    }
    if (v.attach) attaches.push({ id: d.id, draw: v.attach })
    if (v.palette) palettes.push(v.palette)
    if (v.overlay) overlays.push({ id: d.id, draw: v.overlay })
    if (v.transform) {
      if (v.transform.scale) scaleMult *= v.transform.scale
      if (v.transform.count) count = Math.max(count, v.transform.count)
      if (v.transform.tilt) tilt += v.transform.tilt
      if (v.transform.alpha !== undefined) alpha *= v.transform.alpha
    }
  }

  // --- 1 体ぶんを論理サイズで描く ---
  const { c: unit, g: ug } = newCanvas(FRAME_W, FRAME_H)
  drawOne(ug, parts, attaches)
  // 色を変える変異が複数あるときは、混ぜずに体を等分して塗り分ける
  tintBands(ug, FRAME_W, FRAME_H, palettes, BODY_X, BODY_X + BODY_W)
  for (const o of overlays) drawLayer(ug, `overlay/${o.id}`, o.draw)

  // --- 変形を適用して最終キャンバスへ ---
  const outW = Math.ceil(FRAME_W * scaleMult * scale)
  const outH = Math.ceil(FRAME_H * scaleMult * scale)
  const { c: out, g } = newCanvas(outW, outH)

  const placements =
    count === 1
      ? [{ x: 0, y: 0, s: 1 }]
      : count === 2
        ? [
            { x: -0.15, y: -0.11, s: 0.74 },
            { x: 0.15, y: 0.11, s: 0.74 },
          ]
        : [
            { x: -0.25, y: -0.13, s: 0.6 },
            { x: 0.02, y: 0.07, s: 0.64 },
            { x: 0.26, y: -0.05, s: 0.56 },
          ]

  g.globalAlpha = alpha
  for (const p of placements) {
    g.save()
    g.translate(p.x * outW + outW / 2, p.y * outH + outH / 2)
    if (tilt) g.rotate(tilt)
    const w = outW * p.s
    const h = outH * p.s
    g.drawImage(unit, -w / 2, -h / 2, w, h)
    g.restore()
  }
  g.globalAlpha = 1

  remember(key, out)
  return out
}

function remember(key: string, out: HTMLCanvasElement): void {
  // 一番古い 1 枚を捨てる。Map は挿入順を保つのでこれで足りる
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, out)
}

/** 在庫やリザルトなど、DOM に画像として置きたい場所向け */
export function sharkDataUrl(mutations: readonly SharkPart[], scale = 2): string {
  return sharkSprite(mutations, scale).toDataURL()
}

// 画像が後から読み込まれたら、合成済みのキャッシュを捨てて描き直させる
onAssetLoaded(() => {
  cache.clear()
  boundsCache.clear()
})

/** 合成結果の不透明な範囲。アイコン表示で余白を切り落とすのに使う */
const boundsCache = new Map<string, { x: number; y: number; w: number; h: number }>()

export function sharkBounds(
  mutations: readonly SharkPart[],
  scale = 1,
): { x: number; y: number; w: number; h: number } {
  const key = `${spriteKey(mutations)}@${scale}`
  const hit = boundsCache.get(key)
  if (hit) return hit
  const c = sharkSprite(mutations, scale)
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
  let x0 = c.width,
    y0 = c.height,
    x1 = -1,
    y1 = -1
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] < 8) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  const box =
    x1 < 0 ? { x: 0, y: 0, w: c.width, h: c.height } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
  boundsCache.set(key, box)
  return box
}
