import { useCallback, useRef, useState } from 'react'

interface UseAudioCaptureReturn {
  isRecording: boolean
  start: () => Promise<void>
  stop: () => Promise<Blob>
  error: string | null
}

const PREFERRED_MIME = 'audio/ogg;codecs=opus'
const FALLBACK_MIME = 'audio/webm;codecs=opus'

function getSupportedMime(): string {
  if (MediaRecorder.isTypeSupported(PREFERRED_MIME)) return PREFERRED_MIME
  if (MediaRecorder.isTypeSupported(FALLBACK_MIME)) return FALLBACK_MIME
  return ''
}

export function useAudioCapture(): UseAudioCaptureReturn {
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const resolveRef = useRef<((blob: Blob) => void) | null>(null)

  const start = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = getSupportedMime()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' })
        resolveRef.current?.(blob)
        resolveRef.current = null
      }

      recorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Microphone access denied')
    }
  }, [])

  const stop = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve
      recorderRef.current?.stop()
      setIsRecording(false)
    })
  }, [])

  return { isRecording, start, stop, error }
}
