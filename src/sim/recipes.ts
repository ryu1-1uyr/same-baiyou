import { type Config, DEFAULT_CONFIG, withConfig } from '../game/config.ts'
import { DERIVED, derivedName, materialsOf } from '../game/derived.ts'
import { budgetFor, createMeta, type MetaState } from '../game/meta.ts'
import { mutationName } from '../game/mutations.ts'
import { spend } from './policy.ts'
import { simulate } from './run.ts'

/**
 * 派生種のレシピごとの成立率を測る。
 *
 *   node src/sim/recipes.ts [mid|late] [ラン数] [再提示の重み...]
 *
 * 恒久強化は progress.ts と同じく「安い順に買う」で積み、
 * mid は災害系を解禁した直後、late は 25 ラン目の状態を使う。
 * どちらも派生研究 I〜III は強制的に解禁して、全レシピを対象にする。
 *
 * プレイヤーは 2 通り。
 *  chaseRecipe … レシピを狙う（材料を優先して重ね、派生カードは必ず取る）
 *  greedyEV    … 目先の期待戦闘力で選ぶ。狙わないとどれくらい自然に揃うかを見る
 */

const stage = process.argv[2] === 'late' ? 'late' : 'mid'
const RUNS = Number(process.argv[3] ?? 40)
const MULTS = process.argv.length > 4 ? process.argv.slice(4).map(Number) : [1, 2]

function buildMeta(): MetaState {
  const meta = createMeta()
  for (let i = 1; i <= 25; i++) {
    const r = simulate({ seed: 1000 + i, draft: 'greedyEV', meta })
    const gained = Math.floor(budgetFor(r.score, r.clearedDepth))
    meta.budget += gained
    meta.lifetimeBudget += gained
    meta.runs += 1
    meta.bestDepth = Math.max(meta.bestDepth, r.clearedDepth)
    spend(meta)
    if (stage === 'mid' && meta.unlocked.includes('family_disaster')) break
  }
  for (const id of ['derived_1', 'derived_2', 'derived_3']) {
    if (!meta.unlocked.includes(id)) meta.unlocked.push(id)
  }
  return meta
}

type Tally = { ready: Map<string, number>; fused: Map<string, number>; depth: number; derivedPerRun: number }

function measure(meta: MetaState, cfg: Config, draft: 'chaseRecipe' | 'greedyEV'): Tally {
  const tally: Tally = { ready: new Map(), fused: new Map(), depth: 0, derivedPerRun: 0 }
  for (let i = 0; i < RUNS; i++) {
    const r = simulate({ seed: 5000 + i, draft, cfg, meta: structuredClone(meta) })
    for (const id of r.readyRecipes) tally.ready.set(id, (tally.ready.get(id) ?? 0) + 1)
    for (const id of r.derived) tally.fused.set(id, (tally.fused.get(id) ?? 0) + 1)
    tally.depth += r.clearedDepth / RUNS
    tally.derivedPerRun += r.derived.length / RUNS
  }
  return tally
}

const pct = (n: number | undefined) => `${Math.round(((n ?? 0) / RUNS) * 100)}%`.padStart(5)

const meta = buildMeta()
console.log(
  `\n=== 派生種の成立率（${stage === 'mid' ? '災害系の解禁直後' : '25 ラン目'}の恒久強化 / ${RUNS} シード） ===\n`,
)

const results = MULTS.map((m) => {
  const cfg = withConfig(DEFAULT_CONFIG, { mutation: { reofferMult: m } })
  return { m, chase: measure(meta, cfg, 'chaseRecipe'), greedy: measure(meta, cfg, 'greedyEV') }
})

const head = results.map((x) => `狙う m=${x.m}（揃う / 派生）  狙わない m=${x.m}（揃う）`).join('   ')
console.log(`段  派生種                   材料                          ${head}`)
for (const d of DERIVED) {
  const [a, b] = materialsOf(d)
  const mats = `${mutationName(a)}(${a.rarity[0].toUpperCase()}) × ${mutationName(b)}(${b.rarity[0].toUpperCase()})`
  const cells = results
    .map(
      (x) =>
        `        ${pct(x.chase.ready.get(d.id))} / ${pct(x.chase.fused.get(d.id))}                ${pct(x.greedy.ready.get(d.id))}`,
    )
    .join('   ')
  console.log(`${d.tier}   ${derivedName(d).padEnd(14, '　')} ${mats.padEnd(22, '　')}${cells}`)
}
console.log('')
for (const x of results) {
  console.log(
    `m=${x.m}  狙う: 1 ランあたり派生 ${x.chase.derivedPerRun.toFixed(2)} 種 / 平均深度 ${x.chase.depth.toFixed(2)}` +
      `    狙わない: 1 ランあたり派生 ${x.greedy.derivedPerRun.toFixed(2)} 種 / 平均深度 ${x.greedy.depth.toFixed(2)}`,
  )
}
