import type { Config } from './config.ts'
import { BUILDING_INDEX, type BuildingId } from './buildings.ts'
import { assignSlot, MUTATIONS, MUTATION_BY_ID, type MutationDef, mutationName } from './mutations.ts'
import { fill, t } from '../text/index.ts'
import { type GameState, pushLog, refreshBirthDist, type RiskTimer, rng } from './state.ts'

// prettier-ignore
export type RiskId =
  | 'jamming' | 'falsify' | 'borrow'
  | 'overdose' | 'overdrive' | 'cannibal'
  | 'forbidden' | 'unapproved' | 'runaway'

/**
 * 侵略中のリスク付きカード。ボス撃破時と予備電源の発動時に提示する。
 *
 * 代償は必ず割合で払わせる。固定値だと後半にタダ同然になるため。
 * また在庫の割合で払わせてはならない。投入速度が生産を上回る間は在庫が毎ティック空になり、
 * 代償も見返りも 0 になる（実測で序盤〜中盤の大半がこの状態）。
 */
export type RiskDef = {
  id: RiskId
  /** 表示用。数値は下の定数から埋める */
  cost: string
  gain: string
  /** 代償か見返りが 0 になる状況では出さない */
  available: (s: GameState) => boolean
  apply: (s: GameState, cfg: Config) => void
}

const JAMMING = { time: 10, sec: 30, sharkRate: 0.5 }
const FALSIFY = { time: 15, budget: 0.75 }
const BORROW = { time: 20, bonusMult: 0.5 }
const OVERDOSE = { sec: 20, up: 2, down: 0.5 }
const OVERDRIVE = { sec: 15, launch: 3, lose: 0.3 }
const CANNIBAL = { power: 1.3, lose: 0.3 }
const UNAPPROVED = { rate: 0.8 }
const RUNAWAY = { rate: 3, failMin: 0.1, failMax: 0.6 }

function owned(s: GameState, id: BuildingId): number {
  const i = BUILDING_INDEX.get(id)
  return i === undefined ? 0 : s.buildings[i]
}

/** 施設を割合で失う。端数は切り上げて、1 個でも持っていれば必ず減らす */
function demolish(s: GameState, id: BuildingId, ratio: number): void {
  const i = BUILDING_INDEX.get(id)
  if (i === undefined) return
  s.buildings[i] -= Math.ceil(s.buildings[i] * ratio)
}

function addTimer(s: GameState, kind: RiskTimer['kind'], mult: number, from: number, sec: number): void {
  s.risk.timers.push({ kind, mult, from, until: from + sec })
}

function pick<T>(s: GameState, list: readonly T[]): T {
  return list[Math.floor(rng(s) * list.length)]
}

function ownedMutations(s: GameState): MutationDef[] {
  return [...s.ranks.keys()].map((id) => MUTATION_BY_ID.get(id)!)
}

function unownedRares(s: GameState): MutationDef[] {
  return MUTATIONS.filter(
    (m) =>
      s.meta.families.has(m.family) &&
      (m.rarity === 'rare' || m.rarity === 'legendary') &&
      (s.ranks.get(m.id) ?? 0) === 0,
  )
}

export const RISKS: RiskDef[] = [
  // --- 時間を買う ---
  {
    id: 'jamming',
    cost: fill(t.risk.jamming.cost, { sec: JAMMING.sec, pct: 100 - JAMMING.sharkRate * 100 }),
    gain: fill(t.risk.jamming.gain, { time: JAMMING.time }),
    available: () => true,
    apply: (s) => {
      s.timeLeft += JAMMING.time
      addTimer(s, 'sharkRate', JAMMING.sharkRate, s.t, JAMMING.sec)
    },
  },
  {
    id: 'falsify',
    cost: fill(t.risk.falsify.cost, { pct: 100 - FALSIFY.budget * 100 }),
    gain: fill(t.risk.falsify.gain, { time: FALSIFY.time }),
    available: () => true,
    apply: (s) => {
      s.timeLeft += FALSIFY.time
      s.risk.budgetMult *= FALSIFY.budget
    },
  },
  {
    id: 'borrow',
    // 継ぎ足しの秒数は Config にあるので、文言は提示時に埋め直す（riskCost）
    cost: t.risk.borrow.cost,
    gain: fill(t.risk.borrow.gain, { time: BORROW.time }),
    available: () => true,
    apply: (s) => {
      s.timeLeft += BORROW.time
      s.risk.depthBonusMult *= BORROW.bonusMult
    },
  },

  // --- 火力を買う ---
  {
    id: 'overdose',
    cost: fill(t.risk.overdose.cost, { sec: OVERDOSE.sec, down: OVERDOSE.down }),
    gain: fill(t.risk.overdose.gain, { sec: OVERDOSE.sec, up: OVERDOSE.up }),
    available: () => true,
    apply: (s) => {
      addTimer(s, 'power', OVERDOSE.up, s.t, OVERDOSE.sec)
      addTimer(s, 'power', OVERDOSE.down, s.t + OVERDOSE.sec, OVERDOSE.sec)
    },
  },
  {
    id: 'overdrive',
    cost: fill(t.risk.overdrive.cost, { pct: OVERDRIVE.lose * 100 }),
    gain: fill(t.risk.overdrive.gain, { sec: OVERDRIVE.sec, mult: OVERDRIVE.launch }),
    available: (s) => owned(s, 'launcher') > 0,
    apply: (s) => {
      demolish(s, 'launcher', OVERDRIVE.lose)
      addTimer(s, 'launch', OVERDRIVE.launch, s.t, OVERDRIVE.sec)
    },
  },
  {
    id: 'cannibal',
    cost: fill(t.risk.cannibal.cost, { pct: CANNIBAL.lose * 100 }),
    gain: fill(t.risk.cannibal.gain, { mult: CANNIBAL.power }),
    available: (s) => owned(s, 'breeder') > 0,
    apply: (s) => {
      demolish(s, 'breeder', CANNIBAL.lose)
      s.risk.powerMult *= CANNIBAL.power
    },
  },

  // --- 変異を賭ける ---
  {
    id: 'forbidden',
    cost: t.risk.forbidden.cost,
    gain: t.risk.forbidden.gain,
    // 上げる側と下げる側で別の変異が要る。上げる側はランク上限未満に限る
    available: (s) => s.ranks.size >= 2 && ownedMutations(s).some((m) => s.ranks.get(m.id)! < s.meta.maxRank),
    apply: (s, cfg) => {
      const gained = pick(
        s,
        ownedMutations(s).filter((m) => s.ranks.get(m.id)! < s.meta.maxRank),
      )
      const lost = pick(
        s,
        ownedMutations(s).filter((m) => m.id !== gained.id),
      )
      const gainedRank = s.ranks.get(gained.id)! + 1
      const lostRank = s.ranks.get(lost.id)! - 1
      s.ranks.set(gained.id, gainedRank)
      // ランク 0 は「持っていない」と同じ。派生種の材料なら、以降は派生種が生まれなくなる
      if (lostRank <= 0) s.ranks.delete(lost.id)
      else s.ranks.set(lost.id, lostRank)
      refreshBirthDist(s, cfg)
      const names = { lost: mutationName(lost), gained: mutationName(gained), lostRank, gainedRank }
      pushLog(s, 'risk', fill(lostRank <= 0 ? t.log.forbiddenLost : t.log.forbidden, names), [gained])
    },
  },
  {
    id: 'unapproved',
    cost: fill(t.risk.unapproved.cost, { mult: UNAPPROVED.rate }),
    gain: t.risk.unapproved.gain,
    available: (s) => unownedRares(s).length > 0,
    apply: (s, cfg) => {
      const m = pick(s, unownedRares(s))
      assignSlot(s.slots, m)
      s.ranks.set(m.id, 1)
      s.risk.rateMult *= UNAPPROVED.rate
      refreshBirthDist(s, cfg)
      pushLog(s, 'risk', fill(t.log.unapproved, { name: mutationName(m) }), [m])
    },
  },
  {
    id: 'runaway',
    cost: fill(t.risk.runaway.cost, { min: RUNAWAY.failMin * 100, max: RUNAWAY.failMax * 100 }),
    gain: fill(t.risk.runaway.gain, { mult: RUNAWAY.rate }),
    available: (s) => s.ranks.size > 0,
    apply: (s, cfg) => {
      // どの変異に当たるかと、失敗作の割合の 2 つの抽選で振れ幅を作る
      const m = pick(s, ownedMutations(s))
      s.risk.rateBoost.set(m.id, (s.risk.rateBoost.get(m.id) ?? 1) * RUNAWAY.rate)
      const fail = RUNAWAY.failMin + rng(s) * (RUNAWAY.failMax - RUNAWAY.failMin)
      s.risk.failRate = 1 - (1 - s.risk.failRate) * (1 - fail)
      refreshBirthDist(s, cfg)
      const text = fill(t.log.runaway, {
        name: mutationName(m),
        mult: RUNAWAY.rate,
        pct: Math.round(fail * 100),
      })
      pushLog(s, 'risk', text, [m])
    },
  },
]

/** 提示用の代償の文言。Config に依存するものだけここで埋める */
export function riskCost(def: RiskDef, cfg: Config): string {
  if (def.id !== 'borrow') return def.cost
  const from = cfg.invasion.runWideBonusPerDepth
  return fill(def.cost, { from, to: Math.floor(from * BORROW.bonusMult) })
}

export function riskName(def: { id: RiskId }): string {
  return t.risk[def.id].name
}

/** このランでまだ選んでおらず、いま効果のあるカードから無作為に引く */
export function rollRisks(s: GameState, cfg: Config): RiskDef[] {
  const pool = RISKS.filter((r) => !s.risk.taken.has(r.id) && r.available(s))
  const offers: RiskDef[] = []
  while (offers.length < Math.min(cfg.risk.draftSize, pool.length)) {
    const cand = pick(s, pool)
    if (!offers.includes(cand)) offers.push(cand)
  }
  return offers
}

export function applyRisk(s: GameState, cfg: Config, def: RiskDef): void {
  s.risk.taken.add(def.id)
  pushLog(s, 'risk', fill(t.log.risk, { name: riskName(def) }))
  def.apply(s, cfg)
}

/** いま効いている倍率。時間限定のものと、ラン終了まで続くもの（戦闘力のみ）を掛け合わせる */
export function riskMult(s: GameState, kind: RiskTimer['kind']): number {
  let m = kind === 'power' ? s.risk.powerMult : 1
  for (const x of s.risk.timers) if (x.kind === kind && s.t >= x.from && s.t < x.until) m *= x.mult
  return m
}
