import type { Config } from './config.ts'
import { BUILDINGS, BUILDING_INDEX } from './buildings.ts'
import { type MetaEffects, metaEffects, createMeta } from './meta.ts'
import type { Inventory } from './inventory.ts'
import {
  type MutationDef,
  type MutationId,
  type MutationMask,
  type MutationRanks,
  type MutationSlots,
  type PowerCache,
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

export type PendingDraft =
  { kind: 'mutation'; offers: MutationDef[] } | { kind: 'policy'; offers: PolicyDef[] }

export type LogKind = 'hit' | 'boss' | 'depth' | 'draft' | 'policy' | 'system' | 'birth' | 'record'
/** mutations を持つ行は、その組み合わせのサメを添えて表示する */
export type LogEntry = { t: number; kind: LogKind; text: string; mutations?: readonly MutationDef[] }

/** ログの保持件数。表示に使うぶんだけあればよい */
const LOG_LIMIT = 40

export function pushLog(s: GameState, kind: LogKind, text: string, mutations?: readonly MutationDef[]): void {
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
   * 突然変異と研究方針が同時に条件を満たした場合、片方は次のティックまで待つ。
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
  s.birthDist = birthDistribution(s.slots, s.ranks, cfg)
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
