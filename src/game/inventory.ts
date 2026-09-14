import type { Config } from './config.ts'
import {
  cachedPower,
  type MutationMask,
  type MutationRanks,
  type MutationSlots,
  type PowerCache,
  powerOfMask,
} from './mutations.ts'

/**
 * サメ在庫。変異の組み合わせ（ビットマスク）ごとに頭数を持つ。
 * 頭数を小数で保持しているのは、シミュレータが確率抽選ではなく
 * 期待値で回すため。UI 表示側では切り捨てる。
 */
export type Inventory = Map<MutationMask, number>

export function addSharks(inv: Inventory, mask: MutationMask, count: number): void {
  if (count <= 0) return
  inv.set(mask, (inv.get(mask) ?? 0) + count)
}

export function totalSharks(inv: Inventory): number {
  let n = 0
  for (const c of inv.values()) n += c
  return n
}

/** 在庫を戦闘力の昇順に並べる。出撃は必ず弱い個体から行う */
export function sortedByPower(
  inv: Inventory,
  slots: MutationSlots,
  ranks: MutationRanks,
  cfg: Config,
  cache?: PowerCache,
): Array<{ mask: MutationMask; power: number; count: number }> {
  const power = cache
    ? (mask: MutationMask) => cachedPower(slots, mask, ranks, cfg, cache)
    : (mask: MutationMask) => powerOfMask(slots, mask, ranks, cfg)
  return [...inv.entries()]
    .map(([mask, count]) => ({ mask, count, power: power(mask) }))
    .sort((a, b) => a.power - b.power)
}

/**
 * 弱い順に最大 n 体を出撃させ、与えた総ダメージを返す。
 * 出撃したサメは戦闘力にかかわらず在庫から失われる。
 */
export function launchWeakest(
  inv: Inventory,
  n: number,
  slots: MutationSlots,
  ranks: MutationRanks,
  cfg: Config,
  cache?: PowerCache,
): { launched: number; damage: number } {
  if (n <= 0) return { launched: 0, damage: 0 }

  // 在庫を出し切れるなら弱い順に並べる必要がない。
  // 投入速度が生産を上回る通常の状態では常にこちらを通る
  const total = totalSharks(inv)
  if (n >= total) {
    let damage = 0
    for (const [mask, count] of inv) {
      damage +=
        count * (cache ? cachedPower(slots, mask, ranks, cfg, cache) : powerOfMask(slots, mask, ranks, cfg))
    }
    inv.clear()
    return { launched: total, damage }
  }

  let remaining = n
  let damage = 0
  let launched = 0
  for (const stack of sortedByPower(inv, slots, ranks, cfg, cache)) {
    if (remaining <= 0) break
    const take = Math.min(stack.count, remaining)
    damage += take * stack.power
    launched += take
    remaining -= take
    const left = stack.count - take
    if (left <= 1e-9) inv.delete(stack.mask)
    else inv.set(stack.mask, left)
  }
  return { launched, damage }
}
