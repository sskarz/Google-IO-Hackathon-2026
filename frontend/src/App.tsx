import { useCallback, useState } from 'react'
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

  const handleDesignSaved = useCallback(async () => {
    setRefreshKey((k) => k + 1)
    setSpecLoading(true)
    setSpecError(null)
    try {
      const res = await fetch('http://localhost:8000/generate-spec', { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        const detail = typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail ?? d)
        throw new Error(detail || `HTTP ${res.status}`)
      }
      const specJson: unknown = await res.json()
      const parsed = parseAndValidate(specJson)
      if (!parsed.ok) {
        const summary = parsed.issues.slice(0, 5).map((i) => `${i.path}: ${i.message}`).join('; ')
        throw new Error(`Invalid spec: ${summary}`)
      }
      setSpec(parsed.spec)
    } catch (e) {
      setSpecError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSpecLoading(false)
    }
  }, [])

  return (
    <main className="stt-shell">
      <header className="stt-header">
        <p className="eyebrow">System Design Auditor</p>
        <h1>Describe the system you want to build</h1>
        <p className="lede">
          Talk with the auditor. It will ask follow-up questions, then generate your design doc and 3D architecture diagram.
        </p>
      </header>

      <AuditorPanel onDesignSaved={handleDesignSaved} />

      <div className="output-panels">
        <DesignViewer refreshKey={refreshKey} />
        <SpecCanvas spec={spec} loading={specLoading} error={specError} />
      </div>
    </main>
  )
}

export default App
