import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import { GameState } from '../src/core/GameState';

describe('GameState (Belief, Influence Ring, Conversion)', () => {
  it('expands influence ring radius as belief and impressiveness grow', () => {
    const bus = new EventBus();
    const state = new GameState(bus);
    const initialRadius = state.influenceRadius;

    state.addBelief(150);
    state.addImpressiveness(60);
    expect(state.influenceRadius).toBeGreaterThan(initialRadius);
  });

  it('spends prayer power only when sufficient mana is available', () => {
    const bus = new EventBus();
    const state = new GameState(bus);
    state.prayerPower = 20;

    expect(state.spendPrayerPower(25)).toBe(false);
    expect(state.prayerPower).toBe(20);
    expect(state.spendPrayerPower(15)).toBe(true);
    expect(state.prayerPower).toBe(5);
  });

  it('emits village:converted when rival conversion reaches 100%', () => {
    const bus = new EventBus();
    const state = new GameState(bus);
    let convertedMethod: string | null = null;
    bus.on('village:converted', ({ method }) => {
      convertedMethod = method;
    });

    state.advanceRivalConversion(60, 'peaceful');
    expect(state.rivalConverted).toBe(false);

    state.advanceRivalConversion(50, 'peaceful');
    expect(state.rivalConverted).toBe(true);
    expect(convertedMethod).toBe('peaceful');
  });

  it('tracks granary food and wood replenishment within bounds', () => {
    const bus = new EventBus();
    const state = new GameState(bus);
    const startFood = state.villageFood;
    const startWood = state.villageWood;

    state.addFood(35);
    state.addWood(45);
    expect(state.villageFood).toBe(startFood + 35);
    expect(state.villageWood).toBe(startWood + 45);

    state.addWood(500);
    expect(state.villageWood).toBe(state.maxResource);
  });
});
