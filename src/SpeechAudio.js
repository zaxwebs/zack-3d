const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const smooth = (current, target, seconds, delta) => current + (target - current) * (1 - Math.exp(-delta / seconds));

/** Local, causal audio features. Shape estimates are not phoneme recognition. */
export class SpeechEnvelope {
  constructor() { this.gateDb = -52; this.sensitivity = 1; this.reset(); }
  reset() { this.open = 0; this.spread = 0; this.round = 0; this.hold = 0; this.db = -100; this.level = 0; }
  update(samples, spectrum, sampleRate, delta) {
    delta = clamp(Number.isFinite(delta) ? delta : 0, 0, 0.1);
    let power = 0, mean = 0;
    for (const sample of samples) mean += sample;
    mean /= samples.length || 1;
    for (const sample of samples) power += (sample - mean) ** 2;
    const rms = Math.sqrt(power / (samples.length || 1));
    this.db = 20 * Math.log10(Math.max(rms, 0.00001));
    this.level = clamp((this.db + 70) / 60);
    const adjustedDb = this.db + 20 * Math.log10(this.sensitivity);
    const speaking = adjustedDb > this.gateDb + (this.hold > 0 ? 0 : 3);
    this.hold = speaking ? 0.045 : Math.max(0, this.hold - delta);
    const target = this.hold > 0 ? clamp((adjustedDb - this.gateDb) / 30) ** 0.75 : 0;
    this.open = smooth(this.open, target, target > this.open ? 0.025 : 0.075, delta);
    if (this.open < 0.001) this.open = 0;
    let low = 0, mid = 0, high = 0;
    const binHz = sampleRate / (spectrum.length * 2);
    for (let i = 1; i < spectrum.length; i++) {
      const hz = i * binHz;
      if (hz < 150 || hz > 6000) continue;
      const energy = 10 ** (Math.max(-100, spectrum[i]) / 10);
      if (hz < 700) low += energy;
      else if (hz < 2200) mid += energy;
      else high += energy;
    }
    const sum = low + mid + high;
    const round = sum > 1e-9 ? clamp((low / sum - 0.40) / 0.50) : 0;
    const spread = sum > 1e-9 ? clamp((mid + high) / sum * 1.4 - 0.25) : 0;
    this.round = smooth(this.round, round, 0.07, delta);
    this.spread = smooth(this.spread, spread, 0.07, delta);
    return { open: this.open, round: this.round, spread: this.spread };
  }
}

const ERROR_MESSAGES = {
  NotAllowedError: 'Microphone access was denied. Allow it in your browser’s site settings, then try again.',
  NotFoundError: 'No microphone was found. Connect one, then try again.',
  NotReadableError: 'The microphone could not be opened. Check whether another app is using it.',
  OverconstrainedError: 'That microphone is unavailable. Choose Default microphone and try again.',
  SecurityError: 'Microphone access requires HTTPS or localhost.',
};

export class SpeechAudio {
  constructor(face, onChange = () => {}) {
    this.face = face; this.onChange = onChange; this.envelope = new SpeechEnvelope();
    this.state = 'idle'; this.message = 'Mic off. Preview the motion or start your microphone.';
    this.generation = 0; this.demoTime = 0;
  }
  notify(state, message) { this.state = state; this.message = message; this.onChange(this); }
  async start(deviceId = '') {
    this.stop();
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.notify('error', 'Microphone access requires HTTPS or localhost and a supported browser.'); return;
    }
    const generation = this.generation;
    let context, stream, source, analyser, silent;
    this.notify('requesting', 'Allow microphone access in your browser.');
    try {
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      context = new AudioContext({ latencyHint: 'interactive' });
      this.context = context;
      const resumed = context.resume();
      // Handle an early resume rejection while the permission prompt is open.
      resumed.catch(() => {});
      stream = await navigator.mediaDevices.getUserMedia({ audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: false,
      }, video: false });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      await resumed;
      if (generation !== this.generation) return;
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0;
      // Keep the graph processing without playing the mic back to the speakers.
      silent = context.createGain(); silent.gain.value = 0;
      source.connect(analyser); analyser.connect(silent); silent.connect(context.destination);
      this.source = source; this.analyser = analyser; this.silent = silent;
      this.samples = new Float32Array(analyser.fftSize); this.spectrum = new Float32Array(analyser.frequencyBinCount);
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => {
        if (generation !== this.generation) return;
        this.stop(); this.notify('error', 'Microphone disconnected. Choose a microphone and start again.');
      });
      this.notify('live', 'Listening locally. Speak to animate Zack.');
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (generation !== this.generation) return;
      this.stop();
      this.notify('error', ERROR_MESSAGES[error.name] || `Could not start the microphone: ${error.message}`);
    } finally {
      if (generation !== this.generation && context?.state !== 'closed') await context?.close().catch(() => {});
    }
  }
  preview() {
    this.stop(); this.demoTime = 0;
    this.notify('demo', 'Previewing open, wide, and rounded speech shapes.');
  }
  stop() {
    this.generation++;
    this.stream?.getTracks().forEach(track => track.stop());
    this.source?.disconnect(); this.analyser?.disconnect(); this.silent?.disconnect();
    if (this.context && this.context.state !== 'closed') this.context.close().catch(() => {});
    this.stream = this.source = this.analyser = this.silent = this.context = null;
    this.envelope.reset(); this.face.reset();
    this.notify('idle', 'Mic off. Preview the motion or start your microphone.');
  }
  update(delta) {
    if (this.state === 'demo') {
      this.demoTime += delta;
      if (this.demoTime >= 6) { this.stop(); return; }
      const phrase = Math.floor(this.demoTime / 2);
      const syllable = Math.max(0, Math.sin(this.demoTime * Math.PI * 3));
      this.face.setPose({ open: syllable * 0.85, spread: phrase === 1 ? 0.95 : 0.1, round: phrase === 2 ? 0.95 : 0 });
    } else if (this.state === 'live') {
      if (this.context.state !== 'running' || this.stream.getAudioTracks().every(track => track.muted)) {
        this.face.reset(); this.envelope.reset();
        const message = 'Microphone audio is paused. Stop and start the mic to resume.';
        if (this.message !== message) this.notify('live', message);
        return;
      }
      if (this.message !== 'Listening locally. Speak to animate Zack.') this.notify('live', 'Listening locally. Speak to animate Zack.');
      this.analyser.getFloatTimeDomainData(this.samples);
      this.analyser.getFloatFrequencyData(this.spectrum);
      this.face.setPose(this.envelope.update(this.samples, this.spectrum, this.context.sampleRate, delta));
    }
  }
  get level() { return this.state === 'demo' ? this.face.state.open : this.envelope.level; }
}
