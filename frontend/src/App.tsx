import { useCallback, useRef, useState } from 'react'
import { AuditorPanel } from './components/AuditorPanel'
import { DesignViewer } from './components/DesignViewer'
import { SpecCanvas } from './components/SpecCanvas'
import { parseAndValidate } from './spec/validator'
import type { Spec } from './spec/schema'
import './App.css'

function App() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [spec, setSpec] = useState<Spec | null>(null)
  const [specLoading, setSpecLoading] = useState(false)
  const [specError, setSpecError] = useState<string | null>(null)
  // Track the in-flight spec fetch so a section-confirmed event mid-fetch
  // can cancel the stale request and replace it with one that sees the
  // newly-appended DESIGN.md content.
  const specAbortRef = useRef<AbortController | null>(null)

  const refreshSpec = useCallback(async () => {
    specAbortRef.current?.abort()
    const controller = new AbortController()
    specAbortRef.current = controller
    setSpecLoading(true)
    setSpecError(null)
    try {
      const res = await fetch('http://localhost:8000/generate-spec', {
        method: 'POST',
        signal: controller.signal,
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        const detail = typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail ?? d)
        throw new Error(detail || `HTTP ${res.status}`)
      }
      const specJson: unknown = await res.json()
      if (controller.signal.aborted) return
      const parsed = parseAndValidate(specJson)
      if (!parsed.ok) {
        const summary = parsed.issues
          .slice(0, 5)
          .map((i) => `${i.path}: ${i.message}`)
          .join('; ')
        throw new Error(`Invalid spec: ${summary}`)
      }
      if (controller.signal.aborted) return
      setSpec(parsed.spec)
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      if (controller.signal.aborted) return
      setSpecError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      // Only the most-recent request owns the loading state. If a newer
      // request superseded this one, leave specLoading=true for the newer.
      if (specAbortRef.current === controller) {
        setSpecLoading(false)
        specAbortRef.current = null
      }
    }
  }, [])

  // Fires after each section confirmation. DESIGN.md is already updated on
  // disk; bump refreshKey so DesignViewer reloads the partial markdown,
  // and refetch the spec so the 3D scene reflects what's been said so far.
  const handleSectionConfirmed = useCallback(() => {
    setRefreshKey((k) => k + 1)
    refreshSpec()
  }, [refreshSpec])

  // Fires once when the full design is finalized.
  const handleDesignSaved = useCallback(() => {
    setRefreshKey((k) => k + 1)
    refreshSpec()
  }, [refreshSpec])

  return (
    <main className="stt-shell">
      <header className="stt-header">
        <p className="eyebrow">System Design Auditor</p>
        <h1>Describe the system you want to build</h1>
        <p className="lede">
          Talk with the auditor. It will ask follow-up questions, then generate your design doc and 3D architecture diagram.
        </p>
      </header>

      <AuditorPanel
        onDesignSaved={handleDesignSaved}
        onSectionConfirmed={handleSectionConfirmed}
      />

      {(refreshKey > 0 || specLoading || spec || specError) && (
        <div className="output-panels">
          <DesignViewer refreshKey={refreshKey} />
          <SpecCanvas spec={spec} loading={specLoading} error={specError} />
        </div>
      )}
    </main>
  )
}

export default App
