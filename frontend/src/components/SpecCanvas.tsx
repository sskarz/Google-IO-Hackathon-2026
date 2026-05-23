import { useEffect, useRef } from 'react'
import { createRenderer, type RendererHandle } from '../renderer'
import type { Spec } from '../spec/schema'

interface Props {
  spec: Spec | null
  loading?: boolean
  error?: string | null
}

export function SpecCanvas({ spec, loading, error }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<RendererHandle | null>(null)

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

  const stateMessage = (() => {
    if (loading) return 'Generating spec…'
    if (error) return `Failed to generate spec: ${error}`
    if (!spec) return 'No spec yet. Generate a design to see the 3D view.'
    return null
  })()

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
        {stateMessage && (
          <p className={`spec-canvas-state ${error ? 'error' : ''}`}>{stateMessage}</p>
        )}
      </div>
    </section>
  )
}
