import { describe, expect, it } from 'vitest';
import { AlignmentSystem } from '../src/core/AlignmentSystem';
import { EventBus } from '../src/core/EventBus';

describe('AlignmentSystem', () => {
  it('clamps alignment between -1 and +1 and updates deity title', () => {
    const bus = new EventBus();
    const sys = new AlignmentSystem(bus);
    expect(sys.label).toBe('Neutral Deity');

    sys.shift(0.8, 'Miracles of kindness');
    expect(sys.alignment).toBeCloseTo(0.8);
    expect(sys.label).toBe('Radiant Seraph');

    sys.shift(0.9, 'Overflow test');
    expect(sys.alignment).toBe(1);

    sys.shift(-2.5, 'Dark conquest');
    expect(sys.alignment).toBe(-1);
    expect(sys.label).toBe('Abyssal Tyrant');
  });

  it('samples distinct palettes for good vs evil', () => {
    const bus = new EventBus();
    const sys = new AlignmentSystem(bus);
    sys.shift(1, 'Good');
    const goodPalette = sys.samplePalette();

    sys.shift(-2, 'Evil');
    const evilPalette = sys.samplePalette();

    expect(goodPalette.skyTop.b).toBeGreaterThan(evilPalette.skyTop.b);
    expect(evilPalette.ringColor.r).toBeGreaterThan(evilPalette.ringColor.b);
  });
});
