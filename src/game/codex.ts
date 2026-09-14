import type { MetaState } from './meta.ts'
import { MUTATION_BY_ID, type MutationId, type Rarity } from './mutations.ts'

/**
 * 図鑑。載せるのは原種（変異そのもの）だけで、組み合わせのサメは載せない。
 * 組み合わせは 2^N 通りあって埋まらないため、埋められる有限のリストにしている。
 *
 * 載るのは、その変異をドラフトで初めて取ったとき。
 * 載せた原種ごとに 1 回だけ研究予算を受け取れる。
 * 受け取りを図鑑の操作にしているのは、周回しても二重に払われないようにするため。
 */

/** 原種ごとの研究予算。仮の値 */
export const CODEX_REWARD: Record<Rarity, number> = {
  common: 50,
  uncommon: 150,
  rare: 500,
  legendary: 2000,
}

export function codexReward(id: MutationId): number {
  const def = MUTATION_BY_ID.get(id)
  return def ? CODEX_REWARD[def.rarity] : 0
}

export function isDiscovered(meta: MetaState, id: MutationId): boolean {
  return meta.discovered.includes(id)
}

export function isClaimed(meta: MetaState, id: MutationId): boolean {
  return meta.claimed.includes(id)
}

/** 図鑑に載せる。新しく載ったら true */
export function discover(meta: MetaState, id: MutationId): boolean {
  if (isDiscovered(meta, id)) return false
  meta.discovered.push(id)
  return true
}

/** 報酬を受け取る。受け取れなかったら 0 を返す */
export function claimReward(meta: MetaState, id: MutationId): number {
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
