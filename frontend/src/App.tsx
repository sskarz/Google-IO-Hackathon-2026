import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useSpeechRecognition,
  type RecognitionMode,
} from './hooks/useSpeechRecognition'
import { DesignViewer } from './components/DesignViewer'
import { AuditViewer } from './components/AuditViewer'
import { SpecCanvas } from './components/SpecCanvas'
import { parseAndValidate } from './spec/validator'
import type { Spec } from './spec/schema'
import './App.css'

type GenerateStatus = 'idle' | 'submitting' | 'success' | 'error'

function App() {
  const [mode, setMode] = useState<RecognitionMode>('push-to-talk')
  const {
    isSupported,
    isListening,
    finalTranscript,
    interimTranscript,
    error,
    start,
    stop,
    reset,
  } = useSpeechRecognition({ mode })

  const fullTranscript = useMemo(() => {
    const f = finalTranscript.trim()
    const i = interimTranscript.trim()
    if (f && i) return `${f} ${i}`
    return f || i
  }, [finalTranscript, interimTranscript])

  const [generateStatus, setGenerateStatus] = useState<GenerateStatus>('idle')
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [spec, setSpec] = useState<Spec | null>(null)
  const [specLoading, setSpecLoading] = useState(false)
  const [specError, setSpecError] = useState<string | null>(null)

  const handleGenerate = useCallback(async (transcript: string) => {
    if (!transcript.trim()) return
    setGenerateStatus('submitting')
    setGenerateError(null)
    setSpec(null)
    setSpecError(null)
    setSpecLoading(true)

    try {
      const res = await fetch('http://localhost:8000/generate-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: transcript.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail ?? `HTTP ${res.status}`)
      }
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : 'Unknown error')
      setGenerateStatus('error')
      setSpecLoading(false)
      return
    }
    setGenerateStatus('success')
    setRefreshKey((k) => k + 1)

    try {
      const specRes = await fetch('http://localhost:8000/generate-spec', {
        method: 'POST',
      })
      if (!specRes.ok) {
        const data = await specRes.json().catch(() => ({}))
        const detail =
          typeof data.detail === 'string'
            ? data.detail
            : JSON.stringify(data.detail ?? data)
        throw new Error(detail || `HTTP ${specRes.status}`)
      }
      const specJson: unknown = await specRes.json()
      const parsed = parseAndValidate(specJson)
      if (!parsed.ok) {
        const summary = parsed.issues
          .slice(0, 5)
          .map((i) => `${i.path}: ${i.message}`)
          .join('; ')
        throw new Error(`Invalid spec from backend: ${summary}`)
      }
      setSpec(parsed.spec)
    } catch (e) {
      setSpecError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSpecLoading(false)
    }
  }, [])

  // Ref so the effect always calls the latest transcript without being in deps
  const finalTranscriptRef = useRef(finalTranscript)
  finalTranscriptRef.current = finalTranscript

  // Flag set when user explicitly clicks Stop — cleared once generate fires
  const autoGenerateRef = useRef(false)

  const handleToggle = () => {
    if (isListening) {
      autoGenerateRef.current = true
      stop()
    } else {
      start()
    }
  }

  // Auto-generate when recording stops
  useEffect(() => {
    if (isListening || !autoGenerateRef.current) return
    autoGenerateRef.current = false
    handleGenerate(finalTranscriptRef.current)
  }, [isListening, handleGenerate])

  const handleCopy = async () => {
    if (!fullTranscript) return
    try {
      await navigator.clipboard.writeText(fullTranscript)
    } catch {
      /* clipboard may be unavailable; silent */
    }
  }

  const statusLabel = (() => {
    if (!isSupported) return 'Browser not supported'
    if (error) return `Error: ${error}`
    if (isListening) return mode === 'continuous' ? 'Listening continuously…' : 'Recording…'
    if (generateStatus === 'submitting') return 'Updating DESIGN.md…'
    return mode === 'continuous' ? 'Tap to start streaming' : 'Tap and hold the floor — click again to stop'
  })()

  return (
    <main className="stt-shell">
      <header className="stt-header">
        <p className="eyebrow">Step 1 / Pipeline</p>
        <h1>Describe the system you want to design</h1>
        <p className="lede">
          Speak naturally. We&rsquo;ll transcribe locally in your browser, then
          hand the text off to the LLM for spec generation, diagrams, and red-team review.
        </p>
      </header>

      <section className="capture-card" aria-label="Voice capture">
        <div className="mode-row" role="radiogroup" aria-label="Recognition mode">
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'push-to-talk'}
            className={`mode-pill ${mode === 'push-to-talk' ? 'active' : ''}`}
            onClick={() => setMode('push-to-talk')}
            disabled={isListening}
          >
            Push-to-talk
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'continuous'}
            className={`mode-pill ${mode === 'continuous' ? 'active' : ''}`}
            onClick={() => setMode('continuous')}
            disabled={isListening}
          >
            Continuous
          </button>
        </div>

        <button
          type="button"
          className={`record-btn ${isListening ? 'recording' : ''}`}
          onClick={handleToggle}
          disabled={!isSupported || generateStatus === 'submitting'}
          aria-pressed={isListening}
          aria-label={isListening ? 'Stop recording' : 'Start recording'}
        >
          <span className="record-dot" aria-hidden="true" />
          <span className="record-label">{isListening ? 'Stop' : 'Record'}</span>
        </button>

        <p className={`status ${error ? 'status-error' : ''}`} aria-live="polite">
          {statusLabel}
        </p>
      </section>

      <section className="transcript-card" aria-label="Transcript">
        <div className="transcript-header">
          <h2>Transcript</h2>
          <div className="transcript-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={handleCopy}
              disabled={!fullTranscript}
            >
              Copy
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={reset}
              disabled={!fullTranscript && !error}
            >
              Clear
            </button>
          </div>
        </div>

        <div className="transcript-body" aria-live="polite">
          {fullTranscript ? (
            <p>
              <span className="final">{finalTranscript}</span>
              {interimTranscript && (
                <>
                  {finalTranscript ? ' ' : ''}
                  <span className="interim">{interimTranscript}</span>
                </>
              )}
            </p>
          ) : (
            <p className="placeholder">
              Your spoken design will appear here. Try: &ldquo;I want to build a
              real-time chat app with end-to-end encryption and support for
              one million concurrent users.&rdquo;
            </p>
          )}
        </div>

        <footer className="transcript-footer">
          <span className="char-count">
            {finalTranscript.length} characters captured
          </span>
          {generateStatus === 'error' && (
            <span className="generate-inline-error">Generate failed: {generateError}</span>
          )}
        </footer>
      </section>

      <div className="output-panels">
        <DesignViewer refreshKey={refreshKey} />
        <SpecCanvas spec={spec} loading={specLoading} error={specError} />
      </div>
      <AuditViewer refreshKey={refreshKey} />

      {!isSupported && (
        <p className="unsupported-note">
          The Web Speech API isn&rsquo;t available in this browser. Try Chrome, Edge, or Safari.
        </p>
      )}
    </main>
  )
}

export default App
