import { useEffect, useRef } from 'react'
import { DERIVED, DERIVED_BY_ID, type DerivedId, derivedName } from '../../game/derived.ts'
import {
  type MutationDef,
  type MutationId,
  MUTATIONS,
  nameOfMutations,
  type SharkPart,
} from '../../game/mutations.ts'
import { mutationName } from '../../game/mutations.ts'
import { sharkSprite } from '../../render/sharkSprite.ts'
import { useAssetVersion } from '../useAssetVersion.ts'

/** 合成スプライトの確認用。開発時のみ使う */
function Cell({
  mutations,
  label,
  scale = 1,
}: {
  mutations: readonly SharkPart[]
  label: string
  scale?: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const assetVersion = useAssetVersion()
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const sprite = sharkSprite(mutations, 1)
    c.width = sprite.width * scale
    c.height = sprite.height * scale
    const g = c.getContext('2d')!
    g.imageSmoothingEnabled = false
    g.clearRect(0, 0, c.width, c.height)
    g.drawImage(sprite, 0, 0, c.width, c.height)
  }, [mutations, scale, assetVersion])
  return (
    <div className="slab-cell">
      <canvas ref={ref} />
      <span>{label}</span>
    </div>
  )
}

// 名前は定義順に接頭辞を並べる前提なので、書いた順ではなく定義順にそろえる
const of = (...ids: MutationId[]) => MUTATIONS.filter((m) => ids.includes(m.id))

const COMBOS: Array<[readonly MutationDef[], string]> = [
  [of('ghost'), 'ゴースト単体（半透明）'],
  [of('fungus', 'ghost', 'zombie'), 'キノコゴーストゾンビ'],
  [of('albino', 'swift', 'spike'), 'スイフトアルビノスパイク'],
  [of('tripleHead', 'giant', 'poison'), 'ポイズントリプルヘッド巨大'],
  [of('tornado', 'zeroG', 'tsunami'), 'フライングトルネードツナミ'],
  [of('magma', 'frozen'), '2色 — マグマ / フローズン'],
  [of('magma', 'frozen', 'albino'), '3色 — マグマ / フローズン / アルビノ'],
  [of('poison', 'magma', 'frozen', 'albino', 'cosmic'), '5色（虹）'],
  [of('frenzy', 'pressure', 'abyss', 'tentacle'), '狂乱深圧アビスタコ'],
  [of('giant', 'armor', 'mecha', 'volt'), '巨大アーマードメカサンダー'],
  [of('triple', 'zombie', 'magma'), 'トリプルゾンビマグマ'],
  [of('ancient', 'eldritch', 'tsunami'), 'エンシェント邪神ツナミ'],
  [MUTATIONS, '全部乗せ（32種）'],
]

/** 派生種を混ぜた組み合わせ。材料の変異は派生種に吸収されるので含めない */
const mix = (derived: DerivedId[], ...ids: MutationId[]): readonly SharkPart[] => [
  ...of(...ids),
  ...derived.map((id) => DERIVED_BY_ID.get(id)!),
]

const DERIVED_COMBOS: Array<[readonly SharkPart[], string]> = [
  [mix(['missile'], 'glow'), '発光 + ミサイル'],
  [mix(['missile'], 'albino', 'poison', 'cosmic'), '3色 + ミサイル（派生種が半分）'],
  [mix(['heatShock'], 'glow', 'poison', 'albino'), '3色 + ヒートショック（2色）'],
  [mix(['megalodon'], 'ghost'), '幽体化 + メガロドン'],
  [mix(['railgun'], 'swarm'), 'ダブル + レールガン'],
  [mix(['lantern'], 'tentacle'), '触手化 + ランタン'],
  [mix(['urchin'], 'twinHead'), '双頭化 + 毒ウニ'],
  [mix(['fiveHead'], 'armor', 'storm'), '装甲 + 暴風 + ファイブヘッド'],
  [mix(['missile', 'urchin']), 'ミサイル + 毒ウニ（派生種 2 つ）'],
]

const PLAIN: readonly MutationDef[] = []
const SINGLES = new Map(MUTATIONS.map((m) => [m.id, [m]]))
const DERIVED_SINGLES = new Map(DERIVED.map((d) => [d.id, [d]]))

export function SpriteLab({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay">
      <div className="modal slab">
        <div className="slab-head">
          <div className="modal-title">スプライト合成の確認</div>
          <button className="btn" onClick={onClose}>
            閉じる
          </button>
        </div>

        <div className="panel-title">単体</div>
        <div className="slab-grid">
          <Cell mutations={PLAIN} label="通常サメ" />
          {MUTATIONS.map((m) => (
            <Cell key={m.id} mutations={SINGLES.get(m.id)!} label={mutationName(m)} />
          ))}
        </div>

        <div className="panel-title">派生種</div>
        <div className="slab-grid">
          {DERIVED.map((d) => (
            <Cell key={d.id} mutations={DERIVED_SINGLES.get(d.id)!} label={derivedName(d)} />
          ))}
        </div>

        <div className="panel-title">派生種と変異の組み合わせ</div>
        <div className="slab-grid">
          {DERIVED_COMBOS.map(([mutations, label]) => (
            <Cell key={label} mutations={mutations} label={label} />
          ))}
        </div>

        <div className="panel-title">組み合わせ</div>
        <div className="slab-grid">
          {COMBOS.map(([mutations, label]) => (
            <Cell key={label} mutations={mutations} label={label} />
          ))}
        </div>

        <div className="panel-title">自動生成された名前の確認</div>
        <div className="empty-note">
          {COMBOS.slice(0, 4)
            .map(([mutations]) => nameOfMutations(mutations))
            .join(' / ')}
        </div>
      </div>
    </div>
  )
}
