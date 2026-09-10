/**
 * BGM の音源ファイル。
 *
 * public/bgm/ に決められた名前で音声ファイルを置くと、合成のドローンを差し替える。
 * **コードの変更は不要**。ファイルが無ければ 404 になり、これまで通り合成で鳴らす。
 *
 * 場面ごとに分けて置けるが、1 本だけ置いてもよい。
 * 見つからないものは FALLBACK の順に別のトラックで代用する。
 */
export type TrackId = 'culture' | 'invasion' | 'sky'

const IDS: TrackId[] = ['culture', 'invasion', 'sky']

/*
 * Vite の base を前置きする。assets.ts と同じ理由で、
 * ユーザーページのサブパスに置いたときに 404 にならないようにする。
 */
const BASE_PATH = `${import.meta.env.BASE_URL}bgm`.replace('//', '/')

/** 試す拡張子。先に見つかったものを使う */
const EXTS = ['mp3', 'ogg'] as const

/** そのトラックが無いときに代わりに使う順序 */
const FALLBACK: Record<TrackId, TrackId[]> = {
  culture: ['culture', 'invasion', 'sky'],
  invasion: ['invasion', 'culture', 'sky'],
  sky: ['sky', 'invasion', 'culture'],
}

/** 切り替えにかける秒数 */
const FADE = 1.2

/** 読み込み済み（null は「無い」と確定したもの） */
const buffers = new Map<TrackId, AudioBuffer | null>()
let scanned = false
let scanning = false

async function loadTrack(ctx: AudioContext, id: TrackId): Promise<AudioBuffer | null> {
  for (const ext of EXTS) {
    try {
      const res = await fetch(`${BASE_PATH}/${id}.${ext}`)
      if (!res.ok) continue
      return await ctx.decodeAudioData(await res.arrayBuffer())
    } catch {
      // 壊れたファイルや対応していない形式は、置かれていないものとして扱う
    }
  }
  return null
}

/**
 * 音源を走査する。まだ終わっていなければ非同期で取りにいき、その回は false を返す。
 *
 * 走査が終わるまで BGM を鳴らし始めないのは、合成が一瞬鳴ってから
 * 音源に切り替わる不自然さを避けるため。
 */
export function tracksReady(ctx: AudioContext): boolean {
  if (scanned) return true
  if (!scanning) {
    scanning = true
    void Promise.all(
      IDS.map(async (id) => {
        buffers.set(id, await loadTrack(ctx, id))
      }),
    ).then(() => {
      scanned = true
      scanning = false
    })
  }
  return false
}

/** 音源が 1 本でも置かれているか。無ければ合成で鳴らす */
export function hasAnyTrack(): boolean {
  for (const b of buffers.values()) if (b) return true
  return false
}

/** 実際に鳴らすトラック。要求されたものが無ければ代用を探す */
function resolve(id: TrackId): TrackId | null {
  for (const cand of FALLBACK[id]) {
    if (buffers.get(cand)) return cand
  }
  return null
}

type Playing = { id: TrackId; src: AudioBufferSourceNode; gain: GainNode }

let playing: Playing | null = null

/** 指定のトラックへ移る。同じものが鳴っていれば何もしない */
export function playTrack(ctx: AudioContext, bus: GainNode, id: TrackId): void {
  const real = resolve(id)
  if (!real) return
  if (playing && playing.id === real) return

  const buf = buffers.get(real)
  if (!buf) return

  const gain = ctx.createGain()
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  gain.gain.value = 0.0001
  src.connect(gain).connect(bus)
  src.start()

  // 全体の音量は master / bgm のバスが持つ。ここは出し入れだけを行う
  gain.gain.setTargetAtTime(1, ctx.currentTime, FADE / 3)

  stopTracks()
  playing = { id: real, src, gain }
}

export function stopTracks(): void {
  const p = playing
  if (!p) return
  playing = null
  const now = p.gain.context.currentTime
  p.gain.gain.setTargetAtTime(0.0001, now, FADE / 3)
  p.src.stop(now + FADE)
}
