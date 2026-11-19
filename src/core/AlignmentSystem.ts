import * as THREE from 'three';
import { EventBus } from './EventBus';

export interface AlignmentPalette {
  handPrimary: THREE.Color;
  handEmissive: THREE.Color;
  ringColor: THREE.Color;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  sunColor: THREE.Color;
  fogColor: THREE.Color;
  templeColor: THREE.Color;
}

const GOOD_PALETTE: AlignmentPalette = {
  handPrimary: new THREE.Color(0xfff6e5),
  handEmissive: new THREE.Color(0xffd27a),
  ringColor: new THREE.Color(0x7be8ff),
  skyTop: new THREE.Color(0x2d7bd6),
  skyHorizon: new THREE.Color(0xbce7ff),
  sunColor: new THREE.Color(0xfff1cc),
  fogColor: new THREE.Color(0xaedcf5),
  templeColor: new THREE.Color(0xf4efe4),
};

const NEUTRAL_PALETTE: AlignmentPalette = {
  handPrimary: new THREE.Color(0xdcc7a1),
  handEmissive: new THREE.Color(0x887250),
  ringColor: new THREE.Color(0xffd670),
  skyTop: new THREE.Color(0x3a6ea5),
  skyHorizon: new THREE.Color(0xd6d2c4),
  sunColor: new THREE.Color(0xffe6b3),
  fogColor: new THREE.Color(0xb8c7d4),
  templeColor: new THREE.Color(0xc9bfa8),
};

const EVIL_PALETTE: AlignmentPalette = {
  handPrimary: new THREE.Color(0x281c20),
  handEmissive: new THREE.Color(0xff3b1f),
  ringColor: new THREE.Color(0xff3a22),
  skyTop: new THREE.Color(0x1b0b12),
  skyHorizon: new THREE.Color(0x6b2019),
  sunColor: new THREE.Color(0xff6b3d),
  fogColor: new THREE.Color(0x451a19),
  templeColor: new THREE.Color(0x2c2326),
};

export class AlignmentSystem {
  private value = 0; // -1 (Pure Evil) to +1 (Pure Good)

  constructor(private readonly bus: EventBus) {}

  get alignment(): number {
    return this.value;
  }

  /** Normalized 0..1 where 0 = pure evil, 0.5 = neutral, 1 = pure good */
  get normalized(): number {
    return (this.value + 1) * 0.5;
  }

  get label(): string {
    if (this.value >= 0.65) return 'Radiant Seraph';
    if (this.value >= 0.2) return 'Benevolent Deity';
    if (this.value > -0.2) return 'Neutral Deity';
    if (this.value > -0.65) return 'Dread Overlord';
    return 'Abyssal Tyrant';
  }

  shift(delta: number, reason: string): void {
    const prev = this.value;
    this.value = Math.max(-1, Math.min(1, this.value + delta));
    if (Math.abs(this.value - prev) > 1e-5) {
      this.bus.emit('alignment:changed', { alignment: this.value, delta, reason });
    }
  }

  reset(): void {
    this.value = 0;
    this.bus.emit('alignment:changed', { alignment: 0, delta: 0, reason: 'reset' });
  }

  samplePalette(out?: AlignmentPalette): AlignmentPalette {
    const target: AlignmentPalette = out ?? {
      handPrimary: new THREE.Color(),
      handEmissive: new THREE.Color(),
      ringColor: new THREE.Color(),
      skyTop: new THREE.Color(),
      skyHorizon: new THREE.Color(),
      sunColor: new THREE.Color(),
      fogColor: new THREE.Color(),
      templeColor: new THREE.Color(),
    };

    const keys = Object.keys(NEUTRAL_PALETTE) as (keyof AlignmentPalette)[];
    if (this.value >= 0) {
      const t = this.value;
      for (const k of keys) {
        target[k].copy(NEUTRAL_PALETTE[k]).lerp(GOOD_PALETTE[k], t);
      }
    } else {
      const t = -this.value;
      for (const k of keys) {
        target[k].copy(NEUTRAL_PALETTE[k]).lerp(EVIL_PALETTE[k], t);
      }
    }
    return target;
  }
}
