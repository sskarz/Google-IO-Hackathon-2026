import { useEffect, useState, useRef } from 'react'

interface Task {
  id: string
  title: string
  description: string
  assigned_role: string
  status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'BLOCKED'
  error_msg?: string
}

interface FlowStatusResponse {
  run_id: string | null
  status: 'idle' | 'running' | 'completed' | 'failed' | 'blocked'
  started_at: string | null
  finished_at: string | null
  error: string | null
  workspace: string
  tasks: Task[]
}

const ROLE_ICONS: Record<string, string> = {
  ARCHITECT: '📐',
  BACKEND: '🐍',
  FRONTEND: '⚛️',
  TESTER: '🧪',
  VERIFIER: '🛡️',
  E2E_VERIFIER: '🚀',
}

const ROLE_COLORS: Record<string, string> = {
  ARCHITECT: '#a855f7',
  BACKEND: '#3b82f6',
  FRONTEND: '#06b6d4',
  TESTER: '#f59e0b',
  VERIFIER: '#10b981',
  E2E_VERIFIER: '#ec4899',
}

export function BuildPanel() {
  const [flowStatus, setFlowStatus] = useState<'idle' | 'running' | 'completed' | 'failed' | 'blocked'>('idle')
  const [tasks, setTasks] = useState<Task[]>([])
  const [workspace, setWorkspace] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [activeTaskDesc, setActiveTaskDesc] = useState<string | null>(null)
  const pollingIntervalRef = useRef<number | null>(null)

  const fetchStatus = async () => {
    try {
      const res = await fetch('http://localhost:8000/flow-status')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: FlowStatusResponse = await res.json()
      setFlowStatus(data.status)
      setTasks(data.tasks || [])
      setWorkspace(data.workspace || '')
      setError(data.error)
    } catch (e: unknown) {
      console.error('Failed to fetch build status:', e)
    }
  }

  const startBuild = async () => {
    setActionLoading(true)
    setError(null)
    try {
      const res = await fetch('http://localhost:8000/start-flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail || `HTTP ${res.status}`)
      }
      await fetchStatus()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start build flow.')
    } finally {
      setActionLoading(false)
    }
  }

  // Poll status when running or blocked
  useEffect(() => {
    if (flowStatus === 'running' || flowStatus === 'blocked') {
      if (!pollingIntervalRef.current) {
        // Initial fetch then start interval
        fetchStatus()
        pollingIntervalRef.current = window.setInterval(fetchStatus, 2000)
      }
    } else {
      if (pollingIntervalRef.current) {
        window.clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
    }

    return () => {
      if (pollingIntervalRef.current) {
        window.clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
    }
  }, [flowStatus])

  // Also fetch status on mount to check if a flow was already running
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStatus()
  }, [])

  const runningTask = tasks.find(t => t.status === 'IN_PROGRESS')
  const completedTasks = tasks.filter(t => t.status === 'DONE').length
  const totalTasks = tasks.length
  const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

  return (
    <section className="build-panel">
      <div className="build-panel-header">
        <div className="build-title-area">
          <span className="build-badge">Swarm Builder</span>
          <h2>Build Project System</h2>
        </div>
        {flowStatus !== 'idle' && (
          <span className={`build-status-pill ${flowStatus}`}>
            {flowStatus === 'running' ? '⚡ Building' : flowStatus === 'blocked' ? '⚠️ Blocked (Repairing)' : flowStatus === 'completed' ? '✓ Completed' : '✗ Failed'}
          </span>
        )}
      </div>

      {flowStatus === 'idle' ? (
        <div className="build-idle-state">
          <p className="build-desc">
            Your system design is complete and fully validated! Click below to spawn the Google Antigravity autonomous multi-agent swarm. They will write backend APIs, database configurations, React frontend widgets, and run comprehensive end-to-end tests inside the designated workspace.
          </p>
          {error && <p className="build-error-msg">{error}</p>}
          <button
            className="build-start-btn"
            onClick={startBuild}
            disabled={actionLoading}
          >
            {actionLoading ? '🚀 Spawning Swarm…' : '🛠 Start Building Project'}
          </button>
        </div>
      ) : (
        <div className="build-active-dashboard">
          <div className="build-progress-bar-container">
            <div className="build-progress-meta">
              <span>Codebase Compilation Progress</span>
              <span>{completedTasks}/{totalTasks} Tasks · {progressPct}%</span>
            </div>
            <div className="build-progress-bar">
              <div className="build-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>

          <div className="build-swarm-grid">
            {tasks.map(task => {
              const icon = ROLE_ICONS[task.assigned_role] || '🤖'
              const color = ROLE_COLORS[task.assigned_role] || 'var(--accent)'
              const isDescriptionActive = activeTaskDesc === task.id

              return (
                <div key={task.id} className={`task-card ${task.status.toLowerCase()}`}>
                  <div className="task-card-header">
                    <div className="task-agent" style={{ backgroundColor: `${color}15`, color }}>
                      <span>{icon}</span>
                      <span className="agent-role-name">{task.assigned_role}</span>
                    </div>
                    <span className={`task-status-dot ${task.status.toLowerCase()}`}>
                      {task.status}
                    </span>
                  </div>
                  <h4 className="task-card-title">{task.title}</h4>
                  
                  <button 
                    className="task-details-toggle"
                    onClick={() => setActiveTaskDesc(isDescriptionActive ? null : task.id)}
                  >
                    {isDescriptionActive ? 'Hide Guidelines ▲' : 'View Guidelines ▼'}
                  </button>

                  {isDescriptionActive && (
                    <div className="task-description-drawer">
                      <p>{task.description}</p>
                      {task.error_msg && (
                        <div className="task-error-box">
                          <strong>Error Report:</strong>
                          <pre>{task.error_msg}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {runningTask && (
            <div className="build-live-logger">
              <div className="live-logger-header">
                <span className="live-logger-dot" />
                <span>Live Swarm Console Output</span>
              </div>
              <div className="live-logger-console">
                <p className="console-line">
                  <span className="console-timestamp">[{new Date().toLocaleTimeString()}]</span>{' '}
                  <span className="console-role" style={{ color: ROLE_COLORS[runningTask.assigned_role] }}>
                    {runningTask.assigned_role} Agent
                  </span>{' '}
                  is executing: <span className="console-title">"{runningTask.title}"</span>...
                </p>
                <p className="console-line active">
                  &gt; Writing source assets and running validation routines in workspace: {workspace}...
                </p>
              </div>
            </div>
          )}

          {flowStatus === 'completed' && (
            <div className="build-completed-success-card">
              <h3>🎉 System Built Successfully!</h3>
              <p>The autonomous agent swarm has finished coding the workspace, resolving all unit test assertions, and passing final deterministic end-to-end verifications.</p>
              <p className="workspace-path">Workspace Location: <code>{workspace}</code></p>
            </div>
          )}

          {flowStatus === 'failed' && (
            <div className="build-failed-card">
              <h3>⚠️ Generation Flow Blocked or Failed</h3>
              <p>The orchestrator encountered a terminal failure. Please review individual agent guidelines and error logs above for detailed debugging information.</p>
              {error && <pre className="terminal-error">{error}</pre>}
              <button className="build-retry-btn" onClick={startBuild} disabled={actionLoading}>
                {actionLoading ? 'Retrying…' : '🔄 Restart Swarm Flow'}
              </button>
            </div>
          )}

          {flowStatus === 'blocked' && (
            <div className="build-blocked-info-card">
              <h3>⚡ Automated Repair Cycle Active</h3>
              <p>Deterministic checks failed, triggering the auto-repair engine in <code>dispatcher.py</code>. Coding repairs are being scheduled for the appropriate agents to resolve the bugs dynamically.</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
