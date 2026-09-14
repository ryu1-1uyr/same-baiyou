import type { Text } from '../text/index.ts'
import { t } from '../text/index.ts'
import {
  MUTATION_BY_ID,
  type MutationDef,
  type MutationId,
  type MutationRanks,
  offerWeight,
} from './mutations.ts'

/**
 * 派生種。レシピの材料となる変異 2 種を R3 まで重ねると、次のドラフトで確定で提示される。
 *
 * 取ると、**材料 2 種が同時に発現した個体**が派生種になる。
 * 片方だけ発現した個体は材料の変異のまま。材料を R4 まで重ねれば派生種の発現率も上がる。
 * 戦闘倍率は「材料の倍率の積 × bonus」なので、材料が育つほど派生種も強くなる。
 *
 * 材料は複数のレシピで使い回さない。1 体が 2 レシピを同時に満たす状況を作らないため。
 */

export type DerivedId = keyof Text['derived']

/** 解禁の段。スキルツリーの災害系の下に 3 段で繋がる */
export type DerivedTier = 1 | 2 | 3

export type DerivedDef = {
  id: DerivedId
  materials: readonly [MutationId, MutationId]
  tier: DerivedTier
  /** 材料の倍率の積に掛ける派生ボーナス */
  bonus: number
}

/** 材料をこのランクまで重ねると派生の条件を満たす */
export const RECIPE_RANK = 3

/**
 * 派生ボーナスの基準値。7 回目以降のドラフトで、派生カードが最良の 1 枚を
 * 上回る割合がほぼ五分（51%）になる値。レシピの難易度に応じて個別に調整する。
 */
export const DERIVED_BONUS = 5.5

// 表として読むために整形を止めている（1 行 = 1 レシピ）
// prettier-ignore
export const DERIVED: DerivedDef[] = [
  // --- 1 段目: 生体系だけで作れる ---
  { id: 'missile',      materials: ['swift', 'frenzy'],       tier: 1, bonus: DERIVED_BONUS },
  { id: 'urchin',       materials: ['spike', 'poison'],       tier: 1, bonus: DERIVED_BONUS },
  { id: 'fiveHead',     materials: ['twinHead', 'tripleHead'], tier: 1, bonus: DERIVED_BONUS },
  { id: 'matango',      materials: ['fungus', 'zombie'],      tier: 1, bonus: DERIVED_BONUS },
  { id: 'phantom',      materials: ['albino', 'ghost'],       tier: 1, bonus: DERIVED_BONUS },
  // --- 2 段目: 系統をまたぐ ---
  { id: 'sharkTornado', materials: ['triple', 'tornado'],     tier: 2, bonus: DERIVED_BONUS },
  { id: 'lantern',      materials: ['glow', 'abyss'],         tier: 2, bonus: DERIVED_BONUS },
  { id: 'railgun',      materials: ['mecha', 'volt'],         tier: 2, bonus: DERIVED_BONUS },
  { id: 'heatShock',    materials: ['magma', 'frozen'],       tier: 2, bonus: DERIVED_BONUS },
  { id: 'soaring',      materials: ['zeroG', 'storm'],        tier: 2, bonus: DERIVED_BONUS },
  // --- 3 段目: レジェンダリーを含む ---
  { id: 'megalodon',    materials: ['giant', 'ancient'],      tier: 3, bonus: DERIVED_BONUS },
  { id: 'fortress',     materials: ['armor', 'autonomous'],   tier: 3, bonus: DERIVED_BONUS },
  { id: 'invader',      materials: ['meteor', 'alien'],       tier: 3, bonus: DERIVED_BONUS },
  { id: 'megaquake',    materials: ['pressure', 'tsunami'],   tier: 3, bonus: DERIVED_BONUS },
  { id: 'starSpawn',    materials: ['cosmic', 'eldritch'],    tier: 3, bonus: DERIVED_BONUS },
]

export const DERIVED_BY_ID = new Map(DERIVED.map((d) => [d.id, d]))

/** 材料 → その材料を使うレシピ。材料は使い回さないので 1 対 1 */
export const RECIPE_OF = new Map<MutationId, DerivedDef>(
  DERIVED.flatMap((d) => d.materials.map((id) => [id, d] as const)),
)

{
  const used = new Set<MutationId>()
  for (const d of DERIVED) {
    for (const id of d.materials) {
      if (!MUTATION_BY_ID.has(id)) throw new Error(`派生種 ${d.id} の材料 ${id} が変異に無い`)
      if (used.has(id)) throw new Error(`材料 ${id} が複数のレシピで使われている`)
      used.add(id)
    }
  }
}

export function derivedName(def: DerivedDef): string {
  return t.derived[def.id].name
}

export function materialsOf(def: DerivedDef): [MutationDef, MutationDef] {
  return [MUTATION_BY_ID.get(def.materials[0])!, MUTATION_BY_ID.get(def.materials[1])!]
}

/** 材料 2 種がともに条件のランクに届いているか */
export function recipeReady(def: DerivedDef, ranks: MutationRanks): boolean {
  return def.materials.every((id) => (ranks.get(id) ?? 0) >= RECIPE_RANK)
}

/**
 * 確定の提示で取らなかった派生カードが、通常の抽選に混ざるときの重み。
 * 材料のうちレア度の高い方と同じにする。
 */
export function derivedOfferWeight(def: DerivedDef, produced: number): number {
  const [a, b] = materialsOf(def)
  return Math.min(offerWeight(a, produced), offerWeight(b, produced))
}
