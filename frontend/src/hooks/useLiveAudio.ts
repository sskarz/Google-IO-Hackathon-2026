import { useCallback, useEffect, useRef, useState } from 'react'

const WS_URL = 'ws://localhost:8000/auditor/ws'
const OUTPUT_RATE = 24000

export interface LiveAudioState {
  connected: boolean
  speaking: boolean
  muted: boolean
  elapsedMs: number
  sectionsProgress: Record<string, boolean>
  currentSection: string | null
  designSaved: boolean
  error: string | null
}

export function useLiveAudio(
  onDesignSaved: () => void,
  onSectionConfirmed?: (sectionKey: string | null) => void
) {
  const [state, setState] = useState<LiveAudioState>({
    connected: false,
    speaking: false,
    muted: true,
    elapsedMs: 0,
    sectionsProgress: {},
    currentSection: 'goals',
    designSaved: false,
    error: null,
  })

  const wsRef = useRef<WebSocket | null>(null)
  const captureCtxRef = useRef<AudioContext | null>(null)
  const playCtxRef = useRef<AudioContext | null>(null)
  const nextPlayRef = useRef(0)
  const speakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const designSavedRef = useRef(false)
  const mutedRef = useRef(true)
  const accumulatedMsRef = useRef(0)
  const tickStartRef = useRef<number | null>(null)
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    designSavedRef.current = state.designSaved
  }, [state.designSaved])

  useEffect(() => {
    mutedRef.current = state.muted
  }, [state.muted])

  const startTimer = useCallback(() => {
    if (tickIntervalRef.current) return
    tickStartRef.current = Date.now()
    tickIntervalRef.current = setInterval(() => {
      const start = tickStartRef.current
      if (start == null) return
      const total = accumulatedMsRef.current + (Date.now() - start)
      setState(s => ({ ...s, elapsedMs: total }))
    }, 500)
  }, [])

  const pauseTimer = useCallback(() => {
    if (tickStartRef.current != null) {
      accumulatedMsRef.current += Date.now() - tickStartRef.current
      tickStartRef.current = null
    }
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current)
      tickIntervalRef.current = null
    }
  }, [])

  const resetTimer = useCallback(() => {
    pauseTimer()
    accumulatedMsRef.current = 0
    setState(s => ({ ...s, elapsedMs: 0 }))
  }, [pauseTimer])

  const playChunk = useCallback((buf: ArrayBuffer) => {
    if (!playCtxRef.current || playCtxRef.current.state === 'closed') {
      playCtxRef.current = new AudioContext({ sampleRate: OUTPUT_RATE })
      nextPlayRef.current = 0
    }
    const ctx = playCtxRef.current
    const int16 = new Int16Array(buf)
    if (!int16.length) return

    const f32 = new Float32Array(int16.length)
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768

    const ab = ctx.createBuffer(1, f32.length, OUTPUT_RATE)
    ab.getChannelData(0).set(f32)
    const src = ctx.createBufferSource()
    src.buffer = ab
    src.connect(ctx.destination)

    const startAt = Math.max(ctx.currentTime + 0.08, nextPlayRef.current)
    src.start(startAt)
    nextPlayRef.current = startAt + ab.duration

    setState(s => ({ ...s, speaking: true }))
    if (speakTimerRef.current) clearTimeout(speakTimerRef.current)
    speakTimerRef.current = setTimeout(
      () => setState(s => ({ ...s, speaking: false })),
      400
    )
  }, [])

  const connect = useCallback(async () => {
    // Guard against duplicate connects (React StrictMode double-mount, double-clicks, etc.)
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN ||
                          wsRef.current.readyState === WebSocket.CONNECTING)) {
      return
    }
    wsRef.current?.close()
    captureCtxRef.current?.close()
    streamRef.current?.getTracks().forEach(t => t.stop())

    setState(s => ({ ...s, error: null, connected: false }))

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      streamRef.current = stream
    } catch {
      setState(s => ({ ...s, error: 'Microphone access denied' }))
      return
    }

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws
    ws.binaryType = 'arraybuffer'

    ws.onopen = async () => {
      setState(s => ({ ...s, connected: true }))
      startTimer()

      const ctx = new AudioContext()
      captureCtxRef.current = ctx

      try {
        await ctx.audioWorklet.addModule('/pcm-processor.js')
      } catch (e) {
        setState(s => ({ ...s, error: `AudioWorklet load failed: ${e}` }))
        return
      }

      const source = ctx.createMediaStreamSource(stream)
      const worklet = new AudioWorkletNode(ctx, 'pcm-processor', {
        processorOptions: { targetSampleRate: 16000 },
      })

      worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        // Mute gate — drop chunks while muted, keep WS open
        if (mutedRef.current) return
        if (ws.readyState === WebSocket.OPEN) ws.send(e.data)
      }

      source.connect(worklet)
      // not connected to destination — avoids mic echo
    }

    ws.onmessage = (e: MessageEvent) => {
      if (e.data instanceof ArrayBuffer) {
        playChunk(e.data)
      } else {
        try {
          const msg = JSON.parse(e.data as string)
          if (msg.type === 'progress') {
            setState(s => ({
              ...s,
              sectionsProgress: msg.sections_progress ?? s.sectionsProgress,
              currentSection: msg.current_section ?? s.currentSection,
            }))
            // A section just got confirmed and DESIGN.md was rewritten with
            // the accumulated content. Let the parent refetch the partial
            // design + regenerate the spec so the 3D scene grows in lockstep.
            onSectionConfirmed?.(msg.current_section ?? null)
          } else if (msg.type === 'design_saved') {
            setState(s => ({
              ...s,
              sectionsProgress: msg.sections_progress ?? s.sectionsProgress,
              currentSection: null,
              designSaved: true,
              muted: true,
            }))
            designSavedRef.current = true
            onDesignSaved()
            // Stop everything — mic, audio, ws
            if (reconnectTimerRef.current) {
              clearTimeout(reconnectTimerRef.current)
              reconnectTimerRef.current = null
            }
            streamRef.current?.getTracks().forEach(t => t.stop())
            streamRef.current = null
            captureCtxRef.current?.close().catch(() => {})
            captureCtxRef.current = null
            // Keep the WS open long enough for Gemini's "you're good to go"
            // wrap-up speech to stream through and play. The backend normally
            // closes the connection itself once Gemini emits turn_complete
            // after finalize_design; this is a safety net.
            setTimeout(() => {
              wsRef.current?.close()
              wsRef.current = null
              playCtxRef.current?.close().catch(() => {})
              playCtxRef.current = null
              nextPlayRef.current = 0
              pauseTimer()
            }, 20000)
          } else if (msg.type === 'error') {
            setState(s => ({ ...s, error: `Live: ${msg.message}` }))
          }
        } catch {}
      }
    }

    ws.onerror = () => setState(s => ({ ...s, error: 'WebSocket connection failed' }))
    ws.onclose = () => {
      if (wsRef.current !== ws) return
      wsRef.current = null
      pauseTimer()
      setState(s => ({ ...s, connected: false }))
      stream.getTracks().forEach(t => t.stop())
      captureCtxRef.current?.close().catch(() => {})
      captureCtxRef.current = null
      playCtxRef.current?.close().catch(() => {})
      playCtxRef.current = null
      nextPlayRef.current = 0
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null
        if (!designSavedRef.current && !wsRef.current) connect()
      }, 5000)
    }
  }, [playChunk, onDesignSaved, onSectionConfirmed, startTimer, pauseTimer])

  const disconnect = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
    captureCtxRef.current?.close()
    captureCtxRef.current = null
    playCtxRef.current?.close()
    playCtxRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    pauseTimer()
  }, [pauseTimer])

  const sendDone = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'done' }))
    }
  }, [])

  const toggleMute = useCallback(() => {
    setState(s => {
      const nextMuted = !s.muted
      // Notify backend so it can send audio_stream_end to Gemini (per docs:
      // flush cached audio when stream pauses)
      if (nextMuted && wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: 'mute' }))
        } catch {}
      }
      return { ...s, muted: nextMuted }
    })
  }, [])

  const reset = useCallback(async () => {
    disconnect()
    await fetch('http://localhost:8000/auditor/reset', { method: 'POST' }).catch(() => {})
    resetTimer()
    setState({
      connected: false,
      speaking: false,
      muted: true,
      elapsedMs: 0,
      sectionsProgress: {},
      currentSection: 'goals',
      designSaved: false,
      error: null,
    })
  }, [disconnect, resetTimer])

  return { ...state, connect, disconnect, sendDone, reset, toggleMute }
}
