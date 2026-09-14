import { budgetFor, createMeta, nodeName, NUMERIC_UPGRADES } from '../game/meta.ts'
import { spend } from './policy.ts'
import { simulate } from './run.ts'

function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return Math.floor(n).toString()
}

const RUNS = Number(process.argv[2] ?? 40)
const REWARD = Number(process.argv[3] ?? 1)

/** 報酬倍率を掃引して、深度 2 に到達するまでのラン数を見る */
if (process.argv[2] === 'sweep') {
  console.log('\n=== 報酬倍率と序盤の進行速度 ===\n')
  console.log('倍率   深度2到達  深度3到達  深度5到達  40ラン後   進行')
  for (const mult of [1, 2, 3, 4, 6, 8]) {
    const m = createMeta()
    const ds: number[] = []
    for (let i = 1; i <= 40; i++) {
      const r = simulate({ seed: 1000 + i, draft: 'greedyEV', meta: m })
      m.budget += Math.floor(budgetFor(r.score, r.clearedDepth) * mult)
      m.runs += 1
      spend(m)
      ds.push(r.clearedDepth)
    }
    const first = (d: number) => {
      const i = ds.findIndex((x) => x >= d)
      return i < 0 ? '—' : String(i + 1)
    }
    console.log(
      `${String(mult).padStart(3)}   ${first(2).padStart(9)}  ${first(3).padStart(9)}  ` +
        `${first(5).padStart(9)}  ${String(ds[ds.length - 1]).padStart(8)}   ${ds.slice(0, 14).join('')}`,
    )
  }
  process.exit(0)
}

const meta = createMeta()

console.log('\n=== 恒久強化を積みながら連続プレイしたときの進行 ===\n')
console.log('ラン  突破深度  総戦果    獲得予算   所持予算   購入したもの')
console.log('-'.repeat(96))

const depths: number[] = []
for (let i = 1; i <= RUNS; i++) {
  const r = simulate({ seed: 1000 + i, draft: 'greedyEV', meta })
  const gained = Math.floor(budgetFor(r.score, r.clearedDepth) * REWARD)
  meta.budget += gained
  meta.lifetimeBudget += gained
  meta.runs += 1
  meta.bestDepth = Math.max(meta.bestDepth, r.clearedDepth)
  const bought = spend(meta)
  depths.push(r.clearedDepth)

  const summary = (() => {
    const counts = new Map<string, number>()
    for (const b of bought) counts.set(b, (counts.get(b) ?? 0) + 1)
    return [...counts.entries()].map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join(' ')
  })()

  if (i <= 12 || i % 4 === 0) {
    console.log(
      `${String(i).padStart(3)}  ${String(r.clearedDepth).padStart(8)}  ${fmt(r.score).padStart(8)}  ` +
        `${fmt(gained).padStart(9)}  ${fmt(meta.budget).padStart(9)}   ${summary.slice(0, 52)}`,
    )
  }
}

console.log('\n到達深度の推移:')
console.log('  ' + depths.join(' → '))
console.log(`\n解禁済み: ${meta.unlocked.map((id) => nodeName(id)).join(' / ') || 'なし'}`)
console.log(
  `強化レベル: ${NUMERIC_UPGRADES.map((u) => `${nodeName(u.id)}${meta.levels[u.id] ?? 0}`).join(' ')}`,
)
