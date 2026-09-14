import { cachedPower, mutationsOfMask, nameOfMask } from '../../game/mutations.ts'
import { bossHp, depthName } from '../../game/targets.ts'
import { getConfig, getLastAward, setScreen } from '../../store/gameStore.ts'
import { fill, t } from '../../text/index.ts'
import { fmt, mmss } from '../format.ts'
import { useGame } from '../useGame.ts'
import { SharkIcon } from './SharkIcon.tsx'
import { Sprite } from './Sprite.tsx'

export function ResultOverlay() {
  const s = useGame()
  const cfg = getConfig()
  if (s.phase !== 'over') return null

  // 累計出生。在庫と違って減らないので、そのランで何を作ったかの記録になる
  /**
   * そのランで生まれた最も改造の進んだ個体。
   * 戦闘力ではなく**併せ持つ変異の数**で選ぶ。
   * 数字の大きさより「何をどれだけ盛ったか」がそのランの顔になるため。
   */
  const champion = [...s.births.entries()]
    .filter(([, count]) => count >= 1)
    .map(([mask, count]) => ({
      mask,
      count,
      power: cachedPower(s.slots, mask, s.ranks, cfg, s.powerCache),
      traits: mutationsOfMask(s.slots, mask).length,
    }))
    .sort((a, b) => b.traits - a.traits || b.power - a.power)[0]

  const species = [...s.births.entries()]
    .map(([mask, count]) => ({
      mask,
      count,
      power: cachedPower(s.slots, mask, s.ranks, cfg, s.powerCache),
    }))
    .filter((x) => x.count >= 1)
    .sort((a, b) => b.power * b.count - a.power * a.count)
    .slice(0, 8)

  /**
   * ボス戦の最中に時間切れになったときだけ、削り残しを見せる。
   * 四捨五入するが、わずかでも残っていれば 0% とは表示しない。
   */
  const bossLeftPct = s.onBoss ? Math.max(1, Math.round((s.currentHp / bossHp(s.depth, cfg)) * 100)) : null

  return (
    <div className="overlay">
      <div className="modal">
        <div>
          <div className="modal-title">
            <Sprite kind="ui" id="beam" /> {t.result.title}
          </div>
          <div className="modal-sub">{t.result.sub}</div>
        </div>

        {bossLeftPct !== null && (
          <div className="result-boss">
            {fill(t.result.bossLeft, { name: s.bossName })}
            <span className="num">{bossLeftPct}%</span>
          </div>
        )}

        <div className="result-grid">
          <div className="result-row">
            <span className="stat-label">{t.result.clearedDepth}</span>
            <span className="num">{s.clearedDepth}</span>
          </div>
          <div className="result-row">
            <span className="stat-label">{t.result.zone}</span>
            <span className="num">{depthName(s.depth).zone}</span>
          </div>
          <div className="result-row">
            <span className="stat-label">{t.result.score}</span>
            <span className="num">{fmt(s.score)}</span>
          </div>
          <div className="result-row">
            <span className="stat-label">{t.result.elapsed}</span>
            <span className="num">{mmss(s.t)}</span>
          </div>
          <div className="result-row">
            <span className="stat-label">{t.result.produced}</span>
            <span className="num">{fmt(s.producedTotal)}</span>
          </div>
          <div className="result-row">
            <span className="stat-label">{t.result.award}</span>
            <span className="num award">+{fmt(getLastAward())}</span>
          </div>
        </div>

        {champion && champion.traits > 0 && (
          <div className="champion">
            <div className="panel-title">{t.result.championTitle}</div>
            <div className="champion-body">
              <SharkIcon mutations={mutationsOfMask(s.slots, champion.mask)} height={64} />
              <div className="champion-info">
                <div className="champion-name">{nameOfMask(s.slots, champion.mask)}</div>
                <div className="champion-stats">
                  {fill(t.result.championInfo, {
                    traits: champion.traits,
                    power: fmt(champion.power),
                    count: fmt(champion.count),
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        <div>
          <div className="panel-title">{t.result.speciesTitle}</div>
          {species.map((sp) => (
            <div key={sp.mask} className="stack">
              <SharkIcon mutations={mutationsOfMask(s.slots, sp.mask)} height={30} />
              <span className="stack-name">{nameOfMask(s.slots, sp.mask)}</span>
              <span className="stack-count">{fmt(sp.count)}</span>
              <span className="stack-power">{fmt(sp.power)}</span>
            </div>
          ))}
        </div>

        <button className="btn" onClick={() => setScreen('lab')}>
          {t.result.toLab}
        </button>
      </div>
    </div>
  )
}
