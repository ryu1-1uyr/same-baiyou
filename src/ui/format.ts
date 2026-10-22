const UNITS = ['', 'k', 'M', 'B', 'T', 'aa', 'ab', 'ac']

/** 大きな数を桁付きで丸める。1 ラン中の最大桁は 10^15 を想定 */
export function fmt(n: number): string {
  if (!isFinite(n)) return '∞'
  if (n < 1000) return n < 10 ? n.toFixed(1) : Math.floor(n).toString()
  let i = 0
  let v = n
  while (v >= 1000 && i < UNITS.length - 1) {
    v /= 1000
    i += 1
  }
  return (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : v.toFixed(0)) + UNITS[i]
}

export function mmss(sec: number): string {
  const s = Math.max(0, sec)
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

/** レア度の表示ラベル。ドラフトと図鑑で共有する */
export const RARITY_LABEL: Record<string, string> = {
  common: 'COMMON',
  uncommon: 'UNCOMMON',
  rare: 'RARE',
  legendary: 'LEGENDARY',
}
