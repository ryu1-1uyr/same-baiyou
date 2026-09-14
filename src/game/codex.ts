import {
  DERIVED,
  DERIVED_BY_ID,
  type DerivedDef,
  type DerivedId,
  type DerivedTier,
  RECIPE_RANK,
} from './derived.ts'
import type { MetaState } from './meta.ts'
import {
  MUTATION_BY_ID,
  type MutationDef,
  type MutationId,
  type MutationRanks,
  type Rarity,
} from './mutations.ts'

/**
 * 図鑑。載せるのは原種（変異と派生種）だけで、組み合わせのサメは載せない。
 * 組み合わせは 2^N 通りあって埋まらないため、埋められる有限のリストにしている。
 *
 * 載るのは、その変異・派生種をドラフトで初めて取ったとき。
 * 載せた原種ごとに 1 回だけ研究予算を受け取れる。
 * 受け取りを図鑑の操作にしているのは、周回しても二重に払われないようにするため。
 */

/** 図鑑に載る原種の id。変異と派生種で名前が被らないようにしてある */
export type CodexId = MutationId | DerivedId

/** 変異の研究予算。レア度ごと。仮の値 */
export const CODEX_REWARD: Record<Rarity, number> = {
  common: 50,
  uncommon: 150,
  rare: 500,
  legendary: 2000,
}

/** 派生種の研究予算。解禁の段ごと。仮の値 */
export const DERIVED_REWARD: Record<DerivedTier, number> = {
  1: 1000,
  2: 3000,
  3: 10000,
}

export function codexReward(id: CodexId): number {
  const mutation = MUTATION_BY_ID.get(id as MutationId)
  if (mutation) return CODEX_REWARD[mutation.rarity]
  const derived = DERIVED_BY_ID.get(id as DerivedId)
  return derived ? DERIVED_REWARD[derived.tier] : 0
}

export function isDiscovered(meta: MetaState, id: CodexId): boolean {
  return meta.discovered.includes(id)
}

export function isClaimed(meta: MetaState, id: CodexId): boolean {
  return meta.claimed.includes(id)
}

/** 図鑑に載せる。新しく載ったら true */
export function discover(meta: MetaState, id: CodexId): boolean {
  if (isDiscovered(meta, id)) return false
  meta.discovered.push(id)
  return true
}

/** 報酬を受け取る。受け取れなかったら 0 を返す */
export function claimReward(meta: MetaState, id: CodexId): number {
  if (!isDiscovered(meta, id) || isClaimed(meta, id)) return 0
  const amount = codexReward(id)
  meta.claimed.push(id)
  meta.budget += amount
  meta.lifetimeBudget += amount
  return amount
}

/** まだ受け取っていない報酬の件数。通知バッジに使う */
export function unclaimedCount(meta: MetaState): number {
  return meta.discovered.filter((id) => !meta.claimed.includes(id)).length
}

/**
 * 派生種のヒント。材料が条件のランクに届くと、その材料だけが図鑑に開く。
 * 図鑑に保存して、ランをまたいで残す。
 */
function hintKey(def: DerivedDef, material: MutationId): string {
  return `${def.id}:${material}`
}

export function isHintOpen(meta: MetaState, def: DerivedDef, material: MutationId): boolean {
  return meta.hints.includes(hintKey(def, material))
}

/**
 * いまのランクで開くヒントを開く。新しく開いた材料を返す（観測記録に流すため）。
 * 解禁していない段のレシピは対象にしない。
 */
export function revealHints(meta: MetaState, ranks: MutationRanks, tier: number): MutationDef[] {
  const opened: MutationDef[] = []
  for (const def of DERIVED) {
    if (def.tier > tier) continue
    for (const id of def.materials) {
      if ((ranks.get(id) ?? 0) < RECIPE_RANK || isHintOpen(meta, def, id)) continue
      meta.hints.push(hintKey(def, id))
      opened.push(MUTATION_BY_ID.get(id)!)
    }
  }
  return opened
}
