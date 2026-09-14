import { BUILDINGS, costOf } from '../game/buildings.ts'
import type { Config } from '../game/config.ts'
import { expectedPower, type MutationDef } from '../game/mutations.ts'
import type { GameState } from '../game/state.ts'

/** 施設をどの比率で揃えるか。各要素は BUILDINGS と同順の目標比 */
export type BuyRatio = number[]

export const BUY_RATIOS: Record<string, BuyRatio> = {
  // 培養槽 / 給餌装置 / 繁殖槽 / 加速炉 / 射出管
  balanced: [10, 4, 6, 2, 3],
  cultureHeavy: [16, 6, 4, 1, 2],
  sharkHeavy: [8, 3, 10, 4, 3],
  launchHeavy: [8, 3, 5, 2, 8],
}

/**
 * 目標比から最も遅れている施設を 1 つ選んで買う。買えなくなるまで繰り返す。
 * 「安いものから買う」だと培養槽だけ無限に買う退化戦略になるため比率で縛る。
 */
export function autoBuy(s: GameState, cfg: Config, ratio: BuyRatio, income: number): void {
  for (let guard = 0; guard < 200; guard++) {
    // 目標比に対して最も遅れている施設を「買いたいもの」とする
    let want = -1
    let wantNorm = Infinity
    for (let i = 0; i < BUILDINGS.length; i++) {
      if (ratio[i] <= 0) continue
      const norm = s.buildings[i] / ratio[i]
      if (norm < wantNorm) {
        wantNorm = norm
        want = i
      }
    }
    if (want < 0) return

    const wantCost = costOf(BUILDINGS[want], s.buildings[want])
    if (wantCost <= s.culture) {
      s.culture -= wantCost
      s.buildings[want] += 1
      continue
    }

    // 買いたいものが 10 秒以内に手が届くなら貯金する（乗算施設を買えるようにするため）
    if (wantCost <= income * 10) return

    // 手が届かないなら、買える中で最も遅れているものを買う
    let best = -1
    let bestNorm = Infinity
    for (let i = 0; i < BUILDINGS.length; i++) {
      if (ratio[i] <= 0) continue
      if (costOf(BUILDINGS[i], s.buildings[i]) > s.culture) continue
      const norm = s.buildings[i] / ratio[i]
      if (norm < bestNorm) {
        bestNorm = norm
        best = i
      }
    }
    if (best < 0) return
    s.culture -= costOf(BUILDINGS[best], s.buildings[best])
    s.buildings[best] += 1
  }
}

export type DraftPolicyName = 'stack' | 'spread' | 'greedyEV' | 'random' | 'rarity'

/**
 * ドラフト方針。
 *  stack    … 取得済みの変異を優先して重ねる
 *  spread   … 未取得の変異を優先して広げる
 *  greedyEV … 取った後の期待戦闘力が最大になる 1 枚を選ぶ（上手いプレイヤーの近似）
 *  rarity   … 最もレアな 1 枚を選ぶ。倍率が伏せられている状態のプレイヤーの近似
 *  random   … 無作為
 */
export function makeDraftChooser(name: DraftPolicyName) {
  return (offers: MutationDef[], s: GameState, cfg: Config): number => {
    if (name === 'random') return Math.floor(Math.random() * offers.length)

    if (name === 'rarity') {
      const order = { common: 0, uncommon: 1, rare: 2, legendary: 3 }
      let best = 0
      let bestKey = -Infinity
      offers.forEach((o, i) => {
        // 同じレアリティなら、既に持っている方（強化になる方）を選ぶ
        const key = order[o.rarity] * 10 + Math.min(1, s.ranks.get(o.id) ?? 0)
        if (key > bestKey) {
          bestKey = key
          best = i
        }
      })
      return best
    }

    if (name === 'stack' || name === 'spread') {
      const owned = offers.map((o) => s.ranks.get(o.id) ?? 0)
      const wantOwned = name === 'stack'
      let best = 0
      let bestKey = -Infinity
      offers.forEach((o, i) => {
        const key = wantOwned ? owned[i] : -owned[i]
        // 同条件なら基礎倍率が高い方を選ぶ
        const tie = key * 1000 + o.basePower
        if (tie > bestKey) {
          bestKey = tie
          best = i
        }
      })
      return best
    }

    // greedyEV
    let best = 0
    let bestEv = -Infinity
    offers.forEach((o, i) => {
      const trial = new Map(s.ranks)
      trial.set(o.id, (trial.get(o.id) ?? 0) + 1)
      const ev = expectedPower(trial, cfg, 1, s.slots.fused)
      if (ev > bestEv) {
        bestEv = ev
        best = i
      }
    })
    return best
  }
}

/**
 * 研究方針の選び方（シミュレータ用）。
 * 効果の種類が異なり単純な期待値比較ができないため、
 * 生産に効くものを優先する固定の優先度で選ぶ。
 */
const POLICY_PRIORITY: string[] = [
  'condensate',
  'forcing',
  'reprocess',
  'pressurize',
  'catalyst',
  'preempt',
  'overdraw',
  'swarmSense',
  'recycle',
  'preserve',
]

export function pickPolicy(offers: Array<{ id: string }>): number {
  let best = 0
  let bestRank = Infinity
  offers.forEach((o, i) => {
    const r = POLICY_PRIORITY.indexOf(o.id)
    const rank = r < 0 ? 999 : r
    if (rank < bestRank) {
      bestRank = rank
      best = i
    }
  })
  return best
}
