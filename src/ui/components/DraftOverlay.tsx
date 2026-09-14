import { powerAt, rateAt } from '../../game/mutations.ts'
import { mutationName } from '../../game/mutations.ts'
import { policyName } from '../../game/policies.ts'
import { playSe } from '../../audio/se.ts'
import { chooseDraft, getConfig, reroll } from '../../store/gameStore.ts'
import { fmt } from '../format.ts'
import { fill, t } from '../../text/index.ts'
import { useGame } from '../useGame.ts'
import { SharkIcon } from './SharkIcon.tsx'
import { Sprite } from './Sprite.tsx'

const RARITY_LABEL: Record<string, string> = {
  common: 'COMMON',
  uncommon: 'UNCOMMON',
  rare: 'RARE',
  legendary: 'LEGENDARY',
}

/**
 * ドラフト。突然変異（検体側）と研究方針（施設側）の 2 種類が同じ枠に出る。
 * 見分けが付かないと「またカードか」になるため、見出し・色・添える絵で峻別する。
 */
export function DraftOverlay() {
  const s = useGame()
  const cfg = getConfig()
  const d = s.pendingDraft
  if (!d) return null

  const isPolicy = d.kind === 'policy'

  return (
    <div className="overlay">
      <div className="modal" data-draft={d.kind}>
        <div>
          <div className="modal-title">{isPolicy ? t.draft.policyTitle : t.draft.mutationTitle}</div>
          <div className="modal-sub">
            {isPolicy
              ? fill(t.draft.policySub, { n: fmt(s.cultureTotal) })
              : fill(t.draft.mutationSub, { n: fmt(s.producedTotal) })}
          </div>
        </div>

        {s.rerollsLeft > 0 && (
          <button
            className="reroll"
            onClick={() => {
              playSe('buy')
              reroll()
            }}
          >
            {fill(t.draft.reroll, { n: s.rerollsLeft })}
          </button>
        )}

        <div className="cards">
          {d.kind === 'mutation'
            ? d.offers.map((m, i) => {
                const cur = s.ranks.get(m.id) ?? 0
                const next = cur + 1
                return (
                  <button
                    key={m.id}
                    className="card"
                    data-rarity={m.rarity}
                    onClick={() => {
                      playSe('choose')
                      chooseDraft(i)
                    }}
                  >
                    <SharkIcon mutations={[m]} height={40} />
                    <span className="card-rarity">{RARITY_LABEL[m.rarity]}</span>
                    <span className="card-name">{mutationName(m)}</span>
                    {s.meta.showNumbers ? (
                      <span className="card-effect">
                        発現率 {(rateAt(m, next, cfg) * 100).toFixed(0)}% ／ 戦闘力 ×
                        {fmt(powerAt(m, next, cfg))}
                      </span>
                    ) : (
                      <span className="card-effect" data-unknown="true">
                        {t.draft.unknown}
                      </span>
                    )}
                    {cur > 0 && (
                      <span className="card-upgrade">{fill(t.draft.upgrade, { from: cur, to: next })}</span>
                    )}
                  </button>
                )
              })
            : d.offers.map((p, i) => {
                const cur = s.policies.get(p.id) ?? 0
                const next = cur + 1
                return (
                  <button
                    key={p.id}
                    className="card"
                    data-kind="policy"
                    onClick={() => {
                      playSe('choose')
                      chooseDraft(i)
                    }}
                  >
                    <Sprite kind="policy" id={p.id} size={40} />
                    <span className="card-rarity">POLICY</span>
                    <span className="card-name">{policyName(p)}</span>
                    <span className="card-effect">{p.detail(next)}</span>
                    {cur > 0 && (
                      <span className="card-upgrade">
                        R{cur} → R{next} に強化（上限 R{p.maxRank}）
                      </span>
                    )}
                  </button>
                )
              })}
        </div>
      </div>
    </div>
  )
}
