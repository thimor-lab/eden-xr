import * as THREE from 'three';

/**
 * Procedural 3D HRTF Spatial Audio Soundscape using WebAudio API.
 * Zero external audio file dependencies — synthesized ocean ambience,
 * villager chants, impacts, fireballs, lightning thunder, and creature vocalizations.
 */
export class SpatialAudio {
  private ctx: AudioContext | null = null;
  private enabled = false;
  private oceanGain: GainNode | null = null;
  private chantGain: GainNode | null = null;

  get isEnabled(): boolean {
    return this.enabled;
  }

  toggle(): boolean {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.setupAmbience();
    }
    this.enabled = !this.enabled;
    if (this.enabled && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    if (this.oceanGain) {
      this.oceanGain.gain.setTargetAtTime(this.enabled ? 0.05 : 0, this.ctx.currentTime, 0.2);
    }
    if (this.chantGain) {
      this.chantGain.gain.setTargetAtTime(this.enabled ? 0.03 : 0, this.ctx.currentTime, 0.2);
    }
    return this.enabled;
  }

  updateListener(camera: THREE.Camera): void {
    if (!this.ctx || !this.enabled) return;
    const pos = new THREE.Vector3();
    const fwd = new THREE.Vector3(0, 0, -1);
    const up = new THREE.Vector3(0, 1, 0);
    camera.getWorldPosition(pos);
    fwd.applyQuaternion(camera.quaternion);
    up.applyQuaternion(camera.quaternion);

    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      l.forwardX.value = fwd.x;
      l.forwardY.value = fwd.y;
      l.forwardZ.value = fwd.z;
      l.upX.value = up.x;
      l.upY.value = up.y;
      l.upZ.value = up.z;
    }
  }

  playSpatialTone(
    position: THREE.Vector3,
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType = 'sine',
    volume = 0.2
  ): void {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 12;
    panner.maxDistance = 180;
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;

    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);

    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(panner);
    panner.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  playImpact(position: THREE.Vector3, heavy = false): void {
    this.playSpatialTone(position, heavy ? 110 : 160, 32, heavy ? 0.45 : 0.25, 'triangle', heavy ? 0.35 : 0.22);
  }

  playGrab(position: THREE.Vector3): void {
    this.playSpatialTone(position, 280, 420, 0.12, 'sine', 0.16);
  }

  playUproot(position: THREE.Vector3): void {
    this.playSpatialTone(position, 145, 310, 0.26, 'triangle', 0.28);
  }

  playMiracle(type: string, position: THREE.Vector3): void {
    if (type === 'lightning') {
      this.playSpatialTone(position, 420, 40, 0.75, 'sawtooth', 0.35);
    } else if (type === 'fireball') {
      this.playSpatialTone(position, 220, 65, 0.55, 'sawtooth', 0.28);
    } else {
      this.playSpatialTone(position, 392, 587, 0.45, 'sine', 0.22);
    }
  }

  playCreature(type: 'pet' | 'slap'): void {
    if (!this.ctx || !this.enabled) return;
    const pos = new THREE.Vector3(0, 0, 0);
    if (type === 'pet') {
      this.playSpatialTone(pos, 260, 440, 0.35, 'sine', 0.2);
    } else {
      this.playSpatialTone(pos, 240, 95, 0.28, 'sawtooth', 0.25);
    }
  }

  private setupAmbience(): void {
    if (!this.ctx) return;
    // Soft filtered noise for ocean waves
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;

    this.oceanGain = this.ctx.createGain();
    this.oceanGain.gain.value = 0;

    noise.connect(filter);
    filter.connect(this.oceanGain);
    this.oceanGain.connect(this.ctx.destination);
    noise.start();

    // Gentle mythic choir drone for village worship
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 146.83; // D3
    this.chantGain = this.ctx.createGain();
    this.chantGain.gain.value = 0;
    osc.connect(this.chantGain);
    this.chantGain.connect(this.ctx.destination);
    osc.start();
  }
}
