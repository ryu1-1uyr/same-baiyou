import { bossHp, depthName, targetCount, targetHp } from '../../game/targets.ts'
import { getConfig, tutorialFocus } from '../../store/gameStore.ts'
import { fill, t } from '../../text/index.ts'
import { fmt } from '../format.ts'
import { useGame } from '../useGame.ts'
import { CircleTimer } from './CircleTimer.tsx'
import { LogPanel } from './LogPanel.tsx'
import { InvasionViewer } from './InvasionViewer.tsx'
import { Sprite } from './Sprite.tsx'

export function InvasionPanel() {
  const s = useGame()
  const cfg = getConfig()

  if (s.phase === 'culture') {
    const left = Math.max(0, cfg.culturePhaseSec - s.t)
    return (
      <div className="col area-invasion">
        <div className="panel is-primary">
          <div className="panel-title">{t.phase.culture}</div>
          <CircleTimer
            ratio={left / cfg.culturePhaseSec}
            value={Math.ceil(left).toString()}
            caption={t.phase.untilInvasion}
          />
        </div>

        <LogPanel s={s} title={t.log.title} />
      </div>
    )
  }

  const name = depthName(s.depth)
  const max = s.onBoss ? bossHp(s.depth, cfg) : targetHp(s.depth, cfg)
  const pct = Math.max(0, Math.min(100, (s.currentHp / max) * 100))
  const total = targetCount(s.depth, cfg)

  return (
    <div className="col area-invasion">
      <div className="panel is-primary">
        <div className="panel-title">{name.zone}</div>
        <div className="target" data-tutorial-focus={tutorialFocus('boss') || undefined}>
          <div className="target-head">
            <Sprite kind="target" id={s.onBoss ? 'boss' : 'normal'} />
            <span className="target-name" data-boss={s.onBoss}>
              {s.onBoss ? s.bossName : s.normalName}
            </span>
            <span className="target-hp">
              {fmt(s.currentHp)} / {fmt(max)}
            </span>
          </div>
          <div className="bar">
            <div className="bar-fill" data-boss={s.onBoss} style={{ width: `${pct}%` }} />
          </div>
        </div>

        <InvasionViewer />

        <div className="progress-dots">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className="dot" data-done={i < s.destroyed} />
          ))}
          <span className="dot" data-boss="true" data-done={s.onBoss} />
        </div>

        <div className="launch-info">
          <span>{fill(t.invasion.destroyed, { done: s.destroyed, total })}</span>
          <span>{fill(t.invasion.clearedDepth, { n: s.clearedDepth })}</span>
        </div>
      </div>

      <LogPanel s={s} title={t.log.title} />
    </div>
  )
}
