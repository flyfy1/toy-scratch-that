import { useEffect, useRef } from 'react'
import { MoreMenu } from './components/MoreMenu'
import { applyMeta } from './i18n'
import { startGame } from './game'

// Phase 1 (render gate): the canvas and the shared pills only.
export default function App() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    applyMeta('scratch')
    const g = startGame(ref.current!, { onFirst() {} })
    return () => g.dispose()
  }, [])
  return (
    <>
      <canvas ref={ref} />
      <MoreMenu current="scratch" />
    </>
  )
}
