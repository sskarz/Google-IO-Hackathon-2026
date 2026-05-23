import { useEffect, useRef } from 'react'
import { useLiveAudio } from '../hooks/useLiveAudio'

const SECTION_LABELS: Record<string, string> = {
  goals: 'Goals',
  architecture: 'Architecture',
  components: 'Components',
  data_flow: 'Data Flow',
}
const SECTIONS_ORDER = ['goals', 'architecture', 'components', 'data_flow']

interface Props {
  onDesignSaved: () => void
  onSectionConfirmed?: (nextSection: string | null) => void
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function AuditorPanel({ onDesignSaved, onSectionConfirmed }: Props) {
  const {
    connected,
    speaking,
    muted,
    elapsedMs,
    sectionsProgress,
    currentSection,
    designSaved,
    error,
    connect,
    sendDone,
    reset,
    toggleMute,
  } = useLiveAudio(onDesignSaved, onSectionConfirmed)

  const didConnectRef = useRef(false)
  useEffect(() => {
    if (didConnectRef.current) return
    didConnectRef.current = true
    connect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const completed = SECTIONS_ORDER.filter(s => sectionsProgress[s]).length
  const total = SECTIONS_ORDER.length
  const pct = Math.round((completed / total) * 100)

  const orbState = designSaved
    ? 'complete'
    : speaking
    ? 'speaking'
    : !connected
    ? 'loading'
    : muted
    ? 'muted'
    : 'listening'

  const statusText = !connected
    ? 'Connecting…'
    : designSaved
    ? "✓ Design complete — you're good to go"
    : speaking
    ? 'Speaking…'
    : muted
    ? 'Mic off — press Start to talk'
    : `Discussing: ${SECTION_LABELS[currentSection ?? 'goals'] ?? currentSection}`

  return (
    <section className="auditor-panel">
      <div className="auditor-checklist">
        <div className="checklist-header">
          <span>Design Progress</span>
          <span>{completed}/{total} · {formatElapsed(elapsedMs)}</span>
        </div>
        <div className="checklist-bar">
          <div className="checklist-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="checklist-items">
          {SECTIONS_ORDER.map(key => {
            const confirmed = !!sectionsProgress[key]
            const active = key === currentSection && !designSaved && !confirmed
            return (
              <span
                key={key}
                className={`checklist-item ${confirmed ? 'done' : active ? 'active' : ''}`}
              >
                {confirmed ? '✓' : active ? '→' : '○'} {SECTION_LABELS[key]}
              </span>
            )
          })}
        </div>
      </div>

      <div className="auditor-status-area">
        <div className={`auditor-orb ${orbState}`} />
        <p className={`auditor-status-text ${designSaved ? 'complete' : ''}`}>
          {statusText}
        </p>
      </div>

      <div className="auditor-controls">
        {error && <p className="auditor-error">{error}</p>}
        <div className="auditor-btns">
          <button
            className={muted ? 'done-btn' : 'ghost-btn'}
            onClick={toggleMute}
            disabled={!connected || designSaved}
          >
            {muted ? '● Start' : '■ Stop'}
          </button>
          <button
            className="done-btn"
            onClick={sendDone}
            disabled={!connected || designSaved || completed === 0}
          >
            {designSaved ? 'Done ✓' : 'Done — Generate'}
          </button>
          {(designSaved || completed > 0) && (
            <button className="ghost-btn" onClick={reset}>
              Reset
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
