import { type ReactNode, useEffect, useState } from 'react'
import { playSe } from '../../audio/se.ts'
import { startNewRun } from '../../store/gameStore.ts'
import { t } from '../../text/index.ts'
import { AudioControls } from './AudioPanel.tsx'
import { SharkIcon } from './SharkIcon.tsx'

type Dialog = 'help' | 'options' | null

/**
 * 起動直後の画面。ここにいる間はゲームの時間が進まない。
 *
 * ゲームスタートでランを作り直すのは、起動時に作ったランの開始時刻に
 * タイトルで過ごした時間を混ぜないため。
 */
export function TitleScreen() {
  const [dialog, setDialog] = useState<Dialog>(null)

  return (
    <div className="title">
      <div className="title-logo">
        <SharkIcon mask={0} height={96} />
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
        <button className="title-item" onClick={() => setDialog('options')}>
          {t.title.options}
        </button>
      </nav>

      {dialog === 'help' && (
        <TitleDialog title={t.title.helpTitle} onClose={() => setDialog(null)}>
          <ol className="help-steps">
            {t.title.helpSteps.map((step) => (
              <li key={step.head} className="help-step">
                <div className="help-head">{step.head}</div>
                <div className="help-body">{step.body}</div>
              </li>
            ))}
          </ol>
        </TitleDialog>
      )}

      {dialog === 'options' && (
        <TitleDialog title={t.title.optionsTitle} onClose={() => setDialog(null)}>
          <div className="title-options">
            <div className="panel-title">{t.audio.title}</div>
            <AudioControls />
          </div>
        </TitleDialog>
      )}
    </div>
  )
}

function TitleDialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    // 背景を押しても閉じる。中身のクリックは伝播させない
    <div className="overlay" onClick={onClose}>
      <div
        className="modal title-dialog"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title">{title}</div>
        {children}
        <button className="btn" onClick={onClose}>
          {t.title.close}
        </button>
      </div>
    </div>
  )
}
