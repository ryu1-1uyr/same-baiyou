import { useEffect } from 'react'
import { type CodexId, codexReward, isClaimed, isDiscovered, isHintOpen } from '../../game/codex.ts'
import { DERIVED, type DerivedDef, derivedName, materialsOf, RECIPE_RANK } from '../../game/derived.ts'
import { metaEffects } from '../../game/meta.ts'
import {
  type Family,
  FAMILIES,
  familyName,
  type MutationDef,
  MUTATIONS,
  mutationName,
} from '../../game/mutations.ts'
import { claimCodexReward, getMeta, setCodexOpen } from '../../store/gameStore.ts'
import { fill, t } from '../../text/index.ts'
import { fmt } from '../format.ts'
import { useGame } from '../useGame.ts'
import { Dialog } from './Dialog.tsx'
import { RARITY_LABEL } from './DraftOverlay.tsx'
import { SharkIcon } from './SharkIcon.tsx'

const FAMILY_ORDER = Object.keys(FAMILIES) as Family[]
const PLAIN: readonly MutationDef[] = []

/**
 * 図鑑。タイトルとラン中の画面上部から開く。
 * 開いている間はランを止める（眺めている間に持ち時間が減らないように）。
 */
export function CodexModal({ onClose }: { onClose: () => void }) {
  useGame()
  const meta = getMeta()
  // 派生種は解禁するまで欄ごと出さない（存在を知る前に ？？？ が並ぶと、何の欄か分からないため）
  const tier = metaEffects(meta).derivedTier
  const entries: readonly CodexId[] = [
    ...MUTATIONS.map((m) => m.id),
    ...(tier > 0 ? DERIVED.map((d) => d.id) : []),
  ]
  const found = entries.filter((id) => isDiscovered(meta, id)).length

  useEffect(() => {
    setCodexOpen(true)
    return () => setCodexOpen(false)
  }, [])

  return (
    <Dialog title={t.codex.title} onClose={onClose} className="codex">
      <div className="codex-head">
        <div className="modal-sub">{t.codex.sub}</div>
        <div className="codex-progress num">
          {fill(t.codex.progress, { n: found, total: entries.length })}
        </div>
      </div>

      {FAMILY_ORDER.map((family) => (
        <section key={family} className="codex-family">
          <div className="panel-title">{familyName(family)}</div>
          <div className="codex-grid">
            {MUTATIONS.filter((m) => m.family === family).map((m) => (
              <CodexEntry key={m.id} def={m} />
            ))}
          </div>
        </section>
      ))}

      {tier > 0 && (
        <section className="codex-family">
          <div className="panel-title">{t.codex.derivedTitle}</div>
          <div className="codex-grid">
            {DERIVED.map((d) => (
              <DerivedEntry key={d.id} def={d} unlocked={d.tier <= tier} />
            ))}
          </div>
        </section>
      )}
    </Dialog>
  )
}

function CodexEntry({ def }: { def: MutationDef }) {
  const meta = getMeta()

  // 未発見のものは、変異の見た目を明かさないよう素のサメの影だけを出す
  if (!isDiscovered(meta, def.id)) {
    return (
      <div className="codex-entry" data-found="false">
        <span className="codex-icon">
          <SharkIcon mutations={PLAIN} height={28} />
        </span>
        <span className="codex-name">{t.codex.unknown}</span>
      </div>
    )
  }

  return (
    <div className="codex-entry" data-found="true" data-rarity={def.rarity}>
      <span className="codex-icon">
        <SharkIcon mutations={[def]} height={28} />
      </span>
      <span className="codex-name">{mutationName(def)}</span>
      <span className="codex-rarity">{RARITY_LABEL[def.rarity]}</span>
      <Reward id={def.id} />
    </div>
  )
}

const TIER_LABEL = { 1: 'I', 2: 'II', 3: 'III' } as const

function DerivedEntry({ def, unlocked }: { def: DerivedDef; unlocked: boolean }) {
  const meta = getMeta()
  const [a, b] = materialsOf(def)

  if (isDiscovered(meta, def.id)) {
    return (
      <div className="codex-entry" data-found="true" data-derived="true">
        <span className="codex-icon">
          <SharkIcon mutations={[def]} height={28} />
        </span>
        <span className="codex-name">{derivedName(def)}</span>
        <span className="codex-recipe">
          {fill(t.codex.recipe, { a: mutationName(a), b: mutationName(b) })}
        </span>
        <Reward id={def.id} />
      </div>
    )
  }

  // 材料は、そのランクに届いたことがあるものだけ開く
  const material = (m: MutationDef) =>
    isHintOpen(meta, def, m.id)
      ? fill(t.codex.material, { name: mutationName(m), rank: RECIPE_RANK })
      : t.codex.unknown
  return (
    <div className="codex-entry" data-found="false" data-derived="true" data-locked={!unlocked}>
      <span className="codex-icon">
        <SharkIcon mutations={PLAIN} height={28} />
      </span>
      <span className="codex-name">
        {unlocked
          ? t.codex.unknown
          : `${fill(t.codex.tier, { tier: TIER_LABEL[def.tier] })} — ${t.codex.locked}`}
      </span>
      <span className="codex-recipe">{fill(t.codex.recipe, { a: material(a), b: material(b) })}</span>
    </div>
  )
}

/** 原種ごとの研究予算。受け取ったら受け取り済みの表示に変わる */
function Reward({ id }: { id: CodexId }) {
  const meta = getMeta()
  return isClaimed(meta, id) ? (
    <span className="codex-claimed">{t.codex.claimed}</span>
  ) : (
    <button className="codex-claim" onClick={() => claimCodexReward(id)}>
      {fill(t.codex.claim, { n: fmt(codexReward(id)) })}
    </button>
  )
}
