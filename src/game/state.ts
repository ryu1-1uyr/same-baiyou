import type { Config } from './config.ts'
import { BUILDINGS, BUILDING_INDEX } from './buildings.ts'
import { type MetaEffects, metaEffects, createMeta } from './meta.ts'
import type { DerivedDef, DerivedId } from './derived.ts'
import type { Inventory } from './inventory.ts'
import type { RiskDef, RiskId } from './risks.ts'
import {
  type MutationDef,
  type MutationId,
  type MutationMask,
  type MutationRanks,
  type MutationSlots,
  type PowerCache,
  type SharkPart,
  birthDistribution,
  createSlots,
} from './mutations.ts'
import {
  EMPTY_POLICY_EFFECTS,
  type PolicyDef,
  type PolicyEffects,
  type PolicyId,
  type PolicyRanks,
  policyEffects,
} from './policies.ts'

export type Phase = 'culture' | 'invasion' | 'over'

/** リスクカードが出た場面 */
export type RiskReason = 'boss' | 'reserve'

/** 突然変異のドラフトには、条件を満たした派生種のカードが並ぶことがある */
export type PendingDraft =
  | { kind: 'mutation'; offers: MutationDef[]; derived: DerivedDef[] }
  | { kind: 'policy'; offers: PolicyDef[] }
  | { kind: 'risk'; offers: RiskDef[]; reason: RiskReason }

/** リスクカードの時間限定の効果。ゲーム内秒の [from, until) の間だけ効く */
export type RiskTimer = { kind: 'power' | 'launch' | 'sharkRate'; mult: number; from: number; until: number }

/** リスクカードの状態と、ラン終了まで続く効果 */
export type RiskState = {
  /** 提示待ち。ボス撃破と予備電源の発動で積み、ドラフトの後に 1 枚ずつ出す */
  queue: RiskReason[]
  /** このランで選んだカード。同じカードは二度と出ない */
  taken: Set<RiskId>
  skipsLeft: number
  timers: RiskTimer[]
  /** 全検体の戦闘力 */
  powerMult: number
  /** 全変異の発現率 */
  rateMult: number
  /** 変異ごとの発現率 */
  rateBoost: Map<MutationId, number>
  /** 生まれた検体のうち、在庫に入らない割合 */
  failRate: number
  /** ラン終了時の研究予算 */
  budgetMult: number
  /** 深度突破時の制限時間の継ぎ足し */
  depthBonusMult: number
}

export type LogKind = 'hit' | 'boss' | 'depth' | 'draft' | 'policy' | 'risk' | 'system' | 'birth' | 'record'
/** mutations を持つ行は、その組み合わせのサメを添えて表示する */
export type LogEntry = { t: number; kind: LogKind; text: string; mutations?: readonly SharkPart[] }

/** ログの保持件数。表示に使うぶんだけあればよい */
const LOG_LIMIT = 40

export function pushLog(s: GameState, kind: LogKind, text: string, mutations?: readonly SharkPart[]): void {
  s.log.unshift({ t: s.t, kind, text, mutations })
  if (s.log.length > LOG_LIMIT) s.log.length = LOG_LIMIT
}
export type EndReason = 'timeout' | 'running'

export type GameState = {
  /** 経過ゲーム内秒 */
  t: number
  phase: Phase
  endReason: EndReason

  culture: number
  /** BUILDINGS と同じ順の所持数 */
  buildings: number[]

  inv: Inventory
  /** 累計出生数。在庫と違い減らない（実験記録として表示する） */
  births: Map<MutationMask, number>
  ranks: MutationRanks
  /** このランで取った変異のビットの割り当て。在庫や出生の mask はこれで読む */
  slots: MutationSlots
  /** ranks が変わるたびに作り直す出生分布のキャッシュ */
  birthDist: Array<[MutationMask, number]>
  /** このランで生まれた個体の、変異数の最高記録 */
  bestTraits: number
  /**
   * 直近で実際に出撃した数（毎秒）。
   * 名目の投入速度は在庫が足りないと出しきれないので、
   * 描画側が実態どおりに見せるためにこちらを使う。
   */
  launchedPerSec: number
  /** mask ごとの戦闘力。ドラフトでランクが動いたときだけ捨てる */
  powerCache: PowerCache

  /** サメの累計生産数。ドラフトのトリガー */
  producedTotal: number
  nextDraftAt: number
  draftCount: number
  /**
   * ドラフト提示中。null 以外の間はゲームが進行しない（プレイヤーの選択待ち）。
   * 複数が同時に条件を満たした場合は 突然変異 → リスクカード → 研究方針 の順に 1 つずつ出す。
   */
  pendingDraft: PendingDraft | null

  /** 研究方針 */
  policies: PolicyRanks
  policyFx: PolicyEffects
  /** 累計で獲得した培養液。研究方針のしきい値に使う */
  cultureTotal: number
  nextPolicyAt: number
  policyCount: number

  /** 現在挑戦中の深度 */
  depth: number
  /** 現深度で破壊した通常建築物の数 */
  destroyed: number
  onBoss: boolean
  currentHp: number
  /** いま挑んでいる標的の名前。深度に入るたびにプールから引く */
  normalName: string
  bossName: string

  timeLeft: number
  /** 突破し終えた深度の数 */
  clearedDepth: number
  score: number

  rngState: number

  /** 交戦ログ。新しいものが先頭。表示用なので上限を設けて捨てる */
  log: LogEntry[]

  /** 恒久強化の効果。ラン中は変化しない */
  meta: MetaEffects
  /** 残りの引き直し回数 */
  rerollsLeft: number
  /** 予備電源を使ったか */
  reserveUsed: boolean
  /** 確定の提示を済ませた派生種。取らなかったものは以降、通常の抽選に混ざる */
  derivedOffered: Set<DerivedId>
  risk: RiskState
}

export function createState(cfg: Config, seed: number, meta?: MetaEffects): GameState {
  const eff = meta ?? metaEffects(createMeta())
  const s: GameState = {
    t: 0,
    phase: 'culture',
    endReason: 'running',
    culture: 0,
    buildings: BUILDINGS.map(() => 0),
    inv: new Map(),
    births: new Map(),
    ranks: new Map<MutationId, number>(),
    slots: createSlots(),
    birthDist: [[0, 1]],
    bestTraits: 0,
    launchedPerSec: 0,
    powerCache: new Map(),
    producedTotal: 0,
    nextDraftAt: eff.earlyDraft ? 10 : cfg.mutation.draftThresholdBase,
    draftCount: 0,
    pendingDraft: null,
    policies: new Map<PolicyId, number>(),
    policyFx: EMPTY_POLICY_EFFECTS,
    cultureTotal: 0,
    nextPolicyAt: cfg.policy.thresholdBase,
    policyCount: 0,
    depth: 1,
    destroyed: 0,
    onBoss: false,
    currentHp: 0,
    normalName: '',
    bossName: '',
    timeLeft: 0,
    clearedDepth: 0,
    score: 0,
    rngState: seed >>> 0,
    log: [],
    meta: eff,
    rerollsLeft: eff.rerolls,
    reserveUsed: false,
    derivedOffered: new Set(),
    risk: {
      queue: [],
      taken: new Set(),
      skipsLeft: eff.skips,
      timers: [],
      powerMult: 1,
      rateMult: 1,
      rateBoost: new Map(),
      failRate: 0,
      budgetMult: 1,
      depthBonusMult: 1,
    },
  }

  // 恒久強化ぶんの初期値を積む
  const tankIndex = BUILDING_INDEX.get('tank')
  if (tankIndex !== undefined) s.buildings[tankIndex] = cfg.start.tanks + eff.startTanks
  if (eff.startSharks > 0) {
    s.inv.set(0, eff.startSharks)
    s.births.set(0, eff.startSharks)
    s.producedTotal = eff.startSharks
  }
  return s
}

export function refreshBirthDist(s: GameState, cfg: Config): void {
  s.birthDist = birthDistribution(
    s.slots,
    s.ranks,
    cfg,
    (id) => s.risk.rateMult * (s.risk.rateBoost.get(id) ?? 1),
  )
  // 戦闘力はランクが動いたときだけ変わる。ここで捨てれば次から積み直される
  s.powerCache.clear()
}

/** mulberry32。再現性のある擬似乱数 */
export function rng(s: GameState): number {
  s.rngState = (s.rngState + 0x6d2b79f5) >>> 0
  let t = s.rngState
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function refreshPolicyFx(s: GameState): void {
  s.policyFx = policyEffects(s.policies)
}
