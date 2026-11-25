// Scratch That sounds, 100% synthesised (spec section 4). No audio files.

interface ToneOpts {
  freq: number
  freqEnd?: number
  type?: OscillatorType
  dur?: number
  gain?: number
  attack?: number
  delay?: number
}
interface NoiseOpts {
  dur?: number
  gain?: number
  filter?: BiquadFilterType
  freq?: number
  freqEnd?: number
  q?: number
  attack?: number
  delay?: number
}

/** One continuous scrape voice (one per pointer). */
export interface ScrapeVoice {
  /** speed px/s, foilAmt 0..1, residue 0..1 (cells turning clean), onFelt */
  set(speed: number, foil: number, residue: number, felt: boolean): void
  stop(): void
}

class AudioEngine {
  ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null

  /** Build the context ahead of the first touch (it starts suspended), so that touch is not a long task. */
  prepare(): void {
    if (this.ctx) return
    this.unlock(false)
  }

  /** Call from every pointerdown; the first one creates the context if prepare() has not. */
  unlock(resume = true): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      const ctx = new AC({ latencyHint: 'interactive' })
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -12
      comp.knee.value = 10
      comp.ratio.value = 4
      comp.attack.value = 0.002
      comp.release.value = 0.12
      const master = ctx.createGain()
      master.gain.value = 0.9
      master.connect(comp).connect(ctx.destination)
      const len = ctx.sampleRate * 2
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      this.ctx = ctx
      this.master = master
      this.noiseBuf = buf
    }
    if (resume && this.ctx.state !== 'running') void this.ctx.resume()
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend()
  }

  private get ok(): boolean {
    return !!this.ctx && !!this.master
  }

  tone(o: ToneOpts): void {
    if (!this.ok) return
    const ctx = this.ctx!
    const t0 = ctx.currentTime + (o.delay ?? 0)
    const dur = o.dur ?? 0.2
    const osc = ctx.createOscillator()
    osc.type = o.type ?? 'sine'
    osc.frequency.setValueAtTime(o.freq, t0)
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t0 + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(o.gain ?? 0.3, t0 + (o.attack ?? 0.004))
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g).connect(this.master!)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  noise(o: NoiseOpts): void {
    if (!this.ok) return
    const ctx = this.ctx!
    const t0 = ctx.currentTime + (o.delay ?? 0)
    const dur = o.dur ?? 0.3
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    src.loop = true
    const f = ctx.createBiquadFilter()
    f.type = o.filter ?? 'lowpass'
    f.frequency.setValueAtTime(o.freq ?? 2000, t0)
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t0 + dur)
    f.Q.value = o.q ?? 0.8
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(o.gain ?? 0.4, t0 + (o.attack ?? 0.003))
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(f).connect(g).connect(this.master!)
    src.start(t0, Math.random() * 1.5)
    src.stop(t0 + dur + 0.02)
  }

  // ---------- presets ----------

  /** pointerdown on the card: a 5 ms click through 3 kHz plus a 5.2 kHz ping, pitch +-4%. */
  coinTick(): void {
    const p = 1 + (Math.random() * 2 - 1) * 0.04
    this.noise({ dur: 0.005, gain: 0.16, filter: 'bandpass', freq: 3000 * p, q: 2, attack: 0.0005 })
    this.tone({ freq: 5200 * p, dur: 0.045, gain: 0.05, attack: 0.001 })
  }

  /** Continuous scrape: bright scritch on foil, dull on paper, lowpassed hush on felt. */
  scrape(): ScrapeVoice {
    if (!this.ok) return { set() {}, stop() {} }
    const ctx = this.ctx!
    const t0 = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    src.loop = true
    // A: the scritch, amplitude-modulated by band-limited noise at 40 to 90 Hz
    const bpA = ctx.createBiquadFilter()
    bpA.type = 'bandpass'
    bpA.frequency.value = 3400
    bpA.Q.value = 1.2
    const amA = ctx.createGain()
    amA.gain.value = 0.5
    const mod = ctx.createBufferSource()
    mod.buffer = this.noiseBuf
    mod.loop = true
    const modLp = ctx.createBiquadFilter()
    modLp.type = 'bandpass'
    modLp.frequency.value = 65
    modLp.Q.value = 0.9
    const modDepth = ctx.createGain()
    modDepth.gain.value = 0.5 * 3 // the band-limited noise is quiet; scale to about +-depth
    mod.connect(modLp).connect(modDepth).connect(amA.gain)
    // B: the card drumming on the felt
    const bpB = ctx.createBiquadFilter()
    bpB.type = 'bandpass'
    bpB.frequency.value = 420
    bpB.Q.value = 0.8
    const gB = ctx.createGain()
    gB.gain.value = 0.25
    // felt: lowpassed noise at 500 Hz
    const lpF = ctx.createBiquadFilter()
    lpF.type = 'lowpass'
    lpF.frequency.value = 500
    const gF = ctx.createGain()
    gF.gain.value = 0
    const gAB = ctx.createGain()
    gAB.gain.value = 0
    src.connect(bpA).connect(amA).connect(gAB)
    src.connect(bpB).connect(gB).connect(gAB)
    src.connect(lpF).connect(gF)
    gAB.connect(this.master!)
    gF.connect(this.master!)
    src.start(t0, Math.random() * 1.5)
    mod.start(t0, Math.random() * 1.5)
    let stopped = false
    return {
      set(speed, foil, residue, felt) {
        if (stopped) return
        const t = ctx.currentTime
        const sf = Math.max(0, Math.min(1, speed / 1200))
        // foil weight: foil voice on foil, 30% of it over residue, paper voice otherwise
        const fw = Math.max(foil, 0.3 * residue)
        const centre = (1300 + (3400 + 1200 * sf - 1300) * fw)
        bpA.frequency.setTargetAtTime(centre, t, 0.015)
        modDepth.gain.setTargetAtTime((0.2 + 0.3 * fw) * 3, t, 0.015)
        const g = felt ? 0 : 0.22 * sf * (0.4 + 0.6 * fw)
        gAB.gain.setTargetAtTime(g, t, 0.015)
        gF.gain.setTargetAtTime(felt ? 0.04 * sf * 4 : 0, t, 0.015)
      },
      stop() {
        if (stopped) return
        stopped = true
        const t = ctx.currentTime
        gAB.gain.setTargetAtTime(0, t, 0.02)
        gF.gain.setTargetAtTime(0, t, 0.02)
        src.stop(t + 0.15)
        mod.stop(t + 0.15)
      },
    }
  }

  /** Wooden "tok" (ported from knock's preset): three sine modes, a strike click, a body thump. */
  woodKnock(v = 0.8, f0 = 520, delay = 0): void {
    if (!this.ok) return
    const ctx = this.ctx!
    const t0 = ctx.currentTime + delay
    const vel = Math.max(0.15, Math.min(1, v))
    const f = f0 * (1 + (Math.random() * 2 - 1) * 0.015)
    const out = ctx.createGain()
    out.gain.value = 0.55 + 0.45 * vel
    out.connect(this.master!)
    const modes: [number, number, number][] = [
      [1, 0.09, 0.5],
      [2.35, 0.05, 0.2 * (0.6 + 0.4 * vel)],
      [3.9, 0.03, 0.08 * (0.4 + 0.6 * vel)],
    ]
    for (const [m, tau, gain] of modes) {
      const osc = ctx.createOscillator()
      osc.frequency.setValueAtTime(f * m * 1.012, t0)
      osc.frequency.exponentialRampToValueAtTime(f * m, t0 + 0.025)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(gain, t0 + 0.0015)
      g.gain.setTargetAtTime(0, t0 + 0.0015, tau)
      osc.connect(g).connect(out)
      osc.start(t0)
      osc.stop(t0 + tau * 9 + 0.01)
    }
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1800 * (0.85 + 0.3 * vel)
    bp.Q.value = 1.1
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0, t0)
    ng.gain.linearRampToValueAtTime(0.25 * (0.5 + 0.5 * vel), t0 + 0.0008)
    ng.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.006)
    src.connect(bp).connect(ng).connect(out)
    src.start(t0, Math.random() * 1.5)
    src.stop(t0 + 0.01)
  }

  /** Small bell: one partial-rich sine note. */
  bell(f: number, gain = 0.1, delay = 0): void {
    this.tone({ freq: f, dur: 1.2, gain, delay })
    this.tone({ freq: f * 2.76, dur: 0.4, gain: gain * 0.22, delay })
  }

  /** Win: three bells 784, 988, 1175 Hz, 90 ms apart. No fanfare. */
  win(): void {
    ;[784, 988, 1175].forEach((f, i) => this.bell(f, 0.1, i * 0.09))
  }

  /** Thanks: a 120 ms lowpassed noise puff. */
  puff(): void {
    this.noise({ dur: 0.12, gain: 0.08, filter: 'lowpass', freq: 900, attack: 0.02 })
  }

  /** Red marker squeak: sine 1.8 to 2.4 kHz in 180 ms with a 30 Hz vibrato. */
  squeak(delay = 0): void {
    if (!this.ok) return
    const ctx = this.ctx!
    const t0 = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    osc.frequency.setValueAtTime(1800, t0)
    osc.frequency.linearRampToValueAtTime(2400, t0 + 0.18)
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 30
    const lg = ctx.createGain()
    lg.gain.value = 60
    lfo.connect(lg).connect(osc.frequency)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.03, t0 + 0.02)
    g.gain.setValueAtTime(0.03, t0 + 0.15)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18)
    osc.connect(g).connect(this.master!)
    osc.start(t0)
    lfo.start(t0)
    osc.stop(t0 + 0.2)
    lfo.stop(t0 + 0.2)
  }

  /** Card in or out: a short paper fwip. */
  fwip(gain = 0.12): void {
    this.noise({ dur: 0.16, gain, filter: 'bandpass', freq: 600, freqEnd: 4000, q: 1.6, attack: 0.04 })
  }

  /** Card lands: 30 ms of noise through a 900 Hz lowpass. */
  slap(): void {
    this.noise({ dur: 0.03, gain: 0.14, filter: 'lowpass', freq: 900, attack: 0.001 })
  }
}

export const audio = new AudioEngine()
