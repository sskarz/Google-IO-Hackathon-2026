import { useEffect, useRef, useState } from 'react'
import {
  createRenderer,
  type RendererHandle,
  type ViewMode,
} from '../renderer'
import type { Spec } from '../spec/schema'

interface Props {
  spec: Spec | null
  loading?: boolean
  error?: string | null
}

export function SpecCanvas({ spec, loading, error }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<RendererHandle | null>(null)
  // Default to 2D — flat top-down reads cleaner than iso for wide layouts
  // (the typical 5+ layer ELK output). Users can toggle to 3D for the iso
  // aesthetic.
  const [viewMode, setViewMode] = useState<ViewMode>('2d')
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    if (!containerRef.current) return
    const r = createRenderer(containerRef.current)
    rendererRef.current = r
    return () => {
      r.dispose()
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    if (spec && rendererRef.current) {
      rendererRef.current.setSpec(spec).catch((err: unknown) => {
        console.error('Failed to render spec', err)
      })
    }
  }, [spec])

  useEffect(() => {
    rendererRef.current?.setViewMode(viewMode)
  }, [viewMode])

  // Sync fullscreen state with the browser (covers ESC + system exits).
  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleMode = () =>
    setViewMode((m) => (m === '3d' ? '2d' : '3d'))

  const toggleFullscreen = () => {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement === el) {
      document.exitFullscreen().catch(() => {
        /* user dismissed or unsupported */
      })
    } else {
      el.requestFullscreen().catch(() => {
        /* user dismissed or unsupported */
      })
    }
  }

  const stateMessage = error ? `Failed to generate spec: ${error}` : null

  return (
    <section className="spec-canvas" aria-label="System design 3D visualization">
      <div className="spec-canvas-header">
        <h2>3D View</h2>
        {spec && (
          <span className="spec-canvas-meta">
            {spec.nodes.length} nodes · {spec.edges.length} edges
          </span>
        )}
      </div>
      <div className="spec-canvas-container" ref={containerRef}>
        {spec && (
          <div className="spec-canvas-controls">
            <button
              type="button"
              className="spec-canvas-ctrl-btn"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              aria-pressed={isFullscreen}
            >
              {isFullscreen ? 'Exit' : 'Full'}
            </button>
            <button
              type="button"
              className="spec-canvas-ctrl-btn"
              onClick={toggleMode}
              aria-label={`Switch to ${viewMode === '3d' ? '2D' : '3D'} view`}
              aria-pressed={viewMode === '2d'}
            >
              {viewMode === '3d' ? '2D' : '3D'}
            </button>
          </div>
        )}
        {loading && (
          <div className="spec-canvas-loading" aria-live="polite">
            <div className="spec-canvas-loading-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p>Generating 3D view…</p>
          </div>
        )}
        {stateMessage && (
          <p className={`spec-canvas-state ${error ? 'error' : ''}`}>
            {stateMessage}
          </p>
        )}
      </div>
    </section>
  )
}
