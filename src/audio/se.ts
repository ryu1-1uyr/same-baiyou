/**
 * 効果音。音声ファイルは持たず、その場で波形を合成する。
 *
 * 素材を用意しなくて済むぶん、音の性格はここのパラメータがすべて。
 * ドット絵に合わせて倍音の少ない波形（三角・矩形）を主にしている。
 */
import { audible, ensureAudio, noiseBuffer, seBus } from './engine.ts'

export type SeName =
  | 'collect'
  | 'crit'
  | 'buy'
  | 'draft'
  | 'choose'
  | 'depth'
  | 'breach'
  | 'bossAppear'
  | 'bossDown'
  | 'record'
  | 'alert'
  | 'beam'

type ToneOpts = {
  type?: OscillatorType
  /** 開始周波数 */
  freq: number
  /** 終端周波数。省くとスイープしない */
  to?: number
  /** 鳴らし始めるまでの秒数 */
  at?: number
  dur: number
  gain?: number
  attack?: number
}

function tone(c: AudioContext, dest: AudioNode, o: ToneOpts): void {
  const t0 = c.currentTime + (o.at ?? 0)
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = o.type ?? 'triangle'
  osc.frequency.setValueAtTime(o.freq, t0)
  if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + o.dur)

  const peak = o.gain ?? 0.3
  const atk = o.attack ?? 0.004
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.linearRampToValueAtTime(peak, t0 + atk)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur)

  osc.connect(g).connect(dest)
  osc.start(t0)
  osc.stop(t0 + o.dur + 0.02)
}

type NoiseOpts = {
  at?: number
  dur: number
  gain?: number
  /** バンドパスの中心周波数。省くと生のノイズ */
  freq?: number
  q?: number
  /** 中心周波数の終端。破裂音を下降させるのに使う */
  to?: number
}

function noise(c: AudioContext, dest: AudioNode, o: NoiseOpts): void {
  const t0 = c.currentTime + (o.at ?? 0)
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c)
  src.loop = true

  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.linearRampToValueAtTime(o.gain ?? 0.2, t0 + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur)

  let node: AudioNode = src
  if (o.freq !== undefined) {
    const f = c.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.setValueAtTime(o.freq, t0)
    if (o.to !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur)
    f.Q.value = o.q ?? 1
    src.connect(f)
    node = f
  }

  node.connect(g).connect(dest)
  src.start(t0)
  src.stop(t0 + o.dur + 0.02)
}

/**
 * 同じ音が同一フレームに何重にも入ると音量が跳ねる。
 * 直近に鳴らした時刻を覚えておき、短すぎる間隔は捨てる。
 */
const lastAt = new Map<SeName, number>()
const MIN_GAP: Partial<Record<SeName, number>> = { collect: 0.035, buy: 0.05, record: 0.12 }

export function playSe(name: SeName): void {
  if (!audible()) return
  const c = ensureAudio()
  const bus = seBus()
  if (!c || !bus) return

  const gap = MIN_GAP[name]
  if (gap !== undefined) {
    const prev = lastAt.get(name) ?? -Infinity
    if (c.currentTime - prev < gap) return
    lastAt.set(name, c.currentTime)
  }

  switch (name) {
    // 培養液を 1 回汲む音。何百回も聞くので、短く・軽く・少しだけ表情を変える
    case 'collect': {
      const f = 520 * (0.94 + Math.random() * 0.12)
      tone(c, bus, { type: 'triangle', freq: f, to: f * 0.55, dur: 0.09, gain: 0.16 })
      noise(c, bus, { dur: 0.05, gain: 0.05, freq: 1800, to: 700, q: 1.4 })
      break
    }
    // 会心。採取音の上に一段高い音を重ねる
    case 'crit': {
      tone(c, bus, { type: 'square', freq: 720, dur: 0.06, gain: 0.1 })
      tone(c, bus, { type: 'square', freq: 1080, at: 0.05, dur: 0.12, gain: 0.09 })
      break
    }
    case 'buy': {
      tone(c, bus, { type: 'square', freq: 180, to: 240, dur: 0.07, gain: 0.12 })
      tone(c, bus, { type: 'triangle', freq: 480, at: 0.04, dur: 0.1, gain: 0.1 })
      break
    }
    // カードが出る。手を止めさせたいので、他より少し長く響かせる
    case 'draft': {
      tone(c, bus, { type: 'sine', freq: 880, dur: 0.5, gain: 0.14 })
      tone(c, bus, { type: 'sine', freq: 1320, at: 0.06, dur: 0.55, gain: 0.1 })
      tone(c, bus, { type: 'triangle', freq: 440, at: 0.02, dur: 0.3, gain: 0.07 })
      break
    }
    case 'choose': {
      tone(c, bus, { type: 'triangle', freq: 620, dur: 0.08, gain: 0.14 })
      tone(c, bus, { type: 'triangle', freq: 930, at: 0.07, dur: 0.18, gain: 0.12 })
      break
    }
    // 深度突破。潜っていく感じを下降スイープで出す
    case 'depth': {
      tone(c, bus, { type: 'sawtooth', freq: 300, to: 70, dur: 0.7, gain: 0.13 })
      tone(c, bus, { type: 'sine', freq: 120, to: 55, dur: 0.9, gain: 0.16 })
      noise(c, bus, { dur: 0.6, gain: 0.06, freq: 900, to: 200, q: 0.8 })
      break
    }
    // 深度 11 の反転。ここだけ上へ抜ける
    case 'breach': {
      tone(c, bus, { type: 'sine', freq: 180, to: 1400, dur: 1.1, gain: 0.16, attack: 0.15 })
      tone(c, bus, { type: 'triangle', freq: 360, to: 2100, dur: 1.0, gain: 0.08, attack: 0.2 })
      noise(c, bus, { dur: 1.2, gain: 0.1, freq: 400, to: 6000, q: 0.6 })
      break
    }
    case 'bossAppear': {
      tone(c, bus, { type: 'sawtooth', freq: 92, to: 78, dur: 0.9, gain: 0.14, attack: 0.12 })
      tone(c, bus, { type: 'sawtooth', freq: 138, to: 116, dur: 0.9, gain: 0.08, attack: 0.18 })
      break
    }
    case 'bossDown': {
      noise(c, bus, { dur: 0.55, gain: 0.24, freq: 1200, to: 120, q: 0.5 })
      tone(c, bus, { type: 'sine', freq: 140, to: 40, dur: 0.6, gain: 0.22 })
      break
    }
    // 自己ベスト更新。上昇する 3 連できらめかせる
    case 'record': {
      tone(c, bus, { type: 'triangle', freq: 1046, dur: 0.1, gain: 0.1 })
      tone(c, bus, { type: 'triangle', freq: 1318, at: 0.07, dur: 0.1, gain: 0.1 })
      tone(c, bus, { type: 'triangle', freq: 1568, at: 0.14, dur: 0.22, gain: 0.11 })
      break
    }
    case 'alert': {
      tone(c, bus, { type: 'square', freq: 880, dur: 0.12, gain: 0.11 })
      tone(c, bus, { type: 'square', freq: 880, at: 0.18, dur: 0.12, gain: 0.11 })
      break
    }
    // 軌道からのビーム。ランの終わりなので、いちばん大きく長い音にしている
    case 'beam': {
      tone(c, bus, { type: 'sawtooth', freq: 1600, to: 60, dur: 1.6, gain: 0.2 })
      tone(c, bus, { type: 'sine', freq: 60, dur: 2.2, gain: 0.2, attack: 0.4 })
      noise(c, bus, { dur: 2.0, gain: 0.18, freq: 3000, to: 90, q: 0.4 })
      break
    }
  }
}
