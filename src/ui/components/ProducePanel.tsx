import { useRef } from 'react'
import { playSe } from '../../audio/se.ts'
import { type BuildingId, BUILDINGS, buildingName, costOf } from '../../game/buildings.ts'
import { totalSharks } from '../../game/inventory.ts'
import { clickValue, critChance, critMult, cultureRate, launchRate, sharkRate } from '../../game/tick.ts'
import {
  buy,
  getAutoBuyMode,
  getAutoBuyTarget,
  getConfig,
  manualClick,
  setAutoBuyTarget,
} from '../../store/gameStore.ts'
import { fill, t } from '../../text/index.ts'
import { fmt } from '../format.ts'
import { useGame } from '../useGame.ts'
import { DraftGauges } from './DraftGauges.tsx'
import { Sprite } from './Sprite.tsx'

function effectText(id: BuildingId, cfg: ReturnType<typeof getConfig>): string {
  const text = t.building[id].effect
  if (id === 'tank') return fill(text, { bonus: cfg.click.perTankBonus })
  if (id === 'breeder') return fill(text, { cost: cfg.shark.cultureCost })
  return text
}

export function ProducePanel() {
  const s = useGame()
  const cfg = getConfig()
  const areaRef = useRef<HTMLButtonElement>(null)

  /**
   * クリックの手応え。
   * インクリメンタルは同じ操作を何百回も繰り返すジャンルなので、
   * 1 回ごとに反応が返らないと手が止まる。
   * React の再描画には乗せず、DOM を直接生やして CSS で消す。
   */
  const onCollect = (e: React.MouseEvent<HTMLButtonElement>) => {
    const { gained, crit } = manualClick()
    // ドラフト提示中とラン終了後は採取が通らない。音も鳴らさない
    if (gained > 0) {
      playSe('collect')
      if (crit) playSe('crit')
    }
    const host = areaRef.current
    if (!host) return
    const r = host.getBoundingClientRect()
    const pop = document.createElement('span')
    pop.className = 'pop'
    if (crit) pop.dataset.crit = 'true'
    pop.textContent = `+${fmt(gained)}`
    pop.style.setProperty('--px', `${e.clientX - r.left}px`)
    pop.style.setProperty('--py', `${e.clientY - r.top}px`)
    pop.style.setProperty('--drift', `${(Math.random() - 0.5) * 40}px`)
    pop.addEventListener('animationend', () => pop.remove(), { once: true })
    host.appendChild(pop)
    host.classList.remove('is-hit')
    // 連打しても毎回アニメーションが走るよう、一度リセットしてから付け直す
    void host.offsetWidth
    host.classList.add('is-hit')
  }

  const crit = critChance(s)

  return (
    <div className="col area-produce">
      <button className="click-area" ref={areaRef} onClick={onCollect}>
        <Sprite kind="resource" id="culture" size={48} />
        <span className="click-label">{t.resource.collect}</span>
        <span className="click-hint">{fill(t.resource.perClick, { value: fmt(clickValue(s, cfg)) })}</span>
        {crit > 0 && (
          <span className="click-crit">
            {fill(t.resource.crit, { chance: Math.round(crit * 100), mult: critMult(s).toFixed(1) })}
          </span>
        )}
      </button>

      <div className="panel">
        <div className="panel-title">{t.resource.title}</div>
        <div className="stat" data-kind="culture">
          <Sprite kind="resource" id="culture" />
          <span className="stat-label">{t.resource.culture}</span>
          <span className="stat-value">{fmt(s.culture)}</span>
          <span className="stat-rate">+{fmt(cultureRate(s))}/s</span>
        </div>
        <div className="stat" data-kind="shark">
          <Sprite kind="resource" id="shark" />
          <span className="stat-label">{t.resource.shark}</span>
          <span className="stat-value">{fmt(totalSharks(s.inv))}</span>
          <span className="stat-rate">+{fmt(sharkRate(s))}/s</span>
        </div>
        <DraftGauges s={s} />

        <div className="tally">
          <span className="stat-label">{t.resource.produced}</span>
          <span className="tally-value">{fmt(s.producedTotal)}</span>
          <span className="tally-unit">{t.resource.unitShark}</span>
          <span className="tally-species">{fill(t.resource.unitKind, { n: s.births.size })}</span>
        </div>
        <div className="stat" data-kind="score">
          <Sprite kind="resource" id="score" />
          <span className="stat-label">{t.resource.score}</span>
          <span className="stat-value">{fmt(s.score)}</span>
          <span className="stat-rate">{fill(t.resource.launchRate, { rate: fmt(launchRate(s, cfg)) })}</span>
        </div>
      </div>

      <div className="panel scroll">
        <div className="panel-title">{t.building.title}</div>
        {BUILDINGS.map((b, i) => {
          const cost = costOf(b, s.buildings[i])
          const auto = getAutoBuyTarget() === i
          return (
            <div key={b.id} className="buy-row">
              <button
                className="buy"
                data-afford={s.culture >= cost}
                disabled={s.culture < cost}
                onClick={() => {
                  buy(i)
                  playSe('buy')
                }}
              >
                <Sprite kind="building" id={b.id} />
                <span className="buy-name">
                  {buildingName(b.id)}
                  <span className="buy-effect">{effectText(b.id, cfg)}</span>
                </span>
                <span className="buy-right">
                  <span className="buy-cost">{fmt(cost)}</span>
                  <span className="buy-owned">{fill(t.building.owned, { n: s.buildings[i] })}</span>
                </span>
              </button>
              {s.meta.autoBuyOne && (
                <button
                  className="buy-auto"
                  data-on={auto}
                  data-idle={getAutoBuyMode() !== 'one'}
                  title={t.building.autoBuyHint}
                  aria-label={fill(t.building.autoBuyLabel, { name: buildingName(b.id) })}
                  onClick={() => setAutoBuyTarget(i)}
                >
                  {auto ? '☑' : '☐'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
