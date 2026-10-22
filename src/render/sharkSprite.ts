import { DERIVED, type DerivedId } from '../game/derived.ts'
import type { MutationId, SharkPart } from '../game/mutations.ts'
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

type Tint = { rgb: RGB; amount: number; weight?: number }

export type Visual = {
  /** clear は尾の置換で base.png を消す幅（本体の左端から）。省略時は尾びれだけ */
  part?: { slot: PartSlot; draw: (ctx: Ctx) => void; clear?: number }
  attach?: (ctx: Ctx) => void
  transform?: { scale?: number; count?: number; tilt?: number; alpha?: number }
  /** 複数渡すと体を等分して塗り分ける（尻尾側から順に） */
  palette?: Tint | readonly Tint[]
  overlay?: (ctx: Ctx) => void
}

const RARITY_PRIORITY = { common: 1, uncommon: 2, rare: 3, legendary: 4 } as const

/** 触手化で下半身を置き換える範囲（本体の左端から）。第二背びれの後ろまで */
const TENTACLE_CUT = 36

/** 部位を取り合ったとき、派生種はどの変異にも勝つ */
const DERIVED_PRIORITY = 5

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
    // 灰色の体に薄く寄せても違いが見えなかったので、青をはっきり乗せる
    palette: { rgb: [60, 145, 235], amount: 0.5 },
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
      // 下半身ごと置き換える。第二背びれ（x27〜33）まで消して、その切り口から触手を生やす
      clear: TENTACLE_CUT,
      draw: (ctx) => {
        const top = trunkTop(TENTACLE_CUT + 2)
        const bottom = bodyBottom(TENTACLE_CUT + 2)
        const n = 7
        // 奥の触手から描く。上下に扇状に広がり、先へ行くほど細く、大きくうねる
        for (const k of [0, 6, 1, 5, 2, 4, 3]) {
          const y0 = top + 2 + ((bottom - top - 4) * (k + 0.5)) / n
          const spread = (k - (n - 1) / 2) * 0.16
          const len = 44 - Math.abs(k - 3) * 3
          const light = k % 2 ? '#b47aa8' : '#9a5f92'
          for (let s = -4; s < len; s++) {
            const t = Math.max(0, s) / len
            const y = y0 + spread * Math.max(0, s) + Math.sin(s * 0.2 + k * 1.1) * (1 + t * 5)
            const thick = Math.max(1, Math.round(5 - t * 4))
            const x = bx(TENTACLE_CUT - s)
            px(ctx, x, y - thick / 2, 1, thick, light)
            px(ctx, x, y + thick / 2, 1, 1, '#6e3f68')
            // 下側の吸盤
            if (s > 2 && s % 4 === 0 && thick >= 2) px(ctx, x, y + thick / 2 - 1, 1, 1, '#f0c8e6')
          }
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
    overlay: (ctx) => {
      // 背から立ち上る炎。根元は白く、先へ行くほど赤くする
      for (let x = 8; x <= 88; x += 5) {
        if (!inBody(x)) continue
        const h = 5 + ((x * 7) % 6)
        const t = trunkTop(x)
        for (let i = 0; i < h; i++) {
          const c = i < 2 ? '#fff3b0' : i < h * 0.6 ? '#ffb347' : '#e0542a'
          const w = i < h * 0.5 ? 3 : i < h * 0.8 ? 2 : 1
          px(ctx, bx(x) + Math.round(Math.sin(i * 0.9 + x) * 1), t - i, w, 1, c)
        }
      }
      // 舞う火の粉
      // prettier-ignore
      for (const [x, y] of [[14, -2], [36, -6], [58, -9], [76, -4], [90, 2], [26, 2]] as const) px(ctx, bx(x), by(y), 1, 1, '#ffd24a')
    },
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
// 派生種の見た目
// ---------------------------------------------------------------------------

/** 半透明で塗る。光・霧・ビームなど */
function faint(ctx: Ctx, alpha: number, draw: () => void): void {
  ctx.save()
  ctx.globalAlpha = alpha
  draw()
  ctx.restore()
}

/** 体表の眼。邪神系で使い回す */
function eye(ctx: Ctx, x: number, y: number, size = 4): void {
  px(ctx, bx(x), by(y), size, size, '#ffe98a')
  px(ctx, bx(x) + 1, by(y) + 1, size - 2, size - 2, '#1a0f24')
}

/**
 * 派生種の見た目（暫定）。専用の絵ができるまで、変異と同じ仕組みで手続き的に描く。
 *
 * 色を保ちたい装飾は overlay に置く。attach は色の塗り分けより前に描かれるので、
 * palette を持つ派生種では体と一緒に色が寄る。
 * 画像を置けば変異と同じく差し替わる（ファイル名は派生種の id。public/sprites/README.md）。
 */
const DERIVED_VISUALS: Record<DerivedId, Visual> = {
  // --- 1 段目 ---
  missile: {
    palette: { rgb: [205, 70, 55], amount: 0.3 },
    attach: (ctx) => {
      // 尾の安定翼。尾びれの付け根の背と腹に生やす
      for (let x = 14; x <= 20; x++) {
        const h = 21 - x
        px(ctx, bx(x), trunkTop(x) - h, 1, h, PALETTE.metal)
        px(ctx, bx(x), bodyBottom(x) + 1, 1, h, PALETTE.metal)
      }
    },
    overlay: (ctx) => {
      // 鼻先の弾頭。口 (y25) の少し上を中心に細らせる
      for (let i = 0; i < 9; i++) {
        const h = 9 - i
        px(ctx, bx(89 + i), by(22) - h / 2, 1, h, i < 6 ? '#d8402e' : '#f2f2f2')
      }
      // 胴を一周する警告帯（黄と黒）
      for (let x = 34; x <= 39; x++) {
        if (!inBody(x)) continue
        for (let y = trunkTop(x); y <= bodyBottom(x); y++) {
          px(ctx, bx(x), y, 1, 1, Math.floor((y + x) / 3) % 2 ? '#1c1c1c' : '#f2c230')
        }
      }
      // 噴射炎
      for (let i = 0; i < 14; i++) {
        const sz = i < 4 ? 6 : i < 9 ? 4 : 2
        const c = i < 3 ? '#ffffff' : i < 7 ? '#9fe8ff' : '#ff9a3c'
        px(ctx, bx(1 - i * 1.3), by(22) - sz / 2 + Math.round(Math.sin(i) * 1), sz, sz, c)
      }
    },
  },
  urchin: {
    palette: { rgb: [80, 45, 105], amount: 0.5 },
    overlay: (ctx) => {
      // 全身から生えた毒の棘。背と腹の両方へ、長さを互い違いにする
      for (let x = 14; x <= 90; x += 4) {
        if (!inBody(x)) continue
        const len = x % 8 ? 6 : 9
        const t = trunkTop(x)
        const b = bodyBottom(x)
        px(ctx, bx(x), t - len, 1, len, '#8a63a8')
        px(ctx, bx(x), t - len - 1, 1, 1, '#c8ff7a')
        px(ctx, bx(x) + 2, b + 1, 1, len - 2, '#8a63a8')
        px(ctx, bx(x) + 2, b + len - 1, 1, 1, '#c8ff7a')
      }
      // 体表の毒腺
      // prettier-ignore
      for (const [x, y] of [[26, 20], [40, 26], [52, 18], [70, 24], [78, 18]] as const) px(ctx, bx(x), by(y), 2, 2, '#c8ff7a')
    },
  },
  fiveHead: {
    part: {
      slot: 'head',
      draw: (ctx) => {
        // 外側から順に貼り、最後に元の位置へ貼り直して真ん中の頭を一番手前に出す
        stampHead(ctx, -2, -20)
        stampHead(ctx, -2, 20)
        stampHead(ctx, 2, -10)
        stampHead(ctx, 2, 10)
        stampHead(ctx, 0, 0)
      },
    },
  },
  matango: {
    palette: { rgb: [140, 135, 100], amount: 0.45 },
    attach: (ctx) => {
      // 胴に開いた穴と、垂れた眼
      // prettier-ignore
      for (const [x, y, w] of [[30, 20, 6], [66, 22, 5]] as const) {
        px(ctx, bx(x), by(y), w, 4, '#2a2f22')
        for (let i = 0; i < w; i += 2) px(ctx, bx(x) + i, by(y) + 1, 1, 2, '#ddd6c0')
      }
      px(ctx, bx(81), by(23), 2, 3, '#e8ff7a')
    },
    overlay: (ctx) => {
      // 背中を覆うキノコ。頭には一番大きな傘を載せる
      // prettier-ignore
      for (const [x, h, cap] of [[20, 4, 6], [28, 7, 9], [38, 5, 7], [44, 9, 11], [70, 6, 8], [84, 8, 13]] as const) {
        if (!inBody(x)) continue
        const t = trunkTop(x)
        const cx = bx(x)
        px(ctx, cx, t - h, 2, h, '#efe4cf')
        px(ctx, cx - Math.floor(cap / 2) + 1, t - h - 3, cap, 3, '#c2493f')
        px(ctx, cx - Math.floor(cap / 2) + 2, t - h - 4, cap - 2, 1, '#e26a5f')
        px(ctx, cx - 1, t - h - 2, 1, 1, '#f9e0dc')
        px(ctx, cx + 2, t - h - 3, 1, 1, '#f9e0dc')
      }
      // 舞う胞子
      for (let i = 0; i < 14; i++) {
        px(ctx, bx(10 + ((i * 23) % 86)), by(-10 + ((i * 7) % 12)), 1, 1, '#e9e2a8')
      }
    },
  },
  phantom: {
    palette: { rgb: [210, 245, 255], amount: 0.8 },
    transform: { alpha: 0.7 },
    overlay: (ctx) => {
      outline(ctx, FRAME_W, FRAME_H, [150, 240, 255], 0.9)
      // 尾から後ろへ流れる霊気
      for (let r = 0; r < 8; r++) {
        const y = by(10 + r * 3.4)
        const len = 12 + ((r * 7) % 12)
        faint(ctx, 0.75 - (r % 3) * 0.15, () => px(ctx, bx(4) - len, y, len, 1, '#bff6ff'))
      }
      // 空洞の光る眼
      px(ctx, bx(80), by(21), 4, 3, '#bff6ff')
      px(ctx, bx(81), by(22), 2, 1, '#ffffff')
    },
  },

  // --- 2 段目 ---
  sharkTornado: {
    palette: { rgb: [150, 165, 180], amount: 0.25 },
    transform: { count: 3, tilt: 0.45 },
    overlay: (ctx) => {
      // 上に広がる漏斗状の渦
      for (let i = 0; i < 10; i++) {
        const y = by(46 - i * 5.6)
        const w = 14 + i * 9
        px(ctx, bx(48) - w / 2, y, w, 1, i % 2 ? '#c4dfee' : '#7fa8c4')
      }
      // 巻き上げられた瓦礫
      // prettier-ignore
      for (const [x, y] of [[4, 2], [90, 6], [14, 34], [84, 30], [50, -6]] as const) px(ctx, bx(x), by(y), 2, 2, '#6b5d4f')
    },
  },
  lantern: {
    palette: { rgb: [28, 22, 58], amount: 0.62 },
    overlay: (ctx) => {
      outline(ctx, FRAME_W, FRAME_H, [100, 80, 210], 0.35)
      // 額から伸びる誘引突起。上へ立ててから口の前へ垂らす
      const t = trunkTop(84)
      px(ctx, bx(84), t - 8, 1, 8, '#6b5a8a')
      px(ctx, bx(84), t - 9, 14, 1, '#6b5a8a')
      px(ctx, bx(98), t - 9, 1, 6, '#6b5a8a')
      // 発光体と光の輪
      faint(ctx, 0.35, () => px(ctx, bx(95), t - 6, 8, 8, '#ffd84a'))
      px(ctx, bx(97), t - 4, 4, 4, '#fff3a0')
      px(ctx, bx(98), t - 3, 1, 1, '#ffffff')
      // 体側に並ぶ発光器
      for (let x = 22; x <= 76; x += 8) px(ctx, bx(x), by(27), 2, 1, '#7fe8ff')
      // 光る眼
      px(ctx, bx(81), by(22), 2, 2, '#7fe8ff')
    },
  },
  railgun: {
    palette: { rgb: [140, 150, 165], amount: 0.6 },
    attach: (ctx) => {
      // 体のシルエットの上にだけ装甲パネルを貼る（ひれの形はそのまま残る）
      ctx.save()
      ctx.globalCompositeOperation = 'source-atop'
      px(ctx, bx(0), by(0), BODY_W, BODY_H, PALETTE.metal)
      for (let x = 6; x < BODY_W; x += 10) px(ctx, bx(x), by(0), 1, BODY_H, PALETTE.metalDark)
      px(ctx, bx(0), by(22), BODY_W, 1, PALETTE.metalDark)
      for (let x = 10; x < BODY_W; x += 10) {
        px(ctx, bx(x), by(16), 1, 1, '#c9d1d8')
        px(ctx, bx(x), by(28), 1, 1, '#c9d1d8')
      }
      // 背の明るい縁と、顎の装甲
      for (let x = 4; x < BODY_W; x++) if (inBody(x)) px(ctx, bx(x), bodyTop(x), 1, 1, '#c9d1d8')
      px(ctx, bx(84), by(25), 12, 3, PALETTE.metalDark)
      ctx.restore()
    },
    overlay: (ctx) => {
      // 赤いバイザーの目
      px(ctx, bx(77), by(20), 8, 3, '#2a1010')
      px(ctx, bx(78), by(21), 6, 1, '#ff3b2f')
      // 背のエネルギーセルと、胴の排気口
      for (const x of [20, 32, 70]) {
        const t = trunkTop(x)
        px(ctx, bx(x), t - 4, 6, 4, PALETTE.metalDark)
        px(ctx, bx(x) + 1, t - 3, 4, 2, '#8ff0ff')
      }
      for (const x of [40, 44, 48]) px(ctx, bx(x), by(30), 2, 3, '#2b2f33')
      // 背と腹に沿う 2 本のレール。支柱で体に固定する
      const top = by(-3)
      const bottom = by(45)
      for (const y of [top, bottom]) {
        px(ctx, bx(18), y, 88, 2, PALETTE.metal)
        px(ctx, bx(18), y + 2, 88, 1, PALETTE.metalDark)
      }
      for (const x of [26, 40, 72]) {
        px(ctx, bx(x), top + 2, 1, trunkTop(x) - top - 2, PALETTE.metalDark)
        px(ctx, bx(x), bodyBottom(x), 1, bottom - bodyBottom(x), PALETTE.metalDark)
      }
      // レールの間を走る放電
      for (let i = 0; i < 9; i++) {
        const x = bx(96 + (i % 2) * 3)
        px(ctx, x, top + 3 + i * 5.2, 2, 3, i % 3 ? '#8ff0ff' : '#ffffff')
      }
      // 砲口の閃光
      px(ctx, bx(106), by(19), 4, 6, '#8ff0ff')
      px(ctx, bx(107), by(20), 2, 4, '#ffffff')
    },
  },
  heatShock: {
    // 尻尾側が溶岩、頭側が氷。塗り分けで体を半分ずつにする
    palette: [
      { rgb: [220, 90, 30], amount: 0.55 },
      { rgb: [190, 230, 255], amount: 0.55 },
    ],
    overlay: (ctx) => {
      // 後ろ半分に走る溶岩の亀裂
      // prettier-ignore
      for (const [x, y] of [[18, 20], [26, 24], [34, 19], [40, 26]] as const) {
        for (let i = 0; i < 5; i++) px(ctx, bx(x + i), by(y + (i % 2 ? 1 : -1)), 1, 1, i % 2 ? '#ffd24a' : '#ff7a1c')
      }
      // 前半分を覆う氷塊
      // prettier-ignore
      for (const [x, y, sz] of [[56, 16, 6], [66, 24, 7], [76, 17, 5], [84, 25, 4]] as const) {
        px(ctx, bx(x), by(y), sz, sz, '#dff2ff')
        px(ctx, bx(x) + 1, by(y) + 1, 2, 2, '#ffffff')
      }
      // 境目から立つ蒸気
      for (let i = 0; i < 8; i++) {
        faint(ctx, 0.6, () => px(ctx, bx(44 + (i % 3) * 3), trunkTop(47) - 3 - i * 2, 3, 2, '#f0f0f0'))
      }
    },
  },
  soaring: {
    palette: { rgb: [205, 225, 250], amount: 0.3 },
    transform: { tilt: -0.22 },
    overlay: (ctx) => {
      // 背から後ろへ反った翼。奥の翼を暗く、手前を明るく 2 枚重ねる。
      // 3 段ごとに後縁を伸ばして羽根の先に見せる
      // 背びれの上（x48〜64）は trunkTop がひれの先を返すので、手前の背から高さを取る
      const root = trunkTop(42) + 1
      for (const [dx, h, light, dark] of [
        [6, 12, '#c9d6e4', '#9aabbd'],
        [0, 16, '#ffffff', '#c4d2e0'],
      ] as const) {
        for (let r = 0; r < h; r++) {
          const left = bx(42 + dx - r * 1.2 - (r % 3 === 2 ? 4 : 0))
          const right = bx(62 + dx - r * 0.4)
          px(ctx, left, root - r, right - left, 1, r % 3 === 2 ? dark : light)
        }
      }
      // 吹き付ける風
      for (let i = 0; i < 6; i++) px(ctx, bx(-12 + (i % 3) * 6), by(4 + i * 6), 18, 1, '#dbe9f3')
    },
  },

  // --- 3 段目 ---
  megalodon: {
    palette: { rgb: [95, 100, 112], amount: 0.42 },
    transform: { scale: 1.6 },
    attach: (ctx) => {
      // 古傷
      // prettier-ignore
      for (const [x, y] of [[28, 18], [42, 22], [64, 17]] as const) {
        for (let i = 0; i < 5; i++) px(ctx, bx(x + i), by(y + i), 1, 1, '#c9c2b0')
      }
    },
    overlay: (ctx) => {
      // 大きく開いた顎と、上下に並ぶ牙
      px(ctx, bx(80), by(23), 16, 8, '#3a1414')
      for (let i = 0; i < 7; i++) {
        px(ctx, bx(81 + i * 2), by(23), 1, 3, '#ffffff')
        px(ctx, bx(82 + i * 2), by(28), 1, 3, '#ffffff')
      }
      // 背の骨質の隆起
      for (const x of BACK_XS) {
        if (!inBody(x)) continue
        px(ctx, bx(x) - 1, trunkTop(x) - 3, 4, 4, '#e6dcc0')
      }
      // 赤い眼
      px(ctx, bx(80), by(20), 2, 2, '#ff3b2f')
    },
  },
  fortress: {
    palette: { rgb: [150, 158, 166], amount: 0.55 },
    attach: (ctx) => {
      // 背を隙間なく覆う装甲板
      for (let x = 16; x <= 88; x++) {
        if (!inBody(x) || onDorsal(x)) continue
        const t = trunkTop(x)
        px(ctx, bx(x), t, 1, 6, x % 8 === 0 ? PALETTE.metalDark : PALETTE.metal)
      }
    },
    overlay: (ctx) => {
      // 3 基の砲塔
      for (const x of [24, 36, 72]) {
        const t = trunkTop(x)
        px(ctx, bx(x) - 3, t - 5, 8, 5, PALETTE.metal)
        px(ctx, bx(x) - 3, t - 5, 8, 1, '#c9d1d8')
        px(ctx, bx(x) + 5, t - 4, 7, 2, PALETTE.metalDark)
        px(ctx, bx(x), t - 7, 2, 2, '#ff4d4d')
      }
      // 腹の履帯
      for (let x = 18; x <= 80; x++) {
        if (!inBody(x)) continue
        const b = bodyBottom(x)
        px(ctx, bx(x), b - 1, 1, 5, '#2b2f33')
        if (x % 6 === 0) px(ctx, bx(x), b + 1, 2, 2, '#7a838c')
      }
    },
  },
  invader: {
    palette: { rgb: [80, 230, 120], amount: 0.4 },
    overlay: (ctx) => {
      // 牽引ビーム
      faint(ctx, 0.3, () => {
        for (let r = 0; r < 24; r++) px(ctx, bx(40 - r * 0.8), by(30 + r), 16 + r * 1.6, 1, '#c8ff6a')
      })
      // 胴を貫く円盤。中心 (48, 24) の楕円
      for (let x = -6; x <= 102; x++) {
        const k = (x - 48) / 54
        const h = Math.round(4 * Math.sqrt(Math.max(0, 1 - k * k)))
        if (h <= 0) continue
        px(ctx, bx(x), by(24) - h, 1, h * 2, PALETTE.metal)
        px(ctx, bx(x), by(24) - h, 1, 1, '#d6dde3')
      }
      for (let i = 0; i < 12; i++) {
        px(ctx, bx(2 + i * 8), by(24), 2, 1, ['#ff4d4d', '#ffe14d', '#4dd2ff'][i % 3])
      }
      // 頭の触角と単眼
      const t = trunkTop(80)
      px(ctx, bx(82), t - 9, 2, 9, '#c8ffd8')
      px(ctx, bx(80), t - 13, 6, 5, '#e8ff6a')
      px(ctx, bx(78), by(17), 7, 6, '#111820')
      px(ctx, bx(80), by(19), 3, 3, '#c8ff6a')
    },
  },
  megaquake: {
    palette: { rgb: [50, 80, 130], amount: 0.5 },
    transform: { scale: 1.4 },
    overlay: (ctx) => {
      // 背に立つ波頭
      for (let x = 4; x <= 92; x += 2) {
        if (!inBody(x)) continue
        const y = trunkTop(x) - 4 - Math.round(Math.abs(Math.sin(x * 0.18)) * 4)
        px(ctx, bx(x), y, 2, 2, x % 6 ? '#7fd4ff' : '#ffffff')
      }
      // 体を走る地割れ
      // prettier-ignore
      for (const [x, y] of [[24, 18], [44, 22], [66, 19]] as const) {
        for (let i = 0; i < 8; i++) px(ctx, bx(x + i), by(y + (i % 3) - 1), 1, 1, i % 2 ? '#1a2638' : '#ffb347')
      }
      // 前後に広がる衝撃波
      for (const [x0, dir] of [
        [-4, -1],
        [100, 1],
      ] as const) {
        for (let k = 0; k < 3; k++) {
          for (let y = 10 + k * 2; y <= 34 - k * 2; y++) px(ctx, bx(x0 + dir * k * 4), by(y), 1, 1, '#dbe9f3')
        }
      }
    },
  },
  starSpawn: {
    palette: { rgb: [40, 20, 70], amount: 0.62 },
    overlay: (ctx) => {
      outline(ctx, FRAME_W, FRAME_H, [170, 110, 255], 0.45)
      // 体表の星空
      for (let i = 0; i < 36; i++) {
        const x = 16 + ((i * 17) % 76)
        if (!inBody(x)) continue
        const t = bodyTop(x)
        const b = bodyBottom(x)
        px(ctx, bx(x), t + 2 + ((i * 11) % Math.max(2, b - t - 4)), 1, 1, i % 4 ? '#ffffff' : '#9fd0ff')
      }
      // 増えた眼
      // prettier-ignore
      for (const [x, y] of [[30, 20], [42, 25], [68, 19], [74, 26]] as const) eye(ctx, x, y)
      // 顎から垂れる触手
      for (let k = 0; k < 4; k++) {
        const len = 12 + (k % 2) * 6
        for (let i = 0; i < len; i++) {
          const x = bx(78 + k * 4) + Math.round(Math.sin(i * 0.5 + k * 1.7) * 2)
          px(ctx, x, by(29 + i), i < len - 4 ? 2 : 1, 1, k % 2 ? '#9a6cc8' : '#b98ae0')
        }
      }
      // 周囲に散る星
      // prettier-ignore
      for (const [x, y] of [[-8, -6], [20, -10], [60, -12], [100, -4], [-10, 40], [104, 38]] as const) px(ctx, bx(x), by(y), 1, 1, '#ffffff')
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
 * 尾を置換する変異（触手化）は最後に描く。消す範囲に載った胴の置換や追加部位
 * （装甲板・棘など）ごと消してから描かないと、消えた下半身の上に浮いて残るため。
 */
const TAIL_W = 13 // base.png の尾びれが占める幅（付け根の手前まで）

function drawOne(
  g: Ctx,
  parts: Map<PartSlot, { id: string; part: NonNullable<Visual['part']> }>,
  attaches: Array<{ id: string; draw: (c: Ctx) => void }>,
): void {
  const tail = parts.get('tail')
  const body = parts.get('body')
  const head = parts.get('head')
  const hasBase = asset('base') !== null

  if (hasBase) {
    // base.png だけは 96×44 なので、枠の中の本体位置に置く。
    // 他のレイヤーは枠と同じ 128×72 なので (0,0) でよい。
    g.drawImage(asset('base')!, BODY_X, BODY_Y)
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

  if (hasBase && tail) {
    // 背の上に生えた装飾も消えるよう、枠の高さいっぱいに消す
    g.clearRect(BODY_X, 0, tail.part.clear ?? TAIL_W, FRAME_H)
    drawLayer(g, `part/tail/${tail.id}`, tail.part.draw)
  }
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

/** 合成に載せる 1 枚ぶん。id は画像のファイル名にもなる */
type Layer = { id: string; visual: Visual; priority: number; derived: boolean }

/**
 * 組み合わせを、合成に載せる見た目の並びに読み替える。
 *
 * 派生種はほかの変異と混ぜて描く（名前が「発光ミサイルシャーク」なら光らせる）。
 * ただし派生種の特色は必ず見えるようにする:
 *  - 材料の変異は派生種に吸収されたものとして描かない
 *  - 派生種は並びの最後に置く。部位・装飾・エフェクトが一番上に重なり、塗り分けでは頭側に来る
 *  - 部位の取り合いでは派生種が必ず勝つ（DERIVED_PRIORITY）
 *  - 塗り分けでは派生種の色が体の半分以上を取る（sharkSprite の weight）
 * 変異同士の順番は定義順にそろえる（部位の取り合いや塗り分けの順が渡し方に左右されないように）。
 */
function layersOf(mutations: readonly SharkPart[]): Layer[] {
  const derived = DERIVED.filter((d) => mutations.includes(d))
  const absorbed = new Set<MutationId>(derived.flatMap((d) => d.materials))
  const base = MUTATIONS.filter((m) => mutations.includes(m) && !absorbed.has(m.id)).flatMap((m) => {
    const v = VISUALS[m.id]
    return v ? [{ id: m.id as string, visual: v, priority: RARITY_PRIORITY[m.rarity], derived: false }] : []
  })
  return [
    ...base,
    ...derived.map((d) => ({
      id: d.id,
      visual: DERIVED_VISUALS[d.id],
      priority: DERIVED_PRIORITY,
      derived: true,
    })),
  ]
}

/**
 * 変異の組み合わせからスプライトを作る。結果は組み合わせ単位でキャッシュする。
 * scale は論理ピクセル 1 つを何 px で描くか。
 */
export function sharkSprite(mutations: readonly SharkPart[], scale = 1): HTMLCanvasElement {
  const key = `${spriteKey(mutations)}@${scale}`
  const hit = cache.get(key)
  if (hit) return hit

  // --- チャンネルごとに集約 ---
  const parts = new Map<PartSlot, { id: string; part: NonNullable<Visual['part']> }>()
  const partPriority = new Map<PartSlot, number>()
  const attaches: Array<{ id: string; draw: (c: Ctx) => void }> = []
  const palettes: Tint[] = []
  const derivedPalettes: Tint[] = []
  const overlays: Array<{ id: string; draw: (c: Ctx) => void }> = []
  let scaleMult = 1
  let count = 1
  let tilt = 0
  let alpha = 1

  for (const { id, visual: v, priority, derived } of layersOf(mutations)) {
    if (v.part) {
      // 同じスロットを取り合ったらレア度が高い方が勝つ
      if ((partPriority.get(v.part.slot) ?? -1) < priority) {
        parts.set(v.part.slot, { id, part: v.part })
        partPriority.set(v.part.slot, priority)
      }
    }
    if (v.attach) attaches.push({ id, draw: v.attach })
    if (v.palette) {
      const tints = Array.isArray(v.palette) ? v.palette : [v.palette as Tint]
      ;(derived ? derivedPalettes : palettes).push(...tints)
    }
    if (v.overlay) overlays.push({ id, draw: v.overlay })
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
  // 色を変える変異が複数あるときは、混ぜずに体を等分して塗り分ける。
  // 派生種の色は頭側に置き、ほかの色が何色あっても合わせて体の半分以上を取る
  const share = Math.max(1, palettes.length / Math.max(1, derivedPalettes.length))
  const bands = [...palettes, ...derivedPalettes.map((p) => ({ ...p, weight: share }))]
  tintBands(ug, FRAME_W, FRAME_H, bands, BODY_X, BODY_X + BODY_W)
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

/**
 * 大きさの倍率（巨大化・メガロドンなど）。UI のアイコンはふつう高さを揃えて縮めるので、
 * これを掛けないと巨大化しても同じ大きさに見える。
 */
export function sharkSize(mutations: readonly SharkPart[]): number {
  let m = 1
  for (const { visual } of layersOf(mutations)) m *= visual.transform?.scale ?? 1
  return m
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
