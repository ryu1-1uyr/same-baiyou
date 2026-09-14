import { useEffect } from 'react'
import { getScreen, startLoop } from '../store/gameStore.ts'
import { t } from '../text/index.ts'
import { LabScreen } from './components/LabScreen.tsx'
import { useAtmosphere } from './useAtmosphere.ts'
import { useGame } from './useGame.ts'
import { useSound } from './useSound.ts'
import { AudioPanel } from './components/AudioPanel.tsx'
import { DebugPanel } from './components/DebugPanel.tsx'
import { DepthFlash } from './components/DepthFlash.tsx'
import { DraftOverlay } from './components/DraftOverlay.tsx'
import { HUD } from './components/HUD.tsx'
import { InvasionPanel } from './components/InvasionPanel.tsx'
import { ProducePanel } from './components/ProducePanel.tsx'
import { ResultOverlay } from './components/ResultOverlay.tsx'
import { StockPanel } from './components/StockPanel.tsx'

export function App() {
  useGame()
  useAtmosphere()
  useSound()
  useEffect(() => {
    startLoop()
  }, [])

  if (getScreen() === 'lab')
    return (
      <>
        <LabScreen />
        <DebugPanel />
        <AudioPanel />
        <Copyright />
      </>
    )

  return (
    <div className="app">
      <div className="area-hud">
        <HUD />
      </div>
      <ProducePanel />
      <InvasionPanel />
      <StockPanel />
      <DraftOverlay />
      <ResultOverlay />
      <DepthFlash />
      <DebugPanel />
      <AudioPanel />
      <Copyright />
    </div>
  )
}

function Copyright() {
  return <p className="copyright">{t.app.copyright}</p>
}
