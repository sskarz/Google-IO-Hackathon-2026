import { useEffect, useState } from 'react'

interface AuditResult {
  issues: string[]
  questions: string[]
}

interface Props {
  refreshKey: number
}

export function AuditViewer({ refreshKey }: Props) {
  const [result, setResult] = useState<AuditResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (refreshKey === 0) return
    setLoading(true)
    setError(null)
    fetch('http://localhost:8000/audit')
      .then((r) => {
        if (!r.ok) return r.json().then((d) => Promise.reject(d.detail ?? `HTTP ${r.status}`))
        return r.json()
      })
      .then((d) => setResult(d))
      .catch((e) => setError(typeof e === 'string' ? e : e.message))
      .finally(() => setLoading(false))
  }, [refreshKey])

  if (refreshKey === 0) return null

  return (
    <section className="audit-viewer" aria-label="Design audit">
      <div className="audit-header">
        <h2>Audit</h2>
        {loading && <span className="audit-running">Running…</span>}
      </div>

      {error && <p className="audit-state error">Audit failed: {error}</p>}

      {!loading && result && (
        <div className="audit-body">
          {result.issues.length > 0 && (
            <div className="audit-section">
              <h3>Issues</h3>
              <ul className="audit-list issues">
                {result.issues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </div>
          )}

          {result.questions.length > 0 && (
            <div className="audit-section">
              <h3>Follow-up Questions</h3>
              <ul className="audit-list questions">
                {result.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
