class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled: boolean = true;

  constructor() {
    // Check if localStorage has sound settings
    const saved = localStorage.getItem('qora_xotin_sound');
    if (saved !== null) {
      this.enabled = saved === 'true';
    }
  }

  private initContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  public toggleSound(enabled: boolean) {
    this.enabled = enabled;
    localStorage.setItem('qora_xotin_sound', enabled ? 'true' : 'false');
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  // Helper to create a gain node with a specific exponential decay
  private playDecayOscillator(
    type: OscillatorType,
    startFreq: number,
    endFreq: number,
    duration: number,
    maxGain: number = 0.1
  ) {
    if (!this.enabled) return;
    const ctx = this.initContext();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, now);
    if (startFreq !== endFreq) {
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
    }

    gainNode.gain.setValueAtTime(maxGain, now);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration);
  }

  // 1. Card Shuffle (Synthesized rustle noise)
  public playShuffle() {
    if (!this.enabled) return;
    const ctx = this.initContext();
    const now = ctx.currentTime;
    const duration = 0.8;

    // Create buffer for white noise
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseNode = ctx.createBufferSource();
    noiseNode.buffer = buffer;

    // Create lowpass filter to make it sound softer
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, now);
    filter.frequency.exponentialRampToValueAtTime(200, now + duration);

    // Envelope
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0.08, now);
    // Add micro-oscillations to simulate individual cards flapping
    for (let t = 0; t < duration; t += 0.08) {
      gainNode.gain.setValueAtTime(0.08, now + t);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + t + 0.06);
    }
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    noiseNode.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(ctx.destination);

    noiseNode.start(now);
    noiseNode.stop(now + duration);
  }

  // 2. Card Draw (Whoosh sound using low pitch-bend)
  public playDraw() {
    this.playDecayOscillator('triangle', 350, 150, 0.25, 0.15);
  }

  // 3. Pair Found (Happy chime chord)
  public playPairFound() {
    if (!this.enabled) return;
    const ctx = this.initContext();
    const now = ctx.currentTime;
    const duration = 0.5;

    // Notes: C5 (523.25 Hz) & G5 (783.99 Hz) followed by E5 (659.25 Hz)
    const playNote = (freq: number, startOffset: number, vol: number) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gainNode.gain.setValueAtTime(vol, now + startOffset);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration);
    };

    playNote(523.25, 0, 0.08); // C5
    playNote(783.99, 0.05, 0.08); // G5
    playNote(659.25, 0.12, 0.08); // E5 (creates major triad feeling)
  }

  // 4. Turn Chime (Soft ping)
  public playTurnChime() {
    this.playDecayOscillator('sine', 880, 880, 0.15, 0.06); // A5 note
  }

  // 5. Victory Fanfare (Happy major scale sequence)
  public playVictory() {
    if (!this.enabled) return;
    const ctx = this.initContext();
    const now = ctx.currentTime;

    const playNote = (freq: number, startTime: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + startTime);
      gainNode.gain.setValueAtTime(0.08, now + startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + startTime + duration);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(now + startTime);
      osc.stop(now + startTime + duration);
    };

    // Ascending arpeggio C4 - E4 - G4 - C5 - E5 - G5
    const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99];
    notes.forEach((freq, idx) => {
      playNote(freq, idx * 0.1, 0.4);
    });

    // Chord at the end
    setTimeout(() => {
      if (!this.enabled) return;
      playNote(523.25, 0, 1.2);
      playNote(659.25, 0, 1.2);
      playNote(783.99, 0, 1.2);
      playNote(1046.50, 0, 1.2); // C6
    }, 600);
  }

  // 6. Defeat / Qora Xotin (Sad minor slide)
  public playDefeat() {
    if (!this.enabled) return;
    const ctx = this.initContext();
    const now = ctx.currentTime;

    const playSadSlide = (startFreq: number, endFreq: number, startTime: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.type = 'sawtooth'; // buzzing sound
      
      // Lowpass filter to make sawtooth less harsh
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, now + startTime);

      osc.frequency.setValueAtTime(startFreq, now + startTime);
      osc.frequency.linearRampToValueAtTime(endFreq, now + startTime + duration);

      gainNode.gain.setValueAtTime(0.06, now + startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + startTime + duration);

      osc.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(now + startTime);
      osc.stop(now + startTime + duration);
    };

    // Descending slides
    playSadSlide(220, 110, 0, 0.6); // A3 to A2
    playSadSlide(207.65, 103.83, 0.4, 0.8); // G#3 to G#2 (dissonant semitone drop)
  }
}

export const soundManager = new SoundManager();
