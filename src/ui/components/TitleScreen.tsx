import { useState } from 'react'
import { playSe } from '../../audio/se.ts'
import { unclaimedCount } from '../../game/codex.ts'
import { getMeta, startNewRun } from '../../store/gameStore.ts'
import { fill, t } from '../../text/index.ts'
import { AudioControls } from './AudioPanel.tsx'
import { CodexModal } from './CodexModal.tsx'
import { Dialog } from './Dialog.tsx'
import { SharkIcon } from './SharkIcon.tsx'

type Open = 'help' | 'options' | 'codex' | null

/**
 * 起動直後の画面。ここにいる間はゲームの時間が進まない。
 *
 * ゲームスタートでランを作り直すのは、起動時に作ったランの開始時刻に
 * タイトルで過ごした時間を混ぜないため。
 */
export function TitleScreen() {
  const [dialog, setDialog] = useState<Open>(null)
  const unclaimed = unclaimedCount(getMeta())

  return (
    <div className="title">
      <div className="title-logo">
        <SharkIcon mutations={[]} height={96} />
        <h1 className="title-name">{t.app.title}</h1>
      </div>

      <nav className="title-menu">
        <button
          className="title-item"
          data-primary="true"
          onClick={() => {
            playSe('choose')
            startNewRun()
          }}
        >
          {t.title.start}
        </button>
        <button className="title-item" onClick={() => setDialog('help')}>
          {t.title.help}
        </button>
        <button className="title-item" onClick={() => setDialog('codex')}>
          {t.codex.title}
          {unclaimed > 0 && (
            <span className="badge" title={fill(t.codex.unclaimed, { n: unclaimed })}>
              {unclaimed}
            </span>
          )}
        </button>
        <button className="title-item" onClick={() => setDialog('options')}>
          {t.title.options}
        </button>
      </nav>

      {dialog === 'help' && (
        <Dialog title={t.title.helpTitle} onClose={() => setDialog(null)}>
          <ol className="help-steps">
            {t.title.helpSteps.map((step) => (
              <li key={step.head} className="help-step">
                <div className="help-head">{step.head}</div>
                <div className="help-body">{step.body}</div>
              </li>
            ))}
          </ol>
        </Dialog>
      )}

      {dialog === 'codex' && <CodexModal onClose={() => setDialog(null)} />}

      {dialog === 'options' && (
        <Dialog title={t.title.optionsTitle} onClose={() => setDialog(null)}>
          <div className="title-options">
            <div className="panel-title">{t.audio.title}</div>
            <AudioControls />
          </div>
        </Dialog>
      )}
    </div>
  )
}
