import { ackTutorial, dismissTutorialNotice, getTutorial } from '../../store/gameStore.ts'
import { speakerOf, type TutorialStep } from '../../store/tutorial.ts'
import { t } from '../../text/index.ts'
import { useGame } from '../useGame.ts'

/** 強調の印（**…**）を太字にする */
function Line({ text }: { text: string }) {
  return <>{text.split('**').map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))}</>
}

/** 主任の吹き出し。onOk を渡すと「了解」ボタンが付く */
function ChiefMessage({ step, onOk }: { step: TutorialStep; onOk?: () => void }) {
  return (
    <div className="chief" data-step={step}>
      <div className="chief-speaker">{speakerOf(getTutorial(), step)}</div>
      <p className="chief-line">
        <Line text={t.tutorial.lines[step]} />
      </p>
      {onOk && (
        <button className="btn" onClick={onOk}>
          {t.tutorial.ok}
        </button>
      )}
    </div>
  )
}

/**
 * 「了解」待ち。ゲームが止まっている場面（ドラフト・リザルト・研究所）で、本来の中身の代わりに出す。
 * カードが目に入ると文を読まずに押してしまうので、先に文だけを見せる。
 */
export function ChiefGate({ step }: { step: TutorialStep }) {
  return (
    <div className="overlay">
      <div className="modal" data-draft="chief">
        <ChiefMessage step={step} onOk={ackTutorial} />
      </div>
    </div>
  )
}

/**
 * ラン中の主任。最初のあいさつと設備の了解待ち、あいさつのあとの縛り、ゲームを止めない通知を出し分ける。
 * ドラフト・リザルト・研究所の了解待ちは、それぞれの画面が ChiefGate を出す。
 */
export function ChiefNotice() {
  useGame()
  const tutorial = getTutorial()
  if (tutorial.gate === 'culture' || tutorial.gate === 'build') return <ChiefGate step={tutorial.gate} />
  // 光らせた操作だけが暗幕の上に浮き、ほかは押せなくなる
  if (tutorial.lock) return <div className="tutorial-lock" />
  const notice = tutorial.notice
  if (!notice) return null
  return (
    <div className="chief-notice" role="status">
      <ChiefMessage step={notice.step} />
      <button className="chief-close" aria-label={t.tutorial.dismiss} onClick={dismissTutorialNotice}>
        ×
      </button>
    </div>
  )
}
