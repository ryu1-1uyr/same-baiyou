import { useState } from 'react'
import { unclaimedCount } from '../../game/codex.ts'
import {
  type AutoBuyMode,
  getAutoBuyMode,
  getMeta,
  getSpeed,
  setAutoBuyMode,
  setSpeed,
  type Speed,
} from '../../store/gameStore.ts'
import { depthName } from '../../game/targets.ts'
import { fill, t } from '../../text/index.ts'
import { mmss } from '../format.ts'
import { useGame } from '../useGame.ts'
import { CodexModal } from './CodexModal.tsx'

const SPEEDS: Speed[] = [1, 2, 4]

export function HUD() {
  const s = useGame()
  const speed = getSpeed()
  const name = depthName(s.depth)
  const inCulture = s.phase === 'culture'
  const autoMode = getAutoBuyMode()
  const [codex, setCodex] = useState(false)
  const unclaimed = unclaimedCount(getMeta())
  // 解禁したモードだけを並べる。1 つしかないなら切り替える意味がないので出さない
  const autoModes: Array<[AutoBuyMode, string]> = [
    ['off', t.speed.manual],
    ...(s.meta.autoBuyOne ? ([['one', t.speed.autoBuyOne]] as Array<[AutoBuyMode, string]>) : []),
    ...(s.meta.autoBuyAll ? ([['all', t.speed.autoBuyAll]] as Array<[AutoBuyMode, string]>) : []),
  ]

  return (
    <div className="hud">
      <div>
        <div className="hud-phase">{inCulture ? t.phase.culture : t.phase.invasion}</div>
        <div className="hud-depth">
          {inCulture ? t.phase.cultureTank : fill(t.phase.depth, { depth: s.depth })}
          <span className="hud-depth-name">{inCulture ? t.phase.safe : name.zone}</span>
        </div>
      </div>

      <button className="hud-codex" onClick={() => setCodex(true)} aria-label={t.codex.open}>
        {t.codex.title}
        {unclaimed > 0 && (
          <span className="badge" title={fill(t.codex.unclaimed, { n: unclaimed })}>
            {unclaimed}
          </span>
        )}
      </button>

      <div className="speed" style={{ marginRight: 'auto' }}>
        {SPEEDS.filter((v) => v <= s.meta.maxSpeed).map((v) => (
          <button key={v} data-active={speed === v} onClick={() => setSpeed(v)}>
            ×{v}
          </button>
        ))}
        {autoModes.length > 1 && (
          <span className="autobuy">
            {autoModes.map(([mode, label]) => (
              <button key={mode} data-active={autoMode === mode} onClick={() => setAutoBuyMode(mode)}>
                {label}
              </button>
            ))}
          </span>
        )}
      </div>

      {s.meta.reserveSeconds > 0 && (
        <span className="reserve" data-spent={s.reserveUsed}>
          {s.reserveUsed ? t.reserve.spent : fill(t.reserve.ready, { sec: s.meta.reserveSeconds })}
        </span>
      )}

      {/* 培養中は中央に円タイマーが出ているので、同じ数字を二重に出さない */}
      {inCulture ? (
        <div className="hud-standby">{t.phase.standby}</div>
      ) : (
        <div className="hud-timer" data-warn={s.timeLeft <= 15}>
          {mmss(s.timeLeft)}
        </div>
      )}

      {codex && <CodexModal onClose={() => setCodex(false)} />}
    </div>
  )
}
