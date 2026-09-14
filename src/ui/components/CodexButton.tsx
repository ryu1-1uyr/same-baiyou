import { useState } from 'react'
import { unclaimedCount } from '../../game/codex.ts'
import { getMeta } from '../../store/gameStore.ts'
import { fill, t } from '../../text/index.ts'
import { CodexModal } from './CodexModal.tsx'

/** 図鑑の入り口。ラン中の画面上部と研究所に置く。受け取っていない件数をバッジで出す */
export function CodexButton() {
  const [open, setOpen] = useState(false)
  const unclaimed = unclaimedCount(getMeta())

  return (
    <>
      <button className="codex-open" onClick={() => setOpen(true)} aria-label={t.codex.open}>
        {t.codex.title}
        {unclaimed > 0 && (
          <span className="badge" title={fill(t.codex.unclaimed, { n: unclaimed })}>
            {unclaimed}
          </span>
        )}
      </button>
      {open && <CodexModal onClose={() => setOpen(false)} />}
    </>
  )
}
