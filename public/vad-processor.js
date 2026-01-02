class VADProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // tunables
    this.frameMs = 30;
    this.silenceHoldMs = 500;
    this.prerollMs = 250;
    this.startTriggerFrames = 5;
    this.maxUtteranceMs = 20000;

    // derived
    this.sr = sampleRate;
    this.frameSize = Math.round(this.sr * this.frameMs / 1000);
    this.silenceFramesNeeded = Math.ceil(this.silenceHoldMs / this.frameMs);
    this.prerollFrames = Math.max(1, Math.floor(this.prerollMs / this.frameMs));
    this.minUtteranceMs = 200; // drop anything shorter than this
    this.minUtteranceFrames = Math.ceil(this.minUtteranceMs / this.frameMs);
    this.maxUtteranceFrames = Math.ceil(this.maxUtteranceMs / this.frameMs);


    // state
    this._buf = new Float32Array(0);
    this.preroll = [];
    this.inUtt = false;
    this.frames = [];
    this.silentFrames = 0;
    this.speechRun = 0;

    // adaptive threshold
    this.noiseFloor = 0.0;
    this.noiseAlpha = 0.02;
    this.threshMult = 3.0;
    this.threshMin = 0.008;
  }

  rms(x) {
    let sum = 0.0;
    for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
    return Math.sqrt(sum / Math.max(1, x.length));
  }

  isSpeech(frame) {
    const r = this.rms(frame);
    if (!this.inUtt) {
      if (this.noiseFloor === 0.0) this.noiseFloor = r;
      this.noiseFloor = (1 - this.noiseAlpha) * this.noiseFloor + this.noiseAlpha * r;
    }
    const thr = Math.max(this.threshMin, this.noiseFloor * this.threshMult);
    return r > thr;
  }

  floatToInt16(frame) {
    const out = new Int16Array(frame.length);
    for (let i = 0; i < frame.length; i++) {
      let x = frame[i];
      x = Math.max(-1, Math.min(1, x));
      out[i] = (x * 32767) | 0;
    }
    return out;
  }

  pushPreroll(int16Frame) {
    this.preroll.push(int16Frame);
    if (this.preroll.length > this.prerollFrames) this.preroll.shift();
  }

  emitUtterance() {
    let total = 0;
    for (const f of this.frames) total += f.length;
    const pcm = new Int16Array(total);
    let off = 0;
    for (const f of this.frames) {
      pcm.set(f, off);
      off += f.length;
    }

    this.port.postMessage(
      { type: "utterance", pcm: pcm.buffer, sampleRate: this.sr },
      [pcm.buffer]
    );
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch0 = input[0];
    if (!ch0) return true;

    // append to buffer
    const merged = new Float32Array(this._buf.length + ch0.length);
    merged.set(this._buf, 0);
    merged.set(ch0, this._buf.length);
    this._buf = merged;

    while (this._buf.length >= this.frameSize) {
      const frame = this._buf.slice(0, this.frameSize);
      this._buf = this._buf.slice(this.frameSize);

      const speech = this.isSpeech(frame);
      const pcm16 = this.floatToInt16(frame);

      if (!this.inUtt) {
        this.pushPreroll(pcm16);
        this.speechRun = speech ? (this.speechRun + 1) : 0;

        if (this.speechRun >= this.startTriggerFrames) {
          this.inUtt = true;
          this.silentFrames = 0;
          this.frames = this.preroll.slice();
        }
      } else {
        this.frames.push(pcm16);
        this.silentFrames = speech ? 0 : (this.silentFrames + 1);

        if (this.silentFrames >= this.silenceFramesNeeded || this.frames.length >= this.maxUtteranceFrames) {
          // trim held silence
          if (this.silentFrames >= this.silenceFramesNeeded && this.silentFrames < this.frames.length) {
            this.frames = this.frames.slice(0, this.frames.length - this.silentFrames);
          }

          if (this.frames.length >= this.minUtteranceFrames) {
            this.emitUtterance();
          } else {
            // too short, drop it
          }

          // reset
          this.inUtt = false;
          this.frames = [];
          this.silentFrames = 0;
          this.speechRun = 0;
          this.preroll = [];
        }
      }
    }

    return true;
  }
}

registerProcessor("vad-processor", VADProcessor);
