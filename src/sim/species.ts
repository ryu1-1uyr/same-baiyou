import { DEFAULT_CONFIG, withConfig } from '../game/config.ts'
import { nameOfMask, powerOfMask } from '../game/mutations.ts'
import { createState } from '../game/state.ts'
import { applyDraft, clickValue, cultureRate, tick } from '../game/tick.ts'
import { autoBuy, BUY_RATIOS, makeDraftChooser } from './policy.ts'

function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return n.toFixed(1)
}

// 分散寄りに引いた方が複合サメが増えるので、両方見る
for (const [label, draft] of [
  ['分散寄り', 'spread'],
  ['最適化', 'greedyEV'],
] as const) {
  const cfg = withConfig(DEFAULT_CONFIG, { targets: { hpGrowth: 3.0 }, mutation: { rankPowerMult: 1.2 } })
  const s = createState(cfg, 7)
  const chooser = makeDraftChooser(draft)
  const input = { clicksPerSec: 5 }
  const dt = 1 / cfg.tickHz
  while (s.phase !== 'over' && s.t < 900) {
    tick(s, input, cfg)
    if (s.pendingDraft)
      applyDraft(s, cfg, s.pendingDraft.kind === 'mutation' ? chooser(s.pendingDraft.offers, s, cfg) : 0)
    if (Math.round(s.t / dt) % cfg.tickHz === 0)
      autoBuy(s, cfg, BUY_RATIOS.balanced, cultureRate(s) + clickValue(s, cfg) * input.clicksPerSec)
  }
  console.log(`\n=== 実験記録 (${label} / 突破深度 ${s.clearedDepth}) ===\n`)
  const rows = [...s.births.entries()]
    .map(([mask, count]) => ({
      name: nameOfMask(s.slots, mask),
      count,
      power: powerOfMask(s.slots, mask, s.ranks, cfg),
    }))
    .sort((a, b) => b.power * b.count - a.power * a.count)
  for (const r of rows.slice(0, 10)) {
    console.log(
      `  ${r.name.padEnd(20)} ${fmt(r.count).padStart(9)} 体   戦闘力 ${fmt(r.power).padStart(8)}   累計戦力 ${fmt(r.count * r.power)}`,
    )
  }
  console.log(`  ... 全 ${rows.length} 種`)
}
