import { useEffect } from 'react'
import { codexReward, isClaimed, isDiscovered } from '../../game/codex.ts'
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
  const found = MUTATIONS.filter((m) => isDiscovered(meta, m.id)).length

  useEffect(() => {
    setCodexOpen(true)
    return () => setCodexOpen(false)
  }, [])

  return (
    <Dialog title={t.codex.title} onClose={onClose} className="codex">
      <div className="codex-head">
        <div className="modal-sub">{t.codex.sub}</div>
        <div className="codex-progress num">
          {fill(t.codex.progress, { n: found, total: MUTATIONS.length })}
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

  const claimed = isClaimed(meta, def.id)
  return (
    <div className="codex-entry" data-found="true" data-rarity={def.rarity}>
      <span className="codex-icon">
        <SharkIcon mutations={[def]} height={28} />
      </span>
      <span className="codex-name">{mutationName(def)}</span>
      <span className="codex-rarity">{RARITY_LABEL[def.rarity]}</span>
      {claimed ? (
        <span className="codex-claimed">{t.codex.claimed}</span>
      ) : (
        <button className="codex-claim" onClick={() => claimCodexReward(def.id)}>
          {fill(t.codex.claim, { n: fmt(codexReward(def.id)) })}
        </button>
      )}
    </div>
  )
}
