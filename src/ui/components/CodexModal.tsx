import { useEffect } from 'react'
import { type CodexId, codexReward, isClaimed, isDiscovered, isHintOpen } from '../../game/codex.ts'
import {
  DERIVED,
  type DerivedDef,
  derivedName,
  materialsOf,
  RECIPE_RANK,
  recipeOpen,
} from '../../game/derived.ts'
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
import { fmt, RARITY_LABEL } from '../format.ts'
import { useGame } from '../useGame.ts'
import { Dialog } from './Dialog.tsx'
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
  // 派生種は作れるようになったものから並べる。系統を解禁するたびに欄が増え、幅が広がったのが目に見える
  const families = metaEffects(meta).families
  const openDerived = DERIVED.filter((d) => recipeOpen(d, families))
  const entries: readonly CodexId[] = [...MUTATIONS.map((m) => m.id), ...openDerived.map((d) => d.id)]
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

      <section className="codex-family">
        <div className="panel-title">{t.codex.derivedTitle}</div>
        <div className="codex-grid">
          {openDerived.map((d) => (
            <DerivedEntry key={d.id} def={d} />
          ))}
        </div>
      </section>
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

function DerivedEntry({ def }: { def: DerivedDef }) {
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
    <div className="codex-entry" data-found="false" data-derived="true">
      <span className="codex-icon">
        <SharkIcon mutations={PLAIN} height={28} />
      </span>
      <span className="codex-name">{t.codex.unknown}</span>
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
