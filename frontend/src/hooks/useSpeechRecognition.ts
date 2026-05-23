import { useCallback, useEffect, useRef, useState } from 'react'

// Web Speech API types — not always present in lib.dom.d.ts depending on TS version.
interface SpeechRecognitionAlternative {
  readonly transcript: string
  readonly confidence: number
}
interface SpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}
interface SpeechRecognitionResultList {
  readonly length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string
  readonly message: string
}
interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null
  onend: ((this: SpeechRecognition, ev: Event) => void) | null
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null
  start(): void
  stop(): void
  abort(): void
}
type SpeechRecognitionConstructor = new () => SpeechRecognition

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

export type RecognitionMode = 'push-to-talk' | 'continuous'

interface UseSpeechRecognitionOptions {
  mode: RecognitionMode
  lang?: string
}

interface UseSpeechRecognitionReturn {
  isSupported: boolean
  isListening: boolean
  finalTranscript: string
  interimTranscript: string
  error: string | null
  start: () => void
  stop: () => void
  reset: () => void
}

function getRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export function useSpeechRecognition({
  mode,
  lang = 'en-US',
}: UseSpeechRecognitionOptions): UseSpeechRecognitionReturn {
  const Ctor = getRecognitionCtor()
  const isSupported = Ctor !== null

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  // shouldKeepListeningRef tracks user intent: in continuous mode the browser
  // often auto-ends on silence, and we want to restart unless the user stopped.
  const shouldKeepListeningRef = useRef(false)
  const modeRef = useRef(mode)
  modeRef.current = mode

  const [isListening, setIsListening] = useState(false)
  const [finalTranscript, setFinalTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)

  const buildRecognition = useCallback((): SpeechRecognition | null => {
    if (!Ctor) return null
    const r = new Ctor()
    r.continuous = true
    r.interimResults = true
    r.lang = lang
    r.maxAlternatives = 1

    r.onresult = (event) => {
      let interim = ''
      let finalsToAppend = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0].transcript
        if (result.isFinal) {
          finalsToAppend += transcript
        } else {
          interim += transcript
        }
      }
      if (finalsToAppend) {
        setFinalTranscript((prev) => (prev ? `${prev} ${finalsToAppend.trim()}` : finalsToAppend.trim()))
      }
      setInterimTranscript(interim)
    }

    r.onerror = (event) => {
      // 'no-speech' and 'aborted' are routine; surface everything else.
      if (event.error === 'no-speech' || event.error === 'aborted') return
      setError(event.error || 'Unknown speech recognition error')
      shouldKeepListeningRef.current = false
    }

    r.onend = () => {
      if (shouldKeepListeningRef.current && modeRef.current === 'continuous') {
        try {
          r.start()
          return
        } catch {
          // fall through to stopped state
        }
      }
      setIsListening(false)
      setInterimTranscript('')
    }

    r.onstart = () => {
      setIsListening(true)
      setError(null)
    }

    return r
  }, [Ctor, lang])

  const start = useCallback(() => {
    if (!isSupported) {
      setError('Speech recognition is not supported in this browser.')
      return
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort()
      } catch {
        /* noop */
      }
    }
    const r = buildRecognition()
    if (!r) return
    recognitionRef.current = r
    shouldKeepListeningRef.current = true
    try {
      r.start()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start recognition')
      shouldKeepListeningRef.current = false
    }
  }, [buildRecognition, isSupported])

  const stop = useCallback(() => {
    shouldKeepListeningRef.current = false
    const r = recognitionRef.current
    if (!r) return
    try {
      r.stop()
    } catch {
      /* noop */
    }
  }, [])

  const reset = useCallback(() => {
    setFinalTranscript('')
    setInterimTranscript('')
    setError(null)
  }, [])

  useEffect(() => {
    return () => {
      shouldKeepListeningRef.current = false
      const r = recognitionRef.current
      if (r) {
        try {
          r.abort()
        } catch {
          /* noop */
        }
      }
    }
  }, [])

  return {
    isSupported,
    isListening,
    finalTranscript,
    interimTranscript,
    error,
    start,
    stop,
    reset,
  }
}
