import { useEffect, useRef } from 'react'
import type { SharkPart } from '../../game/mutations.ts'
import { sharkBounds, sharkSize, sharkSprite, spriteKey } from '../../render/sharkSprite.ts'
import { useAssetVersion } from '../useAssetVersion.ts'

/** 合成スプライトを DOM に置くための小さなラッパ */
export function SharkIcon({ mutations, height = 20 }: { mutations: readonly SharkPart[]; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const assetVersion = useAssetVersion()
  // 呼び出し側は描画のたびに配列を作り直すことがあるので、中身で描き直しを判定する
  const key = spriteKey(mutations)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const s = sharkSprite(mutations, 1)
    // 枠の余白ごと縮めると実体が小さくなるので、不透明な範囲だけを切り出す
    const b = sharkBounds(mutations, 1)
    const scale = height / b.h
    c.width = Math.max(1, Math.round(b.w * scale))
    c.height = Math.max(1, Math.round(height))
    const g = c.getContext('2d')!
    g.imageSmoothingEnabled = false
    g.clearRect(0, 0, c.width, c.height)
    g.drawImage(s, b.x, b.y, b.w, b.h, 0, 0, c.width, c.height)
  }, [key, height, assetVersion])
  const grow = growOf(mutations)
  return (
    <canvas
      className="shark-icon"
      ref={ref}
      aria-hidden="true"
      data-grow={grow !== 1 || undefined}
      style={grow !== 1 ? { transform: `scale(${grow})` } : undefined}
    />
  )
}

/** 巨大化などで大きいサメを UI 上でも大きく見せる倍率。並びを崩さないよう transform で枠からはみ出させる */
export function growOf(mutations: readonly SharkPart[]): number {
  return Math.min(GROW_MAX, sharkSize(mutations))
}

/** 組み合わせ次第で倍率が積み上がるので、隣の行を覆い尽くさない程度で止める */
const GROW_MAX = 2
