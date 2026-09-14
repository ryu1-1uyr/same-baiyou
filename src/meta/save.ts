import { createMeta, type MetaState } from '../game/meta.ts'

const KEY = 'inkurimentaru.meta.v1'

/** 保存するのは恒久強化のみ。ラン中の状態は保存しない（リロードでランが消えるのは仕様） */
export function loadMeta(): MetaState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return createMeta()
    const parsed = JSON.parse(raw) as Partial<MetaState>
    const base = createMeta()
    return {
      budget: Number(parsed.budget) || 0,
      lifetimeBudget: Number(parsed.lifetimeBudget) || 0,
      runs: Number(parsed.runs) || 0,
      bestDepth: Number(parsed.bestDepth) || 0,
      levels: typeof parsed.levels === 'object' && parsed.levels ? { ...parsed.levels } : base.levels,
      unlocked: Array.isArray(parsed.unlocked) ? [...parsed.unlocked] : base.unlocked,
      // 図鑑より前のセーブには無いので、空から始める
      discovered: Array.isArray(parsed.discovered) ? [...parsed.discovered] : base.discovered,
      claimed: Array.isArray(parsed.claimed) ? [...parsed.claimed] : base.claimed,
    }
  } catch {
    // プライベートウィンドウなどで localStorage が使えない場合は初期状態で続行する
    return createMeta()
  }
}

export function saveMeta(m: MetaState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    // 保存できなくてもゲームは続行できる
  }
}

export function resetMeta(): MetaState {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* noop */
  }
  return createMeta()
}
