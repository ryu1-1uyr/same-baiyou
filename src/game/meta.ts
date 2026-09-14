import type { Config } from './config.ts'
import { type Family, FAMILIES, familyName, type MutationId } from './mutations.ts'
import { fill, t, type Text } from '../text/index.ts'

/** 節の id は辞書のキーと 1 対 1。辞書に無い id はコンパイルで落ちる */
export type UpgradeId = keyof Text['upgrade']
export type UnlockId = keyof Text['unlock']

/**
 * 恒久強化。ラン終了時に得た研究予算で買い、次のラン以降に永続する。
 *
 * 3 系統に分ける。
 *   数値強化   … レベル制。コストが等比で伸びる
 *   系統解禁   … 買い切り。ドラフトに出る変異が増える（ローグライトとしての主軸）
 *   利便性     … 買い切り。倍速や自動化
 */

export type MetaState = {
  /** 未使用の研究予算 */
  budget: number
  /** 累計獲得（実績表示用） */
  lifetimeBudget: number
  runs: number
  bestDepth: number
  /** 数値強化のレベル */
  levels: Record<string, number>
  /** 買い切りで取得済みの ID */
  unlocked: string[]
  /** 図鑑に載せた原種の ID（codex.ts） */
  discovered: string[]
  /** 図鑑で研究予算を受け取り済みの原種の ID */
  claimed: string[]
  /** 図鑑で開いた派生種のヒント（`派生種:材料`） */
  hints: string[]
}

export function createMeta(): MetaState {
  return {
    budget: 0,
    lifetimeBudget: 0,
    runs: 0,
    bestDepth: 0,
    levels: {},
    unlocked: [],
    discovered: [],
    claimed: [],
    hints: [],
  }
}

// ---------------------------------------------------------------------------
// 数値強化
// ---------------------------------------------------------------------------

export type NumericUpgrade = {
  id: UpgradeId
  /** レベル lv のときの効果説明。文言は text/ja.ts、数式はここ */
  detail: (lv: number) => string
  baseCost: number
  costGrowth: number
  /** Infinity なら上限なし */
  maxLevel: number
}

export const NUMERIC_UPGRADES: NumericUpgrade[] = [
  {
    id: 'clickPower',
    detail: (lv) => fill(t.upgrade.clickPower.detail, { mult: (1 + 0.3 * lv).toFixed(1) }),
    baseCost: 20,
    costGrowth: 1.9,
    maxLevel: 20,
  },
  {
    id: 'extraReroll',
    detail: (lv) => fill(t.upgrade.extraReroll.detail, { n: 1 + lv }),
    baseCost: 3000,
    costGrowth: 2.1,
    maxLevel: 9,
  },
  {
    id: 'critChance',
    detail: (lv) => fill(t.upgrade.critChance.detail, { pct: 5 * lv }),
    baseCost: 120,
    costGrowth: 1.9,
    maxLevel: 10,
  },
  {
    id: 'critPower',
    detail: (lv) => fill(t.upgrade.critPower.detail, { mult: (2 + 0.7 * lv).toFixed(1) }),
    baseCost: 400,
    costGrowth: 2.0,
    maxLevel: 10,
  },
  {
    id: 'startTanks',
    detail: (lv) => fill(t.upgrade.startTanks.detail, { n: lv }),
    baseCost: 30,
    costGrowth: 2.2,
    maxLevel: 12,
  },
  {
    id: 'cultureRate',
    detail: (lv) => fill(t.upgrade.cultureRate.detail, { mult: (1 + 0.25 * lv).toFixed(2) }),
    baseCost: 40,
    costGrowth: 2.0,
    maxLevel: 20,
  },
  {
    id: 'sharkRate',
    detail: (lv) => fill(t.upgrade.sharkRate.detail, { mult: (1 + 0.25 * lv).toFixed(2) }),
    baseCost: 60,
    costGrowth: 2.0,
    maxLevel: 20,
  },
  {
    id: 'startSharks',
    detail: (lv) => fill(t.upgrade.startSharks.detail, { n: lv * 25 }),
    baseCost: 80,
    costGrowth: 2.3,
    maxLevel: 15,
  },
  {
    id: 'launchRate',
    detail: (lv) => fill(t.upgrade.launchRate.detail, { mult: (1 + 0.2 * lv).toFixed(2) }),
    baseCost: 120,
    costGrowth: 2.1,
    maxLevel: 15,
  },
  {
    id: 'sharkPower',
    detail: (lv) => fill(t.upgrade.sharkPower.detail, { mult: (1 + 0.4 * lv).toFixed(1) }),
    baseCost: 200,
    costGrowth: 2.6,
    maxLevel: 25,
  },
]

/**
 * 上限のない強化。
 *
 * 到達深度が頭打ちになると研究予算だけが増え続けて使い道がなくなる。
 * 際限なく積める行き先を用意して、余った予算が腐らないようにする。
 * 積み上げるとゲームバランスは壊れるが、それは織り込みで許容している。
 *
 * コストの伸びを他より緩く（1.55）しているのは、1 ラン ぶんの予算で
 * まとまった段数が買えるようにするため。1 段ずつしか進まないと
 * 「予算を使い切った」感触が出ない。
 */
export const ENDLESS_UPGRADES: NumericUpgrade[] = [
  {
    id: 'endlessCulture',
    detail: (lv) => fill(t.upgrade.endlessCulture.detail, { mult: (1 + 0.5 * lv).toFixed(1) }),
    baseCost: 30000,
    costGrowth: 1.55,
    maxLevel: Infinity,
  },
  {
    id: 'endlessBreed',
    detail: (lv) => fill(t.upgrade.endlessBreed.detail, { mult: (1 + 0.5 * lv).toFixed(1) }),
    baseCost: 40000,
    costGrowth: 1.55,
    maxLevel: Infinity,
  },
  {
    id: 'endlessLaunch',
    detail: (lv) => fill(t.upgrade.endlessLaunch.detail, { mult: (1 + 0.5 * lv).toFixed(1) }),
    baseCost: 60000,
    costGrowth: 1.55,
    maxLevel: Infinity,
  },
  {
    id: 'endlessPower',
    detail: (lv) => fill(t.upgrade.endlessPower.detail, { mult: (1 + 1.0 * lv).toFixed(1) }),
    baseCost: 120000,
    costGrowth: 1.6,
    maxLevel: Infinity,
  },
]

NUMERIC_UPGRADES.push(...ENDLESS_UPGRADES)

export const NUMERIC_BY_ID = new Map<string, NumericUpgrade>(NUMERIC_UPGRADES.map((u) => [u.id, u]))

export function upgradeCost(u: NumericUpgrade, level: number): number {
  return Math.floor(u.baseCost * Math.pow(u.costGrowth, level))
}

// ---------------------------------------------------------------------------
// 買い切り（系統解禁 / 利便性）
// ---------------------------------------------------------------------------

export type UnlockDef = {
  id: UnlockId
  cost: number
  kind: 'family' | 'qol' | 'unique'
  family?: Family
  /** これを買っていないと解禁されない */
  requires?: string
}

export const UNLOCKS: UnlockDef[] = [
  {
    id: 'family_abyss',
    cost: 500,
    kind: 'family',
    family: 'abyss',
  },
  {
    id: 'family_mech',
    cost: 2500,
    kind: 'family',
    family: 'mech',
    requires: 'family_abyss',
  },
  {
    id: 'family_cosmic',
    cost: 15000,
    kind: 'family',
    family: 'cosmic',
    requires: 'family_mech',
  },
  {
    id: 'family_disaster',
    cost: 40000,
    kind: 'family',
    family: 'disaster',
    requires: 'family_cosmic',
  },
  { id: 'speed2', cost: 300, kind: 'qol' },
  {
    id: 'doubleClick',
    cost: 700,
    kind: 'unique',
  },
  {
    id: 'autoBuyOne',
    cost: 1200,
    kind: 'qol',
  },
  {
    id: 'analysis',
    cost: 400,
    kind: 'unique',
  },
  {
    id: 'reroll',
    cost: 1500,
    kind: 'unique',
  },
  {
    id: 'earlyDraft',
    cost: 2200,
    kind: 'unique',
  },
  {
    id: 'lastStand',
    cost: 2800,
    kind: 'unique',
  },
  {
    id: 'reservePower',
    cost: 4000,
    kind: 'unique',
  },
  {
    id: 'extraOffer',
    cost: 5000,
    kind: 'unique',
  },
  {
    id: 'chainCollapse',
    cost: 7000,
    kind: 'unique',
  },
  {
    id: 'prototype',
    cost: 20000,
    kind: 'unique',
  },
  {
    id: 'tankSynergy',
    cost: 1000,
    kind: 'unique',
  },
  {
    id: 'feederSynergy',
    cost: 1800,
    kind: 'unique',
  },
  {
    id: 'breederSynergy',
    cost: 2600,
    kind: 'unique',
  },
  {
    id: 'launcherSynergy',
    cost: 3600,
    kind: 'unique',
  },
  {
    id: 'autoClick',
    cost: 900,
    kind: 'qol',
  },
  {
    id: 'speed4',
    cost: 2000,
    kind: 'qol',
    requires: 'speed2',
  },
  {
    id: 'autoBuyAll',
    cost: 12000,
    kind: 'qol',
    requires: 'autoBuyOne',
  },
  // 派生種の解禁。系統をすべて解禁した先に置く。コストは試遊前の仮の値
  { id: 'derived_1', cost: 60000, kind: 'unique', requires: 'family_disaster' },
  { id: 'derived_2', cost: 200000, kind: 'unique', requires: 'derived_1' },
  { id: 'derived_3', cost: 800000, kind: 'unique', requires: 'derived_2' },
]

export const UNLOCK_BY_ID = new Map<string, UnlockDef>(UNLOCKS.map((u) => [u.id, u]))

// ---------------------------------------------------------------------------
// 効果の集計
// ---------------------------------------------------------------------------

export type MetaEffects = {
  startTanks: number
  startSharks: number
  clickMult: number
  /** 手動採取が会心する確率。研究方針「過剰採取」と加算される */
  critChance: number
  /** 会心したときの倍率 */
  critMult: number
  cultureMult: number
  sharkRateMult: number
  launchMult: number
  powerMult: number
  families: Set<Family>
  maxSpeed: 1 | 2 | 4
  /** 設備を 1 種類だけ自動購入できる */
  autoBuyOne: boolean
  /** 買える設備をすべて自動購入する */
  autoBuyAll: boolean
  /** 毎秒の自動クリック回数 */
  autoClick: number
  /**
   * 設備の所持数に応じて効果が伸びる強化。
   * 所持数はラン中に変わるため、固定倍率とは別に tick 側で適用する。
   */
  tankSynergy: boolean
  feederSynergy: boolean
  breederSynergy: boolean
  launcherSynergy: boolean

  /** 最初のドラフトが早く訪れる */
  earlyDraft: boolean
  /** ドラフトの提示枚数への加算 */
  extraOffers: number
  /** 突然変異の発現率と戦闘力倍率を表示してよいか */
  showNumbers: boolean
  /** 1 ラン に使えるドラフトの引き直し回数 */
  rerolls: number
  /** 変異のランク上限 */
  maxRank: number
  /** 制限時間切れを 1 回だけ猶予する秒数。0 なら無効 */
  reserveSeconds: number
  /** 建物破壊時の余剰ダメージ倍率 */
  overkillMult: number
  /** ラン終了時に在庫をすべて投入する */
  lastStand: boolean
  /** 作れる派生種の段。0 なら派生種は出ない */
  derivedTier: 0 | 1 | 2 | 3
}

export function metaEffects(m: MetaState): MetaEffects {
  const lv = (id: string) => m.levels[id] ?? 0
  const has = (id: string) => m.unlocked.includes(id)

  const families = new Set<Family>()
  for (const [id, f] of Object.entries(FAMILIES)) {
    if (f.initial) families.add(id as Family)
  }
  for (const u of UNLOCKS) {
    if (u.kind === 'family' && u.family && has(u.id)) families.add(u.family)
  }

  return {
    startTanks: lv('startTanks'),
    startSharks: lv('startSharks') * 25,
    clickMult: (1 + 0.3 * lv('clickPower')) * (has('doubleClick') ? 2 : 1),
    critChance: 0.05 * lv('critChance'),
    critMult: 2 + 0.7 * lv('critPower'),
    cultureMult: (1 + 0.25 * lv('cultureRate')) * (1 + 0.5 * lv('endlessCulture')),
    sharkRateMult: (1 + 0.25 * lv('sharkRate')) * (1 + 0.5 * lv('endlessBreed')),
    launchMult: (1 + 0.2 * lv('launchRate')) * (1 + 0.5 * lv('endlessLaunch')),
    powerMult: (1 + 0.4 * lv('sharkPower')) * (1 + 1.0 * lv('endlessPower')),
    families,
    maxSpeed: has('speed4') ? 4 : has('speed2') ? 2 : 1,
    autoBuyOne: has('autoBuyOne'),
    autoBuyAll: has('autoBuyAll'),
    autoClick: has('autoClick') ? 5 : 0,
    tankSynergy: has('tankSynergy'),
    feederSynergy: has('feederSynergy'),
    breederSynergy: has('breederSynergy'),
    launcherSynergy: has('launcherSynergy'),
    earlyDraft: has('earlyDraft'),
    extraOffers: has('extraOffer') ? 1 : 0,
    showNumbers: has('analysis'),
    rerolls: has('reroll') ? 1 + lv('extraReroll') : 0,
    maxRank: has('prototype') ? 4 : 3,
    reserveSeconds: has('reservePower') ? 20 : 0,
    overkillMult: has('chainCollapse') ? 2 : 1,
    lastStand: has('lastStand'),
    derivedTier: has('derived_3') ? 3 : has('derived_2') ? 2 : has('derived_1') ? 1 : 0,
  }
}

/** 基礎戦闘力の倍率は Config に焼き込む。これで戦闘力の計算式を触らずに済む */
export function applyMetaToConfig(cfg: Config, e: MetaEffects): Config {
  return { ...cfg, shark: { ...cfg.shark, basePower: cfg.shark.basePower * e.powerMult } }
}

// ---------------------------------------------------------------------------
// 報酬
// ---------------------------------------------------------------------------

/**
 * ラン終了時の研究予算。
 *
 * 総戦果は hpGrowth に引きずられて深度ごとに約 5 倍になるため、
 * そのまま比例させると深度 1 つで収入が 5 倍になってインフレする。
 * 平方根で潰したうえで、到達深度ボーナスを乗算で乗せる。
 *
 * 係数 0.3 は実測で決めた。連続プレイのシミュレータで掃引したところ、
 * 0.1 では深度 2 に届くまで 13 ラン、0.8 では 3 ラン（進行が速すぎる）となり、
 * 0.3 で「初回は深度 1、3 ラン目で深度 2」に収まった。
 */
export const BUDGET_COEF = 0.3

export function budgetFor(score: number, clearedDepth: number): number {
  if (score <= 0) return 0
  return Math.floor(Math.sqrt(score) * BUDGET_COEF * (1 + 0.5 * clearedDepth))
}

// ---------------------------------------------------------------------------
// 購入
// ---------------------------------------------------------------------------

export function canBuyNumeric(m: MetaState, id: string): boolean {
  const u = NUMERIC_BY_ID.get(id)
  if (!u) return false
  if (!nodeUnlocked(m, id)) return false
  const lv = m.levels[id] ?? 0
  return lv < u.maxLevel && m.budget >= upgradeCost(u, lv)
}

export function buyNumeric(m: MetaState, id: string): boolean {
  if (!canBuyNumeric(m, id)) return false
  const u = NUMERIC_BY_ID.get(id)!
  const lv = m.levels[id] ?? 0
  m.budget -= upgradeCost(u, lv)
  m.levels[id] = lv + 1
  return true
}

export function unlockAvailable(m: MetaState, u: UnlockDef): boolean {
  if (m.unlocked.includes(u.id)) return false
  return nodeUnlocked(m, u.id)
}

export function buyUnlock(m: MetaState, id: string): boolean {
  const u = UNLOCK_BY_ID.get(id)
  if (!u || !unlockAvailable(m, u) || m.budget < u.cost) return false
  m.budget -= u.cost
  m.unlocked.push(u.id)
  return true
}

// ---------------------------------------------------------------------------
// スキルツリー
// ---------------------------------------------------------------------------

/**
 * 恒久強化を系統ごとの枝に並べ、前提を満たさないと先に進めないようにする。
 *
 * 平坦な一覧だと「安い順に全部買う」以外の遊び方が無く、
 * 何を伸ばしているのかがプレイヤーの中に残らない。
 * 枝に分けて前提を付けると、序盤にどの方向へ振るかが選択になる。
 */
export type BranchId = 'prod' | 'spec' | 'raid' | 'lab' | 'fam' | 'ops' | 'over'

export const BRANCHES = t.branch

export type TreeNode = {
  id: string
  branch: BranchId
  /** 表示上の列。枝が分かれるときだけずらす */
  col: number
  row: number
  /** すべて取得済みでないと購入できない */
  requires: string[]
  /** 節に添えるサメ。何が解禁されるのかを絵で示す */
  preview?: MutationId
}

export const TREE: TreeNode[] = [
  // 培養 — 培養液の生産量。ここだけ「自動で増やす」と「手で殴る」に分かれる
  { id: 'clickPower', branch: 'prod', col: 0, row: 0, requires: [] },
  { id: 'cultureRate', branch: 'prod', col: 0, row: 1, requires: ['clickPower'] },
  { id: 'doubleClick', branch: 'prod', col: 0, row: 2, requires: ['cultureRate'] },
  { id: 'tankSynergy', branch: 'prod', col: 0, row: 3, requires: ['doubleClick'] },
  { id: 'feederSynergy', branch: 'prod', col: 0, row: 4, requires: ['tankSynergy'] },
  { id: 'critChance', branch: 'prod', col: 1, row: 1, requires: ['clickPower'] },
  { id: 'critPower', branch: 'prod', col: 1, row: 2, requires: ['critChance'] },

  // 検体 — 生産速度と戦闘力
  { id: 'startTanks', branch: 'spec', col: 2, row: 0, requires: [] },
  { id: 'sharkRate', branch: 'spec', col: 2, row: 1, requires: ['startTanks'] },
  { id: 'startSharks', branch: 'spec', col: 2, row: 2, requires: ['sharkRate'] },
  { id: 'sharkPower', branch: 'spec', col: 2, row: 3, requires: ['startSharks'] },
  { id: 'breederSynergy', branch: 'spec', col: 2, row: 4, requires: ['sharkPower'] },

  // 侵略 — 投入速度と破壊
  { id: 'launchRate', branch: 'raid', col: 3, row: 0, requires: [] },
  { id: 'lastStand', branch: 'raid', col: 3, row: 1, requires: ['launchRate'] },
  { id: 'launcherSynergy', branch: 'raid', col: 3, row: 2, requires: ['lastStand'] },
  { id: 'reservePower', branch: 'raid', col: 3, row: 3, requires: ['launcherSynergy'] },
  { id: 'chainCollapse', branch: 'raid', col: 3, row: 4, requires: ['reservePower'] },

  // 実験 — ドラフトへの干渉。まず「測れるようにする」ところから始まる
  { id: 'analysis', branch: 'lab', col: 4, row: 0, requires: [] },
  { id: 'reroll', branch: 'lab', col: 4, row: 1, requires: ['analysis'] },
  { id: 'extraReroll', branch: 'lab', col: 4, row: 2, requires: ['reroll'] },
  { id: 'earlyDraft', branch: 'lab', col: 4, row: 3, requires: ['extraReroll'] },
  { id: 'extraOffer', branch: 'lab', col: 4, row: 4, requires: ['earlyDraft'] },
  { id: 'prototype', branch: 'lab', col: 4, row: 5, requires: ['extraOffer'] },

  // 系統 — 変異プールの拡張
  { id: 'family_abyss', branch: 'fam', col: 5, row: 0, requires: [], preview: 'tentacle' },
  { id: 'family_mech', branch: 'fam', col: 5, row: 1, requires: ['family_abyss'], preview: 'mecha' },
  { id: 'family_cosmic', branch: 'fam', col: 5, row: 2, requires: ['family_mech'], preview: 'alien' },
  { id: 'family_disaster', branch: 'fam', col: 5, row: 3, requires: ['family_cosmic'], preview: 'tornado' },
  { id: 'derived_1', branch: 'fam', col: 5, row: 4, requires: ['family_disaster'] },
  { id: 'derived_2', branch: 'fam', col: 5, row: 5, requires: ['derived_1'] },
  { id: 'derived_3', branch: 'fam', col: 5, row: 6, requires: ['derived_2'] },

  // 運用 — 周回の速度
  { id: 'speed2', branch: 'ops', col: 6, row: 0, requires: [] },
  { id: 'speed4', branch: 'ops', col: 7, row: 1, requires: ['speed2'] },
  { id: 'autoClick', branch: 'ops', col: 6, row: 1, requires: ['speed2'] },
  { id: 'autoBuyOne', branch: 'ops', col: 6, row: 2, requires: ['autoClick'] },
  { id: 'autoBuyAll', branch: 'ops', col: 6, row: 3, requires: ['autoBuyOne'] },

  // 超過 — 上限がない。予算が余り始めてからの行き先
  { id: 'endlessCulture', branch: 'over', col: 8, row: 0, requires: [] },
  { id: 'endlessBreed', branch: 'over', col: 8, row: 1, requires: ['endlessCulture'] },
  { id: 'endlessLaunch', branch: 'over', col: 9, row: 1, requires: ['endlessCulture'] },
  { id: 'endlessPower', branch: 'over', col: 8, row: 2, requires: ['endlessBreed', 'endlessLaunch'] },
]

export const TREE_BY_ID = new Map(TREE.map((n) => [n.id, n]))

export type NodeKind = 'numeric' | 'unlock'

export function nodeKind(id: string): NodeKind {
  return NUMERIC_BY_ID.has(id) ? 'numeric' : 'unlock'
}

/** その節を「取得済み」とみなすか。レベル制は 1 段でも上げていれば取得済み */
export function nodeTaken(m: MetaState, id: string): boolean {
  return nodeKind(id) === 'numeric' ? (m.levels[id] ?? 0) > 0 : m.unlocked.includes(id)
}

/** 前提をすべて満たしているか */
export function nodeUnlocked(m: MetaState, id: string): boolean {
  const n = TREE_BY_ID.get(id)
  if (!n) return true
  return n.requires.every((r) => nodeTaken(m, r))
}

/** その節の次の 1 段にかかる費用。上限に達していれば null */
export function nodeCost(m: MetaState, id: string): number | null {
  if (nodeKind(id) === 'unlock') {
    const u = UNLOCK_BY_ID.get(id)
    if (!u || m.unlocked.includes(id)) return null
    return u.cost
  }
  const u = NUMERIC_BY_ID.get(id)
  if (!u) return null
  const lv = m.levels[id] ?? 0
  return lv >= u.maxLevel ? null : upgradeCost(u, lv)
}

export function nodeName(id: string): string {
  if (id in t.upgrade) return t.upgrade[id as UpgradeId].name
  if (id in t.unlock) return t.unlock[id as UnlockId].name
  return id
}

export function nodeDetail(m: MetaState, id: string): string {
  const n = NUMERIC_BY_ID.get(id)
  if (n) {
    const lv = m.levels[id] ?? 0
    return n.detail(Math.min(lv + 1, n.maxLevel))
  }
  return id in t.unlock ? t.unlock[id as UnlockId].detail : ''
}

/** 購入できるか。前提・上限・所持予算をすべて見る */
export function canPurchase(m: MetaState, id: string): boolean {
  if (!nodeUnlocked(m, id)) return false
  const cost = nodeCost(m, id)
  return cost !== null && m.budget >= cost
}

export function purchase(m: MetaState, id: string): boolean {
  if (!canPurchase(m, id)) return false
  return nodeKind(id) === 'numeric' ? buyNumeric(m, id) : buyUnlock(m, id)
}
