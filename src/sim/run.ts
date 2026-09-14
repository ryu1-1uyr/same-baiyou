import { BUILDINGS, buildingName } from '../game/buildings.ts'
import { DERIVED, type DerivedId, recipeReady } from '../game/derived.ts'
import { type Config, DEFAULT_CONFIG, withConfig } from '../game/config.ts'
import { totalSharks } from '../game/inventory.ts'
import { MUTATION_BY_ID, type MutationId, expectedPower, nameOfMask, powerOfMask } from '../game/mutations.ts'
import { mutationName } from '../game/mutations.ts'
import { applyMetaToConfig, createMeta, type MetaState, metaEffects } from '../game/meta.ts'
import { createState, type GameState } from '../game/state.ts'
import { applyDerived, applyDraft, clickEV, clickValue, cultureRate, tick } from '../game/tick.ts'
import { autoBuy, BUY_RATIOS, type DraftPolicyName, makeDraftChooser, pickPolicy } from './policy.ts'

export type SimOptions = {
  cfg?: Config
  draft?: DraftPolicyName
  ratio?: keyof typeof BUY_RATIOS
  clicksPerSec?: number
  seed?: number
  maxSeconds?: number
  /** 恒久強化の状態。省略時は何も買っていない初回ラン相当 */
  meta?: MetaState
}

export type SimResult = {
  clearedDepth: number
  reachedDepth: number
  totalSeconds: number
  score: number
  produced: number
  leftover: number
  expPower: number
  draftCount: number
  /** 取った変異の id。文字列の ranks と違い、集計に使える */
  rankIds: MutationId[]
  ranks: string
  topStacks: Array<{ name: string; count: number; power: number }>
  /** 取った派生種 */
  derived: DerivedId[]
  /** ラン終了時点で材料が条件のランクに届いていたレシピ（取ったかどうかは問わない） */
  readyRecipes: DerivedId[]
}

/**
 * 提示中のドラフトから 1 枚選ぶ。
 * 突然変異は方針関数に任せ、研究方針は別の基準で選ぶ。
 */
function pickDraft(s: GameState, cfg: Config, chooser: ReturnType<typeof makeDraftChooser>): number {
  const d = s.pendingDraft!
  return d.kind === 'mutation' ? chooser(d.offers, s, cfg) : pickPolicy(d.offers)
}

/**
 * 派生種のカードを取るか。取るならその添字、取らないなら -1。
 * 取った後の期待戦闘力が、変異の側で選ぶ 1 枚を取った場合以上なら取る。
 * always が立っていれば比べずに取る（レシピを狙う方針）。
 */
function pickDerived(
  s: GameState,
  cfg: Config,
  chooser: ReturnType<typeof makeDraftChooser>,
  always: boolean,
): number {
  const d = s.pendingDraft!
  if (d.kind !== 'mutation' || d.derived.length === 0) return -1
  let best = -1
  let bestEv = -Infinity
  d.derived.forEach((def, i) => {
    const ev = expectedPower(s.ranks, cfg, 1, [...s.slots.fused, def])
    if (ev > bestEv) {
      bestEv = ev
      best = i
    }
  })
  if (d.offers.length === 0 || always) return best
  const pick = d.offers[chooser(d.offers, s, cfg)]
  const trial = new Map(s.ranks)
  trial.set(pick.id, (trial.get(pick.id) ?? 0) + 1)
  return bestEv >= expectedPower(trial, cfg, 1, s.slots.fused) ? best : -1
}

export function simulate(opts: SimOptions = {}): SimResult {
  const meta = opts.meta ?? createMeta()
  const eff = metaEffects(meta)
  const cfg = applyMetaToConfig(opts.cfg ?? DEFAULT_CONFIG, eff)
  const s = createState(cfg, opts.seed ?? 12345, eff)
  const chooser = makeDraftChooser(opts.draft ?? 'greedyEV')
  const ratio = BUY_RATIOS[opts.ratio ?? 'balanced']
  const input = { clicksPerSec: opts.clicksPerSec ?? 5 }
  const maxT = opts.maxSeconds ?? 3600
  const dt = 1 / cfg.tickHz

  while (s.phase !== 'over' && s.t < maxT) {
    tick(s, input, cfg)
    if (s.pendingDraft) {
      const derived = pickDerived(s, cfg, chooser, opts.draft === 'chaseRecipe')
      if (derived >= 0) applyDerived(s, cfg, derived)
      else applyDraft(s, cfg, pickDraft(s, cfg, chooser))
    }
    // 購入判断は 1 秒に 1 回で十分（毎ティック回すと無駄が大きい）
    if (Math.round(s.t / dt) % cfg.tickHz === 0)
      autoBuy(s, cfg, ratio, cultureRate(s) + clickEV(s, cfg) * input.clicksPerSec)
  }

  const stacks = [...s.inv.entries()]
    .map(([mask, count]) => ({
      name: nameOfMask(s.slots, mask),
      count,
      power: powerOfMask(s.slots, mask, s.ranks, cfg),
    }))
    .sort((a, b) => b.power * b.count - a.power * a.count)
    .slice(0, 5)

  return {
    clearedDepth: s.clearedDepth,
    reachedDepth: s.depth,
    totalSeconds: s.t,
    score: s.score,
    produced: s.producedTotal,
    leftover: totalSharks(s.inv),
    expPower: expectedPower(s.ranks, cfg, 1, s.slots.fused),
    draftCount: s.draftCount,
    rankIds: [...s.ranks.keys()],
    ranks: [...s.ranks.entries()].map(([id, r]) => `${mutationName(MUTATION_BY_ID.get(id)!)}R${r}`).join(' '),
    topStacks: stacks,
    derived: s.slots.fused.map((d) => d.id),
    readyRecipes: DERIVED.filter((d) => recipeReady(d, s.ranks)).map((d) => d.id),
  }
}

// ---------------------------------------------------------------------------

function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'k'
  return n.toFixed(1)
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function line(label: string, r: SimResult): void {
  console.log(
    label.padEnd(22) +
      `突破 ${String(r.clearedDepth).padStart(2)}  ` +
      `${mmss(r.totalSeconds).padStart(5)}  ` +
      `生産 ${fmt(r.produced).padStart(8)}  ` +
      `E[power] ${fmt(r.expPower).padStart(8)}  ` +
      `戦果 ${fmt(r.score).padStart(8)}  ` +
      `${r.ranks}`,
  )
}

// run.ts を import しただけで CLI 出力が走らないようにする
const isMain = (process.argv[1] ?? '').endsWith('run.ts')
const mode = isMain ? (process.argv[2] ?? 'draft') : 'none'

if (mode === 'draft') {
  console.log('\n=== ドラフト方針の比較（timerModel: runWide / balanced 購入） ===\n')
  for (const d of ['stack', 'spread', 'greedyEV'] as DraftPolicyName[]) {
    line(d, simulate({ draft: d }))
  }

  console.log('\n=== タイマー方式の比較（greedyEV） ===\n')
  for (const model of ['runWide', 'perDepth'] as const) {
    const cfg = withConfig(DEFAULT_CONFIG, { invasion: { timerModel: model } })
    line(model, simulate({ cfg, draft: 'greedyEV' }))
  }

  console.log('\n=== 購入比率の比較（greedyEV / runWide） ===\n')
  for (const r of Object.keys(BUY_RATIOS)) {
    line(r, simulate({ ratio: r, draft: 'greedyEV' }))
  }

  const r = simulate({ draft: 'greedyEV' })
  console.log('\n=== 在庫の中身（greedyEV / balanced） ===\n')
  for (const st of r.topStacks) {
    console.log(`  ${st.name.padEnd(16)} ${fmt(st.count).padStart(9)} 体   戦闘力 ${fmt(st.power)}`)
  }
  console.log(`\n  出撃せず残ったサメ: ${fmt(r.leftover)} 体 / 生産 ${fmt(r.produced)} 体`)
  console.log(`  最終施設: ${BUILDINGS.map((b) => `${buildingName(b.id)}?`).join(' ')}`)
}

if (mode === 'sweep') {
  console.log('\n=== rankPowerMult 掃引: 重ね取り(stack) vs 分散(spread) ===\n')
  console.log('mult    stack突破  spread突破  greedy突破   stackE     spreadE')
  for (const mult of [1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0]) {
    const cfg = withConfig(DEFAULT_CONFIG, { mutation: { rankPowerMult: mult } })
    const a = simulate({ cfg, draft: 'stack' })
    const b = simulate({ cfg, draft: 'spread' })
    const c = simulate({ cfg, draft: 'greedyEV' })
    console.log(
      `${mult.toFixed(1).padStart(4)}    ` +
        `${String(a.clearedDepth).padStart(6)}     ` +
        `${String(b.clearedDepth).padStart(6)}     ` +
        `${String(c.clearedDepth).padStart(6)}   ` +
        `${fmt(a.expPower).padStart(9)}  ${fmt(b.expPower).padStart(9)}`,
    )
  }
}

if (mode === 'hp') {
  console.log('\n=== hpGrowth 掃引（greedyEV / runWide） ===\n')
  console.log('growth  突破深度   総時間   戦果')
  for (const g of [2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.5]) {
    const cfg = withConfig(DEFAULT_CONFIG, { targets: { hpGrowth: g } })
    const r = simulate({ cfg, draft: 'greedyEV' })
    console.log(
      `${g.toFixed(1).padStart(5)}   ${String(r.clearedDepth).padStart(6)}   ${mmss(r.totalSeconds).padStart(6)}   ${fmt(r.score)}`,
    )
  }
}

if (mode === 'trace') {
  const cfg = DEFAULT_CONFIG
  const s = createState(cfg, 1)
  const chooser = makeDraftChooser('greedyEV')
  const ratio = BUY_RATIOS.balanced
  const input = { clicksPerSec: 5 }
  const dt = 1 / cfg.tickHz
  let nextLog = 0
  console.log('\n  t   phase     培養液    施設(培/餌/繁/加/射)   生産   在庫     戦果   E[pw]  深度 残時間')
  while (s.phase !== 'over' && s.t < 600) {
    tick(s, input, cfg)
    if (s.pendingDraft) applyDraft(s, cfg, pickDraft(s, cfg, chooser))
    if (Math.round(s.t / dt) % cfg.tickHz === 0)
      autoBuy(s, cfg, ratio, cultureRate(s) + clickEV(s, cfg) * input.clicksPerSec)
    if (s.t >= nextLog) {
      nextLog += 10
      console.log(
        `${s.t.toFixed(0).padStart(4)}  ${s.phase.padEnd(9)} ${fmt(s.culture).padStart(8)}  ` +
          `${s.buildings.join('/').padStart(16)}  ` +
          `${fmt(s.producedTotal).padStart(6)} ${fmt(totalSharks(s.inv)).padStart(6)} ` +
          `${fmt(s.score).padStart(8)} ` +
          `${fmt(expectedPower(s.ranks, cfg)).padStart(7)}  ${String(s.depth).padStart(3)} ${s.timeLeft.toFixed(0).padStart(5)}`,
      )
    }
  }
  console.log(`\n  終了: t=${mmss(s.t)} 突破深度=${s.clearedDepth} ドラフト回数=${s.draftCount}`)
}
