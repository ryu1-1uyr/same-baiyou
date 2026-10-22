import { type GameState, pushLog } from '../game/state.ts'
import { t } from '../text/index.ts'

/**
 * チュートリアル（主任の通信）。仕様は TASKS.md §5.7。
 *
 * 台本どおりに進めず、仕組みが初めて登場した瞬間に 1 回だけ説明する。
 * ゲーム本体は UI を知らない作りなので、ここではストアから渡される状態を見張って
 * 「いまどの説明を出すか」だけを決める。どこまで見たかはセーブに残さない。
 */

export type TutorialStep =
  'culture' | 'build' | 'policy' | 'mutation' | 'invasion' | 'boss' | 'risk' | 'result' | 'lab'

/** ゲームを止めずに画面の端に出す通知（侵略開始・ボス）を出しておくゲーム内秒数 */
const INFO_SEC = 12

export type Tutorial = {
  active: boolean
  /**
   * チュートリアルの外でも 1 回だけ出す説明。
   * リスクカードは研究所で解禁するので初回ランには出ず、ここで出さないと説明する機会が無い
   */
  once: Set<TutorialStep>
  seen: Set<TutorialStep>
  /** 表示中の通知。since はゲーム内秒 */
  notice: { step: TutorialStep; since: number } | null
  /** 「了解」待ちの説明。表示中はゲームを止める */
  gate: TutorialStep | null
  /**
   * 了解のあと、その操作しかできないように縛っている説明。表示中はゲームを止める。
   * 最初の最初は何をすればいいか分からないので、培養液のボタンだけを押せる状態にして誘導する
   */
  lock: TutorialStep | null
  /** 了解のあと、その操作をするまで対象を光らせておく説明（縛りはしない） */
  hint: TutorialStep | null
  /** 名乗った説明。最初に出したものだけ肩書きを付ける */
  intro: TutorialStep | null
}

export function createTutorial(active: boolean, once: readonly TutorialStep[] = []): Tutorial {
  return {
    active,
    once: new Set(once),
    seen: new Set(),
    notice: null,
    gate: null,
    lock: null,
    hint: null,
    intro: null,
  }
}

/** 肩書きを付けて名乗るのは最初の 1 回だけ */
export function speakerOf(tut: Tutorial, step: TutorialStep): string {
  return tut.intro === step ? t.tutorial.speakerFull : t.tutorial.speaker
}

function show(tut: Tutorial, s: GameState | null, step: TutorialStep): void {
  tut.seen.add(step)
  if (tut.intro === null) tut.intro = step
  // 読み逃しても見返せるよう観測記録にも残す。研究所ではランが終わっているので残さない
  if (s && step !== 'lab') pushLog(s, 'chief', `${speakerOf(tut, step)}: ${plain(t.tutorial.lines[step])}`)
}

/** 強調の印（**）を外した文 */
export function plain(line: string): string {
  return line.replaceAll('**', '')
}

/**
 * 状態を見て、出すべき説明を決める。ストアが通知するたびに呼ぶ。
 * screen は 'title' | 'run' | 'lab'。
 */
export function observe(tut: Tutorial, s: GameState, screen: string): void {
  if (!tut.active && tut.once.size === 0) return
  /** まだ出しておらず、いま出してよい説明か */
  const allow = (step: TutorialStep) => !tut.seen.has(step) && (tut.active || tut.once.has(step))

  // --- 了解待ち ---
  if (tut.gate === null) {
    const d = s.pendingDraft
    const step: TutorialStep | null =
      screen === 'lab'
        ? 'lab'
        : screen !== 'run'
          ? null
          : allow('culture')
            ? 'culture'
            : s.phase === 'over'
              ? 'result'
              : d
                ? d.kind === 'mutation'
                  ? 'mutation'
                  : d.kind === 'policy'
                    ? 'policy'
                    : 'risk'
                : // 設備は研究方針を選び終えてから。最初の操作（培養液）と最初の選択（方針）を先に済ませる
                  s.policyCount > 0
                  ? 'build'
                  : null
    if (step && allow(step)) {
      tut.gate = step
      show(tut, screen === 'lab' ? null : s, step)
    }
  }
  if (!tut.active) return

  // --- 止めない通知（ゲームが動いている場面）---
  if (screen !== 'run' || s.phase === 'over') {
    tut.notice = null
    return
  }
  if (tut.notice && s.t - tut.notice.since >= INFO_SEC) tut.notice = null

  // 侵略やボスはその場で知らないと意味がないので、了解は求めずゲームを止めずに知らせる
  const info =
    s.phase === 'invasion' && !tut.seen.has('invasion')
      ? 'invasion'
      : s.onBoss && !tut.seen.has('boss')
        ? 'boss'
        : null
  if (info) {
    tut.notice = { step: info, since: s.t }
    show(tut, s, info)
  }
}

/** プレイヤーの操作を受けて、縛りを解き、光らせていた対象を戻す */
export function onAction(tut: Tutorial, action: 'click' | 'buy'): void {
  if (tut.lock === 'culture' && action === 'click') tut.lock = null
  if (tut.hint === 'build' && action === 'buy') tut.hint = null
}

/**
 * 「了解」を押した。
 *  - 最初のあいさつのあとは、培養液のボタンだけを押せる状態にする（縛り）
 *  - 設備と研究所のあとは、その操作をするまで対象を光らせておく
 */
export function ack(tut: Tutorial): void {
  if (tut.gate === 'culture') tut.lock = 'culture'
  if (tut.gate === 'build' || tut.gate === 'lab') tut.hint = tut.gate
  tut.gate = null
}

/** 了解待ちと縛りの間はゲームを止める（読んでいる間に持ち時間が減らないように） */
export function isPaused(tut: Tutorial): boolean {
  return tut.gate !== null || tut.lock !== null
}

/** 通知を × で閉じた */
export function dismiss(tut: Tutorial): void {
  tut.notice = null
}

/** いま光らせる対象か。研究所の開始ボタンは、次の実験を始めるまで光らせ続ける */
export function isFocus(tut: Tutorial, step: TutorialStep): boolean {
  if (!tut.active) return false
  return tut.notice?.step === step || tut.lock === step || tut.hint === step
}
