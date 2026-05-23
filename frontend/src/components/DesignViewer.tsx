import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'

interface Props {
  refreshKey: number
}

export function DesignViewer({ refreshKey }: Props) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch('http://localhost:8000/design-md')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d) => setContent(d.content ?? ''))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [refreshKey])

  if (loading) {
    return (
      <section className="design-viewer" aria-label="System design document">
        <div className="design-viewer-header">
          <h2>DESIGN.md</h2>
        </div>
        <p className="design-viewer-state">Generating design document…</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className="design-viewer" aria-label="System design document">
        <div className="design-viewer-header">
          <h2>DESIGN.md</h2>
        </div>
        <p className="design-viewer-state error">Failed to load: {error}</p>
      </section>
    )
  }

  if (!content) return null

  return (
    <section className="design-viewer" aria-label="System design document">
      <div className="design-viewer-header">
        <h2>DESIGN.md</h2>
        <span className="design-viewer-badge">Current design</span>
      </div>
      <div className="design-viewer-body">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </section>
  )
}
