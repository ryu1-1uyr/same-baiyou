import { useEffect, useRef } from 'react'
import { stopBgm, updateBgm } from '../audio/bgm.ts'
import { playSe } from '../audio/se.ts'
import type { GameState } from '../game/state.ts'
import { getScreen } from '../store/gameStore.ts'
import { useGame } from './useGame.ts'

/** 深度が反転する境目。bgm.ts / atmosphere.ts と同じ値 */
const BREACH_DEPTH = 11

/** 残り時間がこれを切ると、BGM の脈が速くなり始める */
const DANGER_SEC = 30

type Watch = {
  /** ラン開始で作り直されるので、同一性の判定に使う */
  state: GameState
  depth: number
  onBoss: boolean
  bestTraits: number
  hasDraft: boolean
  reserveUsed: boolean
  over: boolean
}

function snapshot(s: GameState): Watch {
  return {
    state: s,
    depth: s.depth,
    onBoss: s.onBoss,
    bestTraits: s.bestTraits,
    hasDraft: s.pendingDraft !== null,
    reserveUsed: s.reserveUsed,
    over: s.phase === 'over',
  }
}

/**
 * ゲームの状態変化を音に変換する。
 *
 * ログの文言を読むのではなく状態の差分を見るのは、文言が変わっても壊れないため。
 * ここは音を鳴らすだけで、ゲームロジックには一切触らない。
 * 手動採取や購入のように状態からは拾えない操作は、それぞれの UI から直接鳴らす。
 */
export function useSound(): void {
  const s = useGame()
  const prev = useRef<Watch | null>(null)

  useEffect(() => {
    const p = prev.current
    prev.current = snapshot(s)

    // 初回と、ランが差し替わった直後は鳴らさない（前の状態と比べる意味がないため）
    if (p && p.state === s) {
      if (s.depth > p.depth) playSe(s.depth === BREACH_DEPTH ? 'breach' : 'depth')
      if (s.onBoss && !p.onBoss) playSe('bossAppear')
      if (!s.onBoss && p.onBoss && s.depth > p.depth) playSe('bossDown')
      if (s.bestTraits > p.bestTraits) playSe('record')
      if (s.pendingDraft !== null && !p.hasDraft) playSe('draft')
      if (s.reserveUsed && !p.reserveUsed) playSe('alert')
      if (s.phase === 'over' && !p.over) playSe('beam')
    }

    // タイトルではまだランが始まっていない
    if (s.phase === 'over' || getScreen() === 'title') {
      stopBgm()
      return
    }
    updateBgm({
      depth: s.depth,
      mood: s.phase === 'invasion' ? 'tense' : 'calm',
      danger: s.phase === 'invasion' ? Math.min(1, Math.max(0, 1 - s.timeLeft / DANGER_SEC)) : 0,
    })
  })
}
