import { BUILDINGS, type BuildingDef, costOf } from '../game/buildings.ts'
import { type Config, DEFAULT_CONFIG } from '../game/config.ts'
import {
  applyMetaToConfig,
  budgetFor,
  buyNumeric,
  buyUnlock,
  purchase,
  type MetaState,
  metaEffects,
  NUMERIC_UPGRADES,
  UNLOCKS,
} from '../game/meta.ts'
import { createState, type GameState } from '../game/state.ts'
import { applyDraft, clickValue, critChance, critMult, rerollDraft, tick } from '../game/tick.ts'
import { loadMeta, resetMeta, saveMeta } from '../meta/save.ts'

/**
 * ゲーム状態は React の外に置き、useSyncExternalStore で購読する。
 * tick は 20Hz で回るが、React への通知は 10Hz に間引く。
 */

export type Speed = 1 | 2 | 4

export type Screen = 'title' | 'run' | 'lab'

let meta: MetaState = loadMeta()
const baseCfg: Config = DEFAULT_CONFIG
let cfg: Config = applyMetaToConfig(baseCfg, metaEffects(meta))
let state: GameState = createState(cfg, Math.floor(Math.random() * 1e9), metaEffects(meta))
let speed: Speed = 1
let version = 0
let running = false
let screen: Screen = 'title'
/** 直近のランで得た研究予算。リザルト表示に使う */
let lastAward = 0
/**
 * 自動発注の動作。
 *  off … 自分で買う
 *  one … 定期発注。指定した 1 種類だけを買う（購入配分の判断は残る）
 *  all … AI 発注。買える設備をすべて安い順に買う
 */
export type AutoBuyMode = 'off' | 'one' | 'all'
let autoBuyMode: AutoBuyMode = 'all'
/** 定期発注で自動購入する設備。BUILDINGS の添字。null なら未設定 */
let autoBuyTarget: number | null = null
/** このランの報酬を確定済みか */
let awarded = false

const listeners = new Set<() => void>()

function emit(): void {
  version += 1
  for (const l of listeners) l()
}

export function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function getVersion(): number {
  return version
}

export function getState(): GameState {
  return state
}

export function getConfig(): Config {
  return cfg
}

export function getSpeed(): Speed {
  return speed
}

export function setSpeed(s: Speed): void {
  if (s > metaEffects(meta).maxSpeed) return
  speed = s
  emit()
}

export function getMeta(): MetaState {
  return meta
}

export function getScreen(): Screen {
  return screen
}

export function setScreen(v: Screen): void {
  screen = v
  emit()
}

export function getLastAward(): number {
  return lastAward
}

/**
 * 実際に効く発注モード。
 * 未解禁のモードを選んだままになることがあるので、持っているものへ落とす。
 */
export function getAutoBuyMode(): AutoBuyMode {
  const m = state.meta
  if (autoBuyMode === 'all' && !m.autoBuyAll) return m.autoBuyOne ? 'one' : 'off'
  if (autoBuyMode === 'one' && !m.autoBuyOne) return 'off'
  return autoBuyMode
}

export function setAutoBuyMode(mode: AutoBuyMode): void {
  autoBuyMode = mode
  emit()
}

export function getAutoBuyTarget(): number | null {
  return autoBuyTarget
}

/** 同じ設備をもう一度指定すると解除する */
export function setAutoBuyTarget(index: number | null): void {
  autoBuyTarget = autoBuyTarget === index ? null : index
  // 対象を選ぶのは定期発注を使いたいということなので、モードも合わせる
  if (autoBuyTarget !== null && state.meta.autoBuyOne) autoBuyMode = 'one'
  emit()
}

/** スキルツリーの節を 1 段買う。レベル制と買い切りの区別は meta 側が持つ */
export function purchaseNode(id: string): void {
  if (purchase(meta, id)) {
    saveMeta(meta)
    emit()
  }
}

export function purchaseNumeric(id: string): void {
  if (buyNumeric(meta, id)) {
    saveMeta(meta)
    emit()
  }
}

export function purchaseUnlock(id: string): void {
  if (buyUnlock(meta, id)) {
    saveMeta(meta)
    emit()
  }
}

export function wipeMeta(): void {
  meta = resetMeta()
  startNewRun()
}

// --- プレイヤー操作 -------------------------------------------------------

/**
 * 手動採取。恒久強化「採取の勘」と研究方針「過剰採取」の合計確率で会心する。
 * 得た量と会心したかを返すので、呼び出し側が同じ計算をやり直さずに演出できる。
 */
export function manualClick(): { gained: number; crit: boolean } {
  if (state.phase === 'over' || state.pendingDraft) return { gained: 0, crit: false }
  const chance = critChance(state)
  const crit = chance > 0 && Math.random() < chance
  const gained = clickValue(state, cfg) * (crit ? critMult(state) : 1)
  state.culture += gained
  state.cultureTotal += gained
  emit()
  return { gained, crit }
}

export function canAfford(def: BuildingDef, owned: number): boolean {
  return state.culture >= costOf(def, owned)
}

/** 自動発注。動作は AutoBuyMode を参照 */
function runAutoBuy(): void {
  const mode = getAutoBuyMode()
  if (mode === 'all') {
    for (let guard = 0; guard < 60; guard++) {
      let best = -1
      let bestCost = Infinity
      for (let i = 0; i < BUILDINGS.length; i++) {
        const c = costOf(BUILDINGS[i], state.buildings[i])
        if (c <= state.culture && c < bestCost) {
          bestCost = c
          best = i
        }
      }
      if (best < 0) return
      state.culture -= bestCost
      state.buildings[best] += 1
    }
    return
  }

  if (mode === 'one' && autoBuyTarget !== null) {
    const i = autoBuyTarget
    for (let guard = 0; guard < 60; guard++) {
      const c = costOf(BUILDINGS[i], state.buildings[i])
      if (c > state.culture) return
      state.culture -= c
      state.buildings[i] += 1
    }
  }
}

export function buy(index: number): void {
  const def = BUILDINGS[index]
  const cost = costOf(def, state.buildings[index])
  if (state.culture < cost) return
  state.culture -= cost
  state.buildings[index] += 1
  emit()
}

export function reroll(): void {
  if (rerollDraft(state, cfg)) emit()
}

export function chooseDraft(index: number): void {
  applyDraft(state, cfg, index)
  emit()
}

export function startNewRun(): void {
  const eff = metaEffects(meta)
  cfg = applyMetaToConfig(baseCfg, eff)
  state = createState(cfg, Math.floor(Math.random() * 1e9), eff)
  speed = 1
  lastAward = 0
  awarded = false
  autoBuyTarget = null
  screen = 'run'
  emit()
}

/** ラン終了時に一度だけ呼ばれ、研究予算を確定する */
function awardRun(): void {
  lastAward = Math.floor(budgetFor(state.score, state.clearedDepth) * state.policyFx.budgetMult)
  meta.budget += lastAward
  meta.lifetimeBudget += lastAward
  meta.runs += 1
  meta.bestDepth = Math.max(meta.bestDepth, state.clearedDepth)
  saveMeta(meta)
}

// --- ゲームループ ---------------------------------------------------------

const TICK = 1 / DEFAULT_CONFIG.tickHz
const NOTIFY_INTERVAL = 0.1 // 10Hz

let acc = 0
let sinceNotify = 0
let last = 0

function frame(now: number): void {
  const rawDt = Math.min((now - last) / 1000, 0.25)
  last = now
  const dt = rawDt * speed
  acc += dt

  let ticked = false
  while (acc >= TICK) {
    acc -= TICK
    // タイトル表示中は培養フェーズの持ち時間を減らさない
    if (screen === 'title' || state.phase === 'over' || state.pendingDraft) {
      acc = 0
      break
    }
    tick(state, { clicksPerSec: 0 }, cfg)
    ticked = true
  }

  if (ticked) runAutoBuy()
  if (!awarded && getState().phase === 'over') {
    awarded = true
    awardRun()
  }

  sinceNotify += rawDt
  if (sinceNotify >= NOTIFY_INTERVAL || (ticked && state.pendingDraft) || state.phase === 'over') {
    sinceNotify = 0
    emit()
  }
  requestAnimationFrame(frame)
}

export function startLoop(): void {
  if (running) return
  running = true
  last = performance.now()
  requestAnimationFrame(frame)
}

// ---------------------------------------------------------------------------
// デバッグ用。import.meta.env.DEV が false の本番ビルドでは呼び出し元ごと消える
// ---------------------------------------------------------------------------

/** 研究予算を加算する */
export function debugGrant(amount: number): void {
  meta.budget += amount
  meta.lifetimeBudget += amount
  saveMeta(meta)
  emit()
}

/** 買い切りをすべて取得し、数値強化も最大まで上げる */
export function debugUnlockAll(): void {
  for (const u of UNLOCKS) {
    if (!meta.unlocked.includes(u.id)) meta.unlocked.push(u.id)
  }
  for (const u of NUMERIC_UPGRADES) meta.levels[u.id] = u.maxLevel
  saveMeta(meta)
  startNewRun()
}

/** 培養フェーズを飛ばして侵略に入る */
export function debugSkipCulture(): void {
  if (state.phase !== 'culture') return
  state.t = cfg.culturePhaseSec
  emit()
}

/** 培養液を加算する */
export function debugAddCulture(amount: number): void {
  state.culture += amount
  emit()
}

/** ランを即座に終了させる */
export function debugEndRun(): void {
  state.timeLeft = 0
  state.reserveUsed = true
  emit()
}
