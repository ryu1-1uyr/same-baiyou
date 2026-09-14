import { useEffect, useRef } from 'react'
import { MUTATION_BY_ID, type MutationDef, type MutationId } from '../../game/mutations.ts'
import { pixelIcon } from '../../render/icons.ts'
import { sharkBounds, sharkSprite } from '../../render/sharkSprite.ts'
import { useAssetVersion } from '../useAssetVersion.ts'

/**
 * UI 上のアイコン。すべてドット絵で描く。
 *
 * 絵文字とドット絵のサメが同じ画面に並ぶと画風が衝突するため、絵文字は使わない。
 * 変異のアイコンは、その変異が付いたサメのスプライトをそのまま縮めて出す
 * （別に描く必要がなく、base.png を描き替えれば追従する）。
 */
export type SpriteKind = 'building' | 'mutation' | 'policy' | 'resource' | 'target' | 'ui'

export function Sprite({ kind, id, size = 22 }: { kind: SpriteKind; id: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const assetVersion = useAssetVersion()

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const g = c.getContext('2d')
    if (!g) return

    // 変異と「検体」はサメのスプライトを流用する
    let shark: MutationDef[] | null = null
    if (kind === 'mutation') {
      const def = MUTATION_BY_ID.get(id as MutationId)
      if (def) shark = [def]
    } else if (kind === 'resource' && id === 'shark') {
      shark = []
    }

    g.imageSmoothingEnabled = false

    if (shark !== null) {
      // サメは枠の余白を切り落としてから縮める
      const src = sharkSprite(shark, 1)
      const b = sharkBounds(shark, 1)
      const scale = size / b.h
      c.width = Math.max(1, Math.round(b.w * scale))
      c.height = Math.max(1, Math.round(size))
      g.clearRect(0, 0, c.width, c.height)
      g.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, c.width, c.height)
      return
    }

    const src = pixelIcon(`${kind}:${id}`)
    if (!src) return
    // ドット絵アイコンは整数倍でしか拡大しない（半端に伸ばすと格子が崩れる）
    const scale = Math.max(1, Math.floor(size / src.height))
    c.width = src.width * scale
    c.height = src.height * scale
    g.clearRect(0, 0, c.width, c.height)
    g.drawImage(src, 0, 0, c.width, c.height)
  }, [kind, id, size, assetVersion])

  return <canvas className="sprite" data-sprite={`${kind}:${id}`} ref={ref} aria-hidden="true" />
}
