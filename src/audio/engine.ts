/**
 * 音の土台。AudioContext と音量だけを持ち、鳴らす音そのものは se.ts / bgm.ts が作る。
 *
 * ブラウザは操作を伴わない再生を止めるので、AudioContext はプレイヤーが最初に
 * 何かを触るまで作らない。操作の起点から ensureAudio() を呼ぶ。
 */

/** master は se と bgm の両方に掛かる */
export type Channel = 'master' | 'se' | 'bgm'

export type AudioSettings = Record<Channel, number> & { muted: boolean }

const KEY = 'inkurimentaru.audio.v1'

const DEFAULTS: AudioSettings = { master: 0.7, se: 0.8, bgm: 0.45, muted: false }

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

function load(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const p = JSON.parse(raw) as Partial<AudioSettings>
    return {
      master: typeof p.master === 'number' ? clamp01(p.master) : DEFAULTS.master,
      se: typeof p.se === 'number' ? clamp01(p.se) : DEFAULTS.se,
      bgm: typeof p.bgm === 'number' ? clamp01(p.bgm) : DEFAULTS.bgm,
      muted: p.muted === true,
    }
  } catch {
    // プライベートウィンドウなどで localStorage が使えない場合は初期設定で続行する
    return { ...DEFAULTS }
  }
}

function save(s: AudioSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // 保存できなくても音は鳴るので黙って続ける
  }
}

let settings: AudioSettings = load()

let ctx: AudioContext | null = null
let masterGain: GainNode | null = null
let seGain: GainNode | null = null
let bgmGain: GainNode | null = null
let noise: AudioBuffer | null = null

/**
 * 実際のゲイン。スライダーの値をそのまま掛けると、聴感上は上半分しか変化しない。
 * 2 乗して耳の対数特性に寄せる。
 */
function gainOf(v: number): number {
  return clamp01(v) * clamp01(v)
}

function applyGains(): void {
  if (!ctx || !masterGain || !seGain || !bgmGain) return
  const now = ctx.currentTime
  // 直接代入すると段差でパチッと鳴るので、短い時定数で寄せる
  masterGain.gain.setTargetAtTime(settings.muted ? 0 : gainOf(settings.master), now, 0.02)
  seGain.gain.setTargetAtTime(gainOf(settings.se), now, 0.02)
  bgmGain.gain.setTargetAtTime(gainOf(settings.bgm), now, 0.05)
}

/**
 * AudioContext を用意する。ユーザー操作の中から呼ぶこと。
 * 音が使えない環境（Node での実行や、AudioContext の無いブラウザ）では null を返す。
 */
export function ensureAudio(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null

  if (!ctx) {
    ctx = new AudioContext()
    masterGain = ctx.createGain()
    seGain = ctx.createGain()
    bgmGain = ctx.createGain()
    seGain.connect(masterGain)
    bgmGain.connect(masterGain)
    masterGain.connect(ctx.destination)
    applyGains()
  }

  // タブを離れて suspend された場合もここで復帰する
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** 起動済みなら AudioContext を返す。まだなら作らずに null */
export function audioContext(): AudioContext | null {
  return ctx
}

export function seBus(): GainNode | null {
  return seGain
}

export function bgmBus(): GainNode | null {
  return bgmGain
}

/** 破裂音や水の音に使うホワイトノイズ。1 本作って使い回す */
export function noiseBuffer(c: AudioContext): AudioBuffer {
  if (!noise) {
    const len = Math.floor(c.sampleRate * 1.5)
    noise = c.createBuffer(1, len, c.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  }
  return noise
}

// --- 設定 -----------------------------------------------------------------

const listeners = new Set<() => void>()
let version = 0

function emit(): void {
  version += 1
  for (const l of listeners) l()
}

export function subscribeAudio(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function getAudioVersion(): number {
  return version
}

export function getAudioSettings(): AudioSettings {
  return settings
}

export function setVolume(ch: Channel, v: number): void {
  settings = { ...settings, [ch]: clamp01(v) }
  // 音量を動かしたということは音を聴きたいということなので、ここでも起こす
  ensureAudio()
  applyGains()
  save(settings)
  emit()
}

export function setMuted(muted: boolean): void {
  settings = { ...settings, muted }
  if (!muted) ensureAudio()
  applyGains()
  save(settings)
  emit()
}

export function toggleMuted(): void {
  setMuted(!settings.muted)
}

/** 音を出してよいか。ミュート中と master 0 のときは合成そのものを省く */
export function audible(): boolean {
  return !settings.muted && settings.master > 0
}
