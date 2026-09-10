/**
 * BGM。曲を鳴らすのではなく、鳴りっぱなしのドローンを深度と状況で変形させる。
 *
 * 1 ランが 3〜12 分でループの切れ目が目立つため、旋律を持たせない構成にしている。
 * 深海のあいだはローパスで塞いで水中の唸りにし、深度 11 で空へ抜けたときに開く。
 *
 * public/bgm/ に音源が置かれていればそちらを優先し、合成は鳴らさない。
 * 置かれた曲を深度で加工したりはしない（作った人の意図をそのまま出す）。
 */
import { bgmBus, ensureAudio, getAudioSettings } from './engine.ts'
import { hasAnyTrack, playTrack, stopTracks, type TrackId, tracksReady } from './tracks.ts'

/** calm = 培養フェーズ、tense = 侵略フェーズ */
export type Mood = 'calm' | 'tense'

export type BgmState = {
  depth: number
  mood: Mood
  /** 制限時間の逼迫度 0〜1。脈動の速さに効く */
  danger: number
}

type Nodes = {
  ctx: AudioContext
  osc: OscillatorNode[]
  filter: BiquadFilterNode
  drone: GainNode
  pulse: GainNode
  pulseDepth: GainNode
  pulseOsc: OscillatorNode
  pulseLfo: OscillatorNode
}

let nodes: Nodes | null = null
let current: BgmState = { depth: 1, mood: 'calm', danger: 0 }

/** 深度が反転する境目。atmosphere.ts の反転と同じ深度に合わせてある */
const BREACH_DEPTH = 11

/**
 * 深度ごとの基音。
 * 深海では潜るほど低く、反転後はオクターブ上へ跳ねてから緩やかに上がる。
 */
function baseFreq(depth: number): number {
  if (depth < BREACH_DEPTH) return 55 * Math.pow(2, -(depth - 1) / 32)
  return 98 * Math.pow(2, (depth - BREACH_DEPTH) / 60)
}

/** ローパスの開き具合。反転すると一気に開けて、こもりが取れる */
function cutoff(depth: number, mood: Mood, danger: number): number {
  const base = depth < BREACH_DEPTH ? 220 + depth * 14 : 1600 + (depth - BREACH_DEPTH) * 120
  return base * (mood === 'tense' ? 1.35 : 1) * (1 + danger * 0.5)
}

function build(ctx: AudioContext, bus: GainNode): Nodes {
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.Q.value = 3.5

  const drone = ctx.createGain()
  drone.gain.value = 0.0001

  const f = baseFreq(current.depth)
  // 同じ音を 2 本わずかにずらして重ねると、単音の平坦さが消えてうねりが出る
  const specs: Array<[OscillatorType, number, number]> = [
    ['sawtooth', f, 0.16],
    ['sawtooth', f * 1.006, 0.14],
    ['sine', f * 0.5, 0.22],
    ['sine', f * 3, 0.04],
  ]
  const osc = specs.map(([type, freq, gain]) => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.value = freq
    g.gain.value = gain
    o.connect(g).connect(filter)
    o.start()
    return o
  })

  filter.connect(drone).connect(bus)

  // カットオフをゆっくり揺らす。潮の動きのつもり
  const sway = ctx.createOscillator()
  const swayAmount = ctx.createGain()
  sway.type = 'sine'
  sway.frequency.value = 0.06
  swayAmount.gain.value = 60
  sway.connect(swayAmount).connect(filter.frequency)
  sway.start()
  osc.push(sway)

  // 脈動。侵略中だけ鳴らし、残り時間が減るほど速くする
  const pulse = ctx.createGain()
  pulse.gain.value = 0
  const pulseOsc = ctx.createOscillator()
  pulseOsc.type = 'sine'
  pulseOsc.frequency.value = f * 2
  pulseOsc.connect(pulse).connect(bus)
  pulseOsc.start()

  const pulseLfo = ctx.createOscillator()
  const pulseDepth = ctx.createGain()
  pulseLfo.type = 'sine'
  pulseLfo.frequency.value = 0.8
  pulseDepth.gain.value = 0
  pulseLfo.connect(pulseDepth).connect(pulse.gain)
  pulseLfo.start()
  osc.push(pulseLfo)

  return { ctx, osc, filter, drone, pulse, pulseDepth, pulseOsc, pulseLfo }
}

function apply(n: Nodes, s: BgmState, immediate = false): void {
  const now = n.ctx.currentTime
  const glide = immediate ? 0.01 : 1.2

  const f = baseFreq(s.depth)
  const ratios = [1, 1.006, 0.5, 3]
  for (let i = 0; i < ratios.length; i++) {
    n.osc[i]?.frequency.setTargetAtTime(f * ratios[i], now, glide)
  }
  n.pulseOsc.frequency.setTargetAtTime(f * 2, now, glide)
  n.filter.frequency.setTargetAtTime(cutoff(s.depth, s.mood, s.danger), now, glide)

  // 培養中は完全に止める。侵略に入ると脈が立ち上がる
  n.pulseDepth.gain.setTargetAtTime(s.mood === 'tense' ? 0.05 : 0, now, 0.8)
  n.pulse.gain.setTargetAtTime(s.mood === 'tense' ? 0.05 : 0, now, 0.8)
  n.pulseLfo.frequency.setTargetAtTime(0.7 + s.danger * 1.6, now, 0.6)
}

/** 合成のドローンを鳴らし始める。音源が置かれていないときの受け皿 */
function startSynth(ctx: AudioContext, bus: GainNode): void {
  if (nodes) return
  nodes = build(ctx, bus)
  apply(nodes, current, true)
  // 突然始まると驚くので、2 秒かけて立ち上げる
  nodes.drone.gain.setTargetAtTime(0.5, ctx.currentTime, 0.7)
}

function stopSynth(): void {
  const n = nodes
  if (!n) return
  nodes = null
  const t = n.ctx.currentTime
  n.drone.gain.setTargetAtTime(0.0001, t, 0.3)
  n.pulse.gain.setTargetAtTime(0.0001, t, 0.3)
  for (const o of n.osc) o.stop(t + 1.5)
  n.pulseOsc.stop(t + 1.5)
}

/** 音源と合成の両方を止める */
export function stopBgm(): void {
  stopSynth()
  stopTracks()
}

/** その場面で鳴らす音源。深度の反転後は専用のトラックに移る */
function trackFor(s: BgmState): TrackId {
  if (s.depth >= BREACH_DEPTH) return 'sky'
  return s.mood === 'tense' ? 'invasion' : 'culture'
}

/**
 * ゲームの状況を渡す。鳴っていなければ、設定が許すかぎりここで鳴らし始める。
 * 毎フレーム呼ばれる想定なので、変化がなければ何もしない。
 */
export function updateBgm(s: BgmState): void {
  const cfg = getAudioSettings()
  const wanted = !cfg.muted && cfg.master > 0 && cfg.bgm > 0

  if (!wanted) {
    stopBgm()
    current = s
    return
  }

  const ctx = ensureAudio()
  const bus = bgmBus()
  if (!ctx || !bus) return

  // 走査が終わるまでは鳴らし始めない。
  // 合成が一瞬鳴ってから音源に切り替わると、事故のように聞こえるため
  if (!tracksReady(ctx)) return

  const changed =
    s.depth !== current.depth || s.mood !== current.mood || Math.abs(s.danger - current.danger) > 0.05
  current = changed ? s : current

  if (hasAnyTrack()) {
    stopSynth()
    playTrack(ctx, bus, trackFor(current))
    return
  }

  if (!nodes) {
    startSynth(ctx, bus)
    return
  }
  if (changed) apply(nodes, current)
}
