class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const targetRate = options?.processorOptions?.targetSampleRate ?? 16000
    this._ratio = sampleRate / targetRate
    this._pos = 0
    this._buf = []
    this._flushAt = Math.ceil(targetRate * 0.1) // 100ms chunks
  }

  process(inputs) {
    const ch = inputs[0]?.[0]
    if (!ch?.length) return true

    while (this._pos < ch.length) {
      const i = Math.min(Math.floor(this._pos), ch.length - 1)
      this._buf.push(ch[i])
      this._pos += this._ratio
      if (this._buf.length >= this._flushAt) this._flush()
    }
    this._pos -= ch.length
    return true
  }

  _flush() {
    if (!this._buf.length) return
    const int16 = new Int16Array(this._buf.length)
    for (let i = 0; i < this._buf.length; i++) {
      int16[i] = Math.max(-32768, Math.min(32767, Math.round(this._buf[i] * 32767)))
    }
    this.port.postMessage(int16.buffer, [int16.buffer])
    this._buf = []
  }
}

registerProcessor('pcm-processor', PCMProcessor)
