import { useMemo, useState } from 'react'
import {
  useSpeechRecognition,
  type RecognitionMode,
} from './hooks/useSpeechRecognition'
import './App.css'

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

  const handleToggle = () => {
    if (isListening) stop()
    else start()
  }

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
          disabled={!isSupported}
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
        </footer>
      </section>

      {!isSupported && (
        <p className="unsupported-note">
          The Web Speech API isn&rsquo;t available in this browser. Try Chrome, Edge, or Safari.
        </p>
      )}
    </main>
  )
}

export default App
