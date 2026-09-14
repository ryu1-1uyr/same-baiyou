import { useEffect, useRef } from 'react'
import { sortedByPower, totalSharks } from '../../game/inventory.ts'
import { cachedPower, type MutationDef, mutationsOfMask } from '../../game/mutations.ts'
import { pixelIcon } from '../../render/icons.ts'
import { sharkSprite } from '../../render/sharkSprite.ts'
import { getConfig, getSpeed, getState } from '../../store/gameStore.ts'
import { t } from '../../text/index.ts'

/**
 * 突撃ビュワー。
 *
 * ゲームの計算には一切関与しない「見せるだけ」の層。
 * 投入されたサメを 1:1 で描くが、同時に出せる数には上限を置く。
 * 上限を超えたぶんは 1 匹に束ね、束ねた数に応じて**大きく**描く。
 *
 * 描画を canvas にしているのは 2 つの理由による。
 *  1. 数百体を DOM で持つと重い
 *  2. グラフィックをドット絵にする方針が決まっており、
 *     canvas なら imageSmoothingEnabled = false でそのまま等倍拡大できる
 *
 * スプライトはいま絵文字をオフスクリーンに焼いて drawImage しているだけなので、
 * 画像を差し替えるときは SPRITE_SOURCE の中身を PNG のロードに変えれば
 * 描画側のコードは変わらない。
 */

/**
 * 同時に描くサメの上限。
 *
 * 恒久強化を積むと投入速度は 9 万体/秒を超える。1:1 で描くとフレームが落ちる。
 * ビュワーはおよそ 500x120 なので、サメ 1 体（34x20）で埋め尽くすのに 90 体ほど。
 * 1200 体なら画面 13 面ぶんの密度で、数えられない濁流として十分に見える。
 * 実測でこの上限なら 0.5 ms/フレーム、3000 体でも 1.3 ms しかかからないが、
 * それ以上並べても見た目が変わらないので描かない。
 */
const MAX_PARTICLES = 1200
/** 1 フレームに湧かせる上限。取りこぼした分は捨てる（溜めても描けない） */
const MAX_SPAWN_PER_FRAME = 120
const GRAVITY = 1100

/** 等倍のサメの高さ */
const SHARK_H = 20

/**
 * 階層ごとに、1 秒あたり何匹を湧かせるか。大きい順。
 *
 * 束ねた数だけ大きく描くが、**全部を同じ大きさにすると比較対象が消えて
 * 大きさが伝わらない**。等倍のサメと巨体を同じ画面に混ぜる。
 *
 * 湧かせる数は投入速度によらず固定で、投入速度は「1 匹が何匹ぶんか」に吸わせる。
 * これで画面の密度が最後まで一定に保たれる。
 */
const TIER_SPAWN = [0.4, 1.2, 3, 9]

/**
 * 等倍のサメを 1 秒あたり何匹湧かせるか。
 *
 * 投入速度がいくら伸びてもこの階層だけは等倍のまま残す。
 * 全部が大きくなると比べる相手がいなくなって、大きさが伝わらなくなる。
 */
const PLAIN_SPAWN = 80

/** 束ねる意味が出る最小の数。これを下回る階層は使わない */
const MIN_BUNDLE = 2

/**
 * 大きさの上限は、そのときのビュワーの高さから決める。
 * PC で 132px、モバイルの横画面で 84px と高さが変わるため、
 * 定数で持つと片方でサメがはみ出すか、小さすぎるかのどちらかになる。
 */
function maxScaleFor(height: number): number {
  return Math.max(2, (height - 22) / SHARK_H)
}

/** 動きの遅さの効き方と下限。遅すぎると投入に追いつかず、画面が実態から離れる */
const MOTION_EXP = 0.7
const MIN_MOTION = 0.35

/** 束ねた数に対する大きさ。100 匹で 2 倍、1000 匹で 3 倍、10000 匹で 4 倍 */
function sharkScale(bundle: number, maxScale: number): number {
  return Math.min(maxScale, Math.max(1, Math.log10(bundle)))
}

/** 大きいほどゆっくり動く。同じ px/秒 だと巨体ほど軽く見えてしまう */
function motionOf(scale: number): number {
  return Math.max(MIN_MOTION, 1 / Math.pow(scale, MOTION_EXP))
}

type Tier = { bundle: number; scale: number; spawn: number }

/**
 * その投入速度をどう階層に割り振るか。
 *
 * 湧かせる数は階層ごとに固定で、投入速度は「1 匹が何匹ぶんか」に吸わせる。
 * これで画面の密度が最後まで一定に保たれる。
 * 一番大きい階層の束ね数 `top` は、TIER_SPAWN と等倍の階層で湧かせたときに
 * ちょうど投入速度ぶんを表せるように決める。
 * 階層が下がるごとに束ね数は 1/10 になり、大きさは 1 段小さくなる。
 */
function tiersFor(rate: number, maxScale: number): Tier[] {
  if (rate <= 0) return []
  const plain: Tier = { bundle: 1, scale: 1, spawn: Math.min(rate, PLAIN_SPAWN) }
  if (rate <= PLAIN_SPAWN) return [plain]

  let k = 0
  for (let i = 0; i < TIER_SPAWN.length; i++) k += TIER_SPAWN[i] / Math.pow(10, i)
  const top = (rate - PLAIN_SPAWN) / k

  const out: Tier[] = []
  for (let i = 0; i < TIER_SPAWN.length; i++) {
    const bundle = top / Math.pow(10, i)
    if (bundle < MIN_BUNDLE) break
    out.push({ bundle, scale: sharkScale(bundle, maxScale), spawn: TIER_SPAWN[i] })
  }
  out.push(plain)
  return out
}

/**
 * その階層のサメがどの見た目になるか。
 *
 * 大きい階層ほど戦闘力の高い側から引く。束ねた中の代表として不自然ではないし、
 * 「大きいサメほど珍しい」という読み方ができる。
 */
function pickMask(palette: Shark[], tier: number, tierCount: number): Shark {
  if (palette.length === 0) return PLAIN
  const band = 1 / Math.max(1, tierCount)
  const lo = (Math.max(1, tierCount) - 1 - tier) * band
  const frac = lo + Math.random() * band
  return palette[Math.min(palette.length - 1, Math.floor(frac * palette.length))]
}

/** 流すサメ 1 体の見た目。ランをまたいでも崩れないよう、mask ではなく変異の並びで持つ */
type Shark = readonly MutationDef[]
const PLAIN: Shark = []

type P = {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vrot: number
  alpha: number
  bounced: boolean
  mutations: Shark
  /** 束ねた数に応じた大きさ。湧いた時点の値を保つ */
  scale: number
}

/** 画面に流す見た目の候補数 */
const PALETTE_SIZE = 16

/**
 * 見た目を選ぶときの、頭数への重みの掛け方。
 *
 * 頭数そのままで選ぶと通常サメが 16 枠中 9 枠を占めて、
 * 実際には変異した個体も大量に出撃しているのに画面がほぼ通常サメになる。
 * 平方根で潰すと 15 種まで散る。4 乗根まで潰すと今度は通常サメが消えて、
 * 「ありふれた個体」という基準が無くなる。
 */
const PALETTE_WEIGHT_EXP = 0.5

/**
 * いま出撃している個体の見た目を、**構成比で**選ぶ。
 *
 * 以前は「最も弱い個体」1 種だけを使っていたので、実際には
 * 変異した個体も大量に出撃しているのに通常サメしか流れなかった。
 *
 * 引く先は在庫と出現分布の 2 つ。
 * 投入が生産を上回っている（＝終盤の通常の状態）と在庫は毎ティック空になり、
 * 在庫だけを見ていると **通常サメ 1 種に潰れる**。
 * そのときは「いま生まれている構成」である出現分布から引く。
 * 出撃しているのはまさにその瞬間に生まれた個体なので、実態とも合う。
 *
 * 戻り値は戦闘力の昇順。湧かせる側が、大きい階層ほど後ろ（強い側）から
 * 引くことで、大きいサメほど珍しい見た目になる。
 */
function launchingPalette(): Shark[] {
  const s = getState()
  const cfg = getConfig()

  const rows =
    totalSharks(s.inv) > 0
      ? sortedByPower(s.inv, s.slots, s.ranks, cfg, s.powerCache).map((r) => ({
          mask: r.mask,
          weight: r.count,
        }))
      : s.birthDist
          .map(([mask, p]) => ({
            mask,
            weight: p,
            power: cachedPower(s.slots, mask, s.ranks, cfg, s.powerCache),
          }))
          .sort((a, b) => a.power - b.power)
  if (rows.length === 0) return [PLAIN]

  const weights = rows.map((r) => Math.pow(r.weight, PALETTE_WEIGHT_EXP))
  let sum = 0
  for (const w of weights) sum += w
  if (sum <= 0) return [PLAIN]

  const out: Shark[] = []
  let acc = 0
  let i = 0
  for (let k = 0; k < PALETTE_SIZE; k++) {
    // 累積した重みを等間隔に切ると、構成比の大きい種ほど多く選ばれる
    const target = (sum * (k + 0.5)) / PALETTE_SIZE
    while (i < rows.length - 1 && acc + weights[i] < target) {
      acc += weights[i]
      i++
    }
    out.push(mutationsOfMask(s.slots, rows[i].mask))
  }
  return out
}

export function InvasionViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = 0
    let h = 0
    let dpr = 1
    const resize = () => {
      const r = canvas.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = r.width
      h = r.height
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // ドット絵を等倍拡大したときにボケさせない
      ctx.imageSmoothingEnabled = false
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const parts: P[] = []
    // 階層ごとの湧かせ残り
    const accs = TIER_SPAWN.map(() => 0).concat(0)

    let last = performance.now()
    let flash = 0
    let palette: Shark[] = [PLAIN]
    let keyAge = 0
    let raf = 0

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now

      const s = getState()
      const ground = h - 10
      const hitX = w - 46
      const buildingH = Math.min(h - 16, 92)

      // --- 出撃サメの見た目は 200ms ごとに選び直す（毎体引くと重い） ---
      keyAge += dt
      if (keyAge > 0.2) {
        keyAge = 0
        palette = launchingPalette()
      }

      // --- 湧かせる ---
      // 階層ごとに、決まった数だけ湧かせる。投入速度は「1 匹が何匹ぶんか」に吸わせる
      if (s.phase === 'invasion' && !s.pendingDraft) {
        // 名目の投入速度ではなく、実際に出撃した数で描く。
        // 在庫が尽きているときに居ないサメを流さないため
        const tiers = tiersFor(s.launchedPerSec * getSpeed(), maxScaleFor(h))
        for (let i = 0; i < accs.length; i++) {
          const tier = tiers[i]
          if (!tier) {
            accs[i] = 0
            continue
          }
          const bodyH = SHARK_H * tier.scale
          accs[i] = Math.min(accs[i] + dt * tier.spawn, MAX_SPAWN_PER_FRAME)
          while (accs[i] >= 1) {
            accs[i] -= 1
            if (parts.length >= MAX_PARTICLES) {
              accs[i] = 0
              break
            }
            parts.push({
              x: -14,
              y: bodyH / 2 + Math.random() * Math.max(10, ground - bodyH),
              vx: 240 + Math.random() * 160,
              vy: (Math.random() - 0.5) * 26,
              rot: 0,
              vrot: 0,
              alpha: 1,
              bounced: false,
              mutations: pickMask(palette, i, tiers.length),
              scale: tier.scale,
            })
          }
        }
      } else {
        accs.fill(0)
      }

      // --- 更新 ---
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]
        // 大きい個体ほど動きを落とす。等速だと巨体ほど軽く見えてしまう
        const mdt = dt * motionOf(p.scale)
        if (!p.bounced) {
          p.x += p.vx * mdt
          p.y += p.vy * mdt
          if (p.x >= hitX) {
            // 建物にぶつかって跳ね返る
            p.bounced = true
            p.x = hitX
            p.vx = -(70 + Math.random() * 150)
            p.vy = -(130 + Math.random() * 190)
            p.vrot = (Math.random() - 0.5) * 14
            flash = 0.11
          }
        } else {
          p.vy += GRAVITY * mdt
          p.x += p.vx * mdt
          p.y += p.vy * mdt
          p.rot += p.vrot * mdt
          p.alpha -= mdt * 1.25
        }
        if (p.alpha <= 0 || p.y > ground + 24 + SHARK_H * p.scale) parts.splice(i, 1)
      }
      if (flash > 0) flash -= dt

      // --- 描画 ---
      ctx.clearRect(0, 0, w, h)

      ctx.globalAlpha = 0.5
      ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--viewer-ground') || '#1e2f45'
      ctx.fillRect(0, ground, w, h - ground)
      ctx.globalAlpha = 1

      // 建物
      const bImg = pixelIcon(s.onBoss ? 'target:boss' : 'target:normal')
      if (bImg) {
        const bH = buildingH
        const bW = (bImg.width / bImg.height) * bH
        const bx0 = w - bW - 10
        const by0 = ground - bH
        if (flash > 0) {
          ctx.save()
          ctx.globalAlpha = Math.min(1, flash * 6)
          ctx.filter = 'brightness(2.6)'
          ctx.drawImage(bImg, bx0, by0, bW, bH)
          ctx.restore()
        }
        ctx.drawImage(bImg, bx0, by0, bW, bH)
      }

      // サメ
      for (const p of parts) {
        const img = sharkSprite(p.mutations, 1)
        const sH = SHARK_H * p.scale
        const w = (img.width / img.height) * sH
        if (p.bounced) {
          ctx.save()
          ctx.globalAlpha = Math.max(0, p.alpha)
          ctx.translate(p.x, p.y)
          ctx.rotate(p.rot)
          ctx.drawImage(img, -w / 2, -sH / 2, w, sH)
          ctx.restore()
        } else {
          ctx.drawImage(img, p.x - w / 2, p.y - sH / 2, w, sH)
        }
      }

      raf = requestAnimationFrame(loop)
    }

    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  const s = getState()
  const empty = totalSharks(s.inv) < 1

  return (
    <div className="viewer">
      <canvas className="viewer-canvas" ref={canvasRef} />
      {empty && <div className="viewer-empty">{t.invasion.viewerEmpty}</div>}
    </div>
  )
}
