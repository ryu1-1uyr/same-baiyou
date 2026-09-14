import { BUILDINGS, costOf } from '../game/buildings.ts'
import type { Config } from '../game/config.ts'
import {
  buyNumeric,
  buyUnlock,
  type MetaState,
  nodeName,
  nodeUnlocked,
  NUMERIC_UPGRADES,
  UNLOCKS,
  unlockAvailable,
  upgradeCost,
} from '../game/meta.ts'
import { DERIVED, type DerivedDef, RECIPE_RANK } from '../game/derived.ts'
import { expectedPower, MUTATION_BY_ID, type MutationDef } from '../game/mutations.ts'
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

export type DraftPolicyName = 'stack' | 'spread' | 'greedyEV' | 'random' | 'rarity' | 'chaseRecipe'

/**
 * ドラフト方針。
 *  stack    … 取得済みの変異を優先して重ねる
 *  spread   … 未取得の変異を優先して広げる
 *  greedyEV … 取った後の期待戦闘力が最大になる 1 枚を選ぶ（上手いプレイヤーの近似）
 *  rarity   … 最もレアな 1 枚を選ぶ。倍率が伏せられている状態のプレイヤーの近似
 *  random   … 無作為
 *  chaseRecipe … 派生種のレシピを狙う。材料を R3 まで重ね、派生カードは必ず取る。
 *                材料が出なければ greedyEV
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

    if (name === 'chaseRecipe') {
      const target = recipeTarget(s)
      if (target) {
        // 完成に近いレシピの材料を優先し、無ければ他の解禁済みレシピの材料を拾う
        const primary = offers.findIndex((o) => needsRank(s, target, o))
        if (primary >= 0) return primary
        const secondary = offers.findIndex((o) => openRecipes(s).some((d) => needsRank(s, d, o)))
        if (secondary >= 0) return secondary
      }
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

/** 解禁済みで、まだ取っていない派生種のレシピ */
function openRecipes(s: GameState): DerivedDef[] {
  return DERIVED.filter(
    (d) =>
      d.tier <= s.meta.derivedTier &&
      !s.slots.fused.includes(d) &&
      d.materials.every((id) => s.meta.families.has(MUTATION_BY_ID.get(id)!.family)),
  )
}

/** そのカードが、レシピの材料をまだ条件のランクまで重ねていないものか */
function needsRank(s: GameState, d: DerivedDef, o: MutationDef): boolean {
  return d.materials.includes(o.id) && (s.ranks.get(o.id) ?? 0) < RECIPE_RANK
}

/** 狙うレシピ。材料のランクの合計が最も高い（完成に近い）もの */
function recipeTarget(s: GameState): DerivedDef | null {
  let best: DerivedDef | null = null
  let bestProgress = -1
  for (const d of openRecipes(s)) {
    const progress = d.materials.reduce((a, id) => a + Math.min(RECIPE_RANK, s.ranks.get(id) ?? 0), 0)
    if (progress > bestProgress) {
      bestProgress = progress
      best = d
    }
  }
  return best
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

/** 買えるもののうち最も安いものを買い続ける（素直なプレイヤーの近似） */
export function spend(meta: MetaState): string[] {
  const bought: string[] = []
  for (let guard = 0; guard < 60; guard++) {
    let bestId: string | null = null
    let bestCost = Infinity
    let bestKind: 'num' | 'unlock' = 'num'

    for (const u of NUMERIC_UPGRADES) {
      const lv = meta.levels[u.id] ?? 0
      if (lv >= u.maxLevel) continue
      // 前提を満たしていないものを選ぶと buyNumeric が失敗し、同じ候補を選び続けて空回りする
      if (!nodeUnlocked(meta, u.id)) continue
      const c = upgradeCost(u, lv)
      if (c <= meta.budget && c < bestCost) {
        bestCost = c
        bestId = u.id
        bestKind = 'num'
      }
    }
    for (const u of UNLOCKS) {
      if (!unlockAvailable(meta, u)) continue
      if (u.cost <= meta.budget && u.cost < bestCost) {
        bestCost = u.cost
        bestId = u.id
        bestKind = 'unlock'
      }
    }

    if (!bestId) break
    if (bestKind === 'num') {
      buyNumeric(meta, bestId)
      bought.push(bestId)
    } else {
      buyUnlock(meta, bestId)
      bought.push(`★${nodeName(bestId)}`)
    }
  }
  return bought
}
