import {
  cachedPower,
  MUTATIONS,
  mutationName,
  mutationsOfMask,
  nameOfMask,
  rateAt,
} from '../../game/mutations.ts'
import { totalSharks } from '../../game/inventory.ts'
import { getConfig } from '../../store/gameStore.ts'
import { fmt } from '../format.ts'
import { fill, t } from '../../text/index.ts'
import { useGame } from '../useGame.ts'
import { SharkIcon } from './SharkIcon.tsx'
import { Sprite } from './Sprite.tsx'

const VISIBLE = 10

type Row = { mask: number; count: number; power: number }

/** 在庫のある種を先に、そのあとは戦闘力の高い順 */
function better(a: Row, b: Row): boolean {
  if (a.count >= 1 !== b.count >= 1) return a.count >= 1
  return a.power > b.power
}

/** 整列済みの配列に 1 件差し込む。長さが VISIBLE 以下なので線形で足りる */
function insert(rows: Row[], row: Row): void {
  let i = rows.length
  while (i > 0 && better(row, rows[i - 1])) i--
  rows.splice(i, 0, row)
}

export function StockPanel() {
  const s = useGame()
  const cfg = getConfig()

  /*
   * 在庫ではなく「このランで生まれた種」を並べる。
   * 侵略中は生産した端から出撃するので在庫は常にほぼゼロで、
   * 在庫だけを出すと一覧が空になって何を作ってきたのかが残らない。
   * 出撃済みの種は 0 体のまま並べ続け、そのランの成果として見せる。
   *
   * 種は変異の組み合わせぶんだけ増えるので、深いランでは数千件になる。
   * 全件を並べ替えると 10Hz の再描画に乗ってこないため、
   * 上位 VISIBLE 件だけを 1 パスで拾う。
   */
  let speciesCount = 0
  const shown: Row[] = []
  for (const [mask, born] of s.births) {
    if (born < 1) continue
    speciesCount++
    const row = {
      mask,
      count: s.inv.get(mask) ?? 0,
      power: cachedPower(s.slots, mask, s.ranks, cfg, s.powerCache),
    }
    if (shown.length < VISIBLE) {
      insert(shown, row)
    } else if (better(row, shown[VISIBLE - 1])) {
      shown.pop()
      insert(shown, row)
    }
  }
  const restSpecies = speciesCount - shown.length
  const restCount = totalSharks(s.inv) - shown.reduce((a, b) => a + b.count, 0)

  return (
    <div className="col area-stock">
      <div className="panel">
        <div className="panel-title">{t.stock.mutationTitle}</div>
        {s.ranks.size === 0 ? (
          <p className="empty-note">{t.stock.mutationEmpty}</p>
        ) : (
          <div className="mut-list">
            {MUTATIONS.filter((m) => (s.ranks.get(m.id) ?? 0) > 0).map((m) => {
              const rank = s.ranks.get(m.id)!
              return (
                <span key={m.id} className="mut" data-rarity={m.rarity}>
                  <Sprite kind="mutation" id={m.id} size={18} />
                  {mutationName(m)}
                  <span className="mut-rank">
                    R{rank}
                    {s.meta.showNumbers && ` ${(rateAt(m, rank, cfg) * 100).toFixed(0)}%`}
                  </span>
                </span>
              )
            })}
          </div>
        )}
      </div>

      <div className="panel scroll">
        <div className="panel-title">{t.stock.title}</div>
        {shown.length === 0 ? (
          <p className="empty-note">{t.stock.empty}</p>
        ) : (
          shown.map((st) => (
            <div key={st.mask} className="stack" data-empty={st.count < 1}>
              <SharkIcon mutations={mutationsOfMask(s.slots, st.mask)} height={26} />
              <span className="stack-name">{nameOfMask(s.slots, st.mask)}</span>
              <span className="stack-count">{fmt(st.count)}</span>
              <span className="stack-power">{fmt(st.power)}</span>
            </div>
          ))
        )}
        {restSpecies > 0 && (
          <div className="stack">
            <span className="stack-name empty-note">{fill(t.stock.rest, { n: restSpecies })}</span>
            <span className="stack-count">{fmt(Math.max(0, restCount))}</span>
          </div>
        )}
      </div>
    </div>
  )
}
