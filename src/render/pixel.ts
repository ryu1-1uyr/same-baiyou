/**
 * ドット絵を手続きで描くための最小限のヘルパー。
 *
 * ここで描いているのは、合成システムが機能するかを確かめるための仮の絵。
 * 本番のドット絵ができたら、各レイヤーの draw を drawImage に差し替えるだけで済む
 * （インターフェースは変えない）。
 */

export type RGB = [number, number, number]

export const PALETTE = {
  body: '#7d90a6',
  belly: '#c3d0de',
  shade: '#5b6c80',
  fin: '#64768a',
  eye: '#111820',
  mouth: '#2a3542',
  metal: '#9aa4ad',
  metalDark: '#5d666e',
  accent: '#ffd479',
}

/**
 * サメ 1 体を描く論理キャンバスの大きさ。
 * 本体は 96×44（base.png の解像度）で、棘・砲塔・オーラなどが
 * はみ出せるよう四方に余白を取ってある。
 */
export const FRAME_W = 128
export const FRAME_H = 72
/** 本体（96×44）の左上位置 */
export const BODY_X = 16
export const BODY_Y = 14
export const BODY_W = 96
export const BODY_H = 44
/** 体の中心線 */
export const MID_Y = BODY_Y + 22

export function px(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  ctx.fillStyle = color
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)))
}

/**
 * 体の縦半径（仮の絵を描くときの輪郭）。右（x が大きい方）が頭。
 *
 * base.png が読み込まれている場合は、そちらの実シルエットが優先される
 * （silhouette.ts / bodyTop・bodyBottom を参照）。
 * これは画像が無いときのフォールバック。
 */
export function fallbackHalf(i: number): number {
  if (i < 8) return 0
  const t = Math.min(1, (i - 8) / 86)
  const base = Math.sin(Math.PI * Math.pow(t, 0.85))
  const taper = t > 0.86 ? 1 - (t - 0.86) / 0.15 : 1
  return Math.max(0, Math.round((2 + base * 15) * Math.max(0, taper)))
}

/** 体の輪郭を塗る。色を差し替えれば機械化などの部分置換に使える */
export function drawBody(
  ctx: CanvasRenderingContext2D,
  opts: { from?: number; to?: number; body?: string; belly?: string } = {},
): void {
  const from = opts.from ?? 0
  const to = opts.to ?? BODY_W
  for (let i = from; i < to; i++) {
    const h = fallbackHalf(i)
    if (h <= 0) continue
    const x = BODY_X + i
    px(ctx, x, MID_Y - h, 1, h * 2, opts.body ?? PALETTE.body)
    // 腹側を明るく
    px(
      ctx,
      x,
      MID_Y + h - Math.max(1, Math.floor(h * 0.45)),
      1,
      Math.max(1, Math.floor(h * 0.45)),
      opts.belly ?? PALETTE.belly,
    )
  }
}

/** 三角のヒレ */
export function drawFin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  dir: -1 | 1,
  color = PALETTE.fin,
): void {
  for (let i = 0; i < w; i++) {
    const t = i / w
    const len = Math.round(h * (1 - t))
    if (len <= 0) continue
    px(ctx, x + i, dir < 0 ? y - len : y, 1, len, color)
  }
}

/** 尾びれ（三日月） */
export function drawTail(ctx: CanvasRenderingContext2D, color = PALETTE.fin): void {
  const x = BODY_X
  for (let i = 0; i < 12; i++) {
    const len = 5 + i * 2.2
    px(ctx, x + i - 10, MID_Y - len, 1, len, color)
    px(ctx, x + i - 10, MID_Y, 1, len * 0.75, color)
  }
}

/**
 * 体を長さ方向に等分し、区画ごとに別の色へ寄せる。
 *
 * 色を変える変異が複数付いたとき、順番に混ぜると後から来た色が前の色を潰して
 * 「氷と炎を両方持つと氷になる」ような挙動になってしまう。
 * 等分して塗り分ければ、**何色持っているかが見た目から数えられる**。
 *
 * 区画の並びは変異の定義順。サメは右を向いているので、
 * 名前の接頭辞の並び（左から）と体の並び（尻尾から頭へ）が一致する。
 *
 * weight を持つ区画はそのぶん広く取る（省略時は 1）。
 */
export function tintBands(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bands: Array<{ rgb: RGB; amount: number; weight?: number }>,
  x0: number,
  x1: number,
): void {
  if (bands.length === 0) return
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const span = Math.max(1, x1 - x0)
  // 区画の右端を 0〜1 の累積で持つ
  const total = bands.reduce((a, b) => a + (b.weight ?? 1), 0)
  const ends: number[] = []
  let acc = 0
  for (const b of bands) {
    acc += (b.weight ?? 1) / total
    ends.push(acc)
  }
  const bandAt = (t: number) => {
    for (let k = 0; k < ends.length; k++) if (t < ends[k]) return bands[k]
    return bands[bands.length - 1]
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (d[i + 3] === 0) continue
      const b = bandAt((x - x0) / span)
      d[i] += (b.rgb[0] - d[i]) * b.amount
      d[i + 1] += (b.rgb[1] - d[i + 1]) * b.amount
      d[i + 2] += (b.rgb[2] - d[i + 2]) * b.amount
    }
  }
  ctx.putImageData(img, 0, 0)
}

/** 画素単位で色味を寄せる。パレット変化の合成に使う */
export function tint(ctx: CanvasRenderingContext2D, w: number, h: number, rgb: RGB, amount: number): void {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    d[i] = d[i] + (rgb[0] - d[i]) * amount
    d[i + 1] = d[i + 1] + (rgb[1] - d[i + 1]) * amount
    d[i + 2] = d[i + 2] + (rgb[2] - d[i + 2]) * amount
  }
  ctx.putImageData(img, 0, 0)
}

/** 不透明な画素の外周に色を足す（発光やオーラ用） */
export function outline(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: RGB,
  alpha: number,
): void {
  const img = ctx.getImageData(0, 0, w, h)
  const src = img.data
  const out = ctx.createImageData(w, h)
  const dst = out.data
  dst.set(src)
  const at = (x: number, y: number) => (y * w + x) * 4
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = at(x, y)
      if (src[i + 3] !== 0) continue
      let near = false
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        if (src[at(nx, ny) + 3] > 0) {
          near = true
          break
        }
      }
      if (!near) continue
      dst[i] = color[0]
      dst[i + 1] = color[1]
      dst[i + 2] = color[2]
      dst[i + 3] = Math.round(255 * alpha)
    }
  }
  ctx.putImageData(out, 0, 0)
}
