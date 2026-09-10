import { useState, useSyncExternalStore } from 'react'
import {
  type Channel,
  getAudioSettings,
  getAudioVersion,
  setMuted,
  setVolume,
  subscribeAudio,
} from '../../audio/engine.ts'
import { t } from '../../text/index.ts'
import { Sprite } from './Sprite.tsx'

const ROWS: Array<[Channel, string]> = [
  ['master', t.audio.master],
  ['se', t.audio.se],
  ['bgm', t.audio.bgm],
]

/**
 * 音量の設定。画面の隅に畳んでおき、押したときだけ開く。
 *
 * ラン中に触るものではないので、盤面の情報量を増やさないことを優先している。
 */
export function AudioPanel() {
  useSyncExternalStore(subscribeAudio, getAudioVersion, getAudioVersion)
  const cfg = getAudioSettings()
  const [open, setOpen] = useState(false)

  return (
    <div className="audio">
      {open && (
        <div className="audio-body panel">
          <div className="panel-title">{t.audio.title}</div>
          {ROWS.map(([ch, label]) => {
            const pct = Math.round(cfg[ch] * 100)
            return (
              <label key={ch} className="audio-row">
                <span className="audio-label">{label}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={pct}
                  aria-label={label}
                  onChange={(e) => setVolume(ch, Number(e.target.value) / 100)}
                />
                <span className="audio-value">{pct}</span>
              </label>
            )
          })}
          <button className="audio-mute" data-on={cfg.muted} onClick={() => setMuted(!cfg.muted)}>
            {cfg.muted ? t.audio.unmute : t.audio.mute}
          </button>
        </div>
      )}

      <button
        className="audio-toggle"
        data-open={open}
        data-muted={cfg.muted}
        aria-label={open ? t.audio.close : t.audio.open}
        title={open ? t.audio.close : t.audio.open}
        onClick={() => setOpen(!open)}
      >
        <Sprite kind="ui" id={cfg.muted ? 'mute' : 'sound'} size={32} />
      </button>
    </div>
  )
}
