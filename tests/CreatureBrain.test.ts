import { describe, expect, it } from 'vitest';
import { CreatureBrain } from '../src/creature/CreatureBrain';

describe('CreatureBrain (BDI + Operant Conditioning)', () => {
  it('reinforces recent action on pet and suppresses on slap', () => {
    const brain = new CreatureBrain();
    const initialWeight = brain.weights.get('bring_wood')!;

    brain.recordAction('bring_wood', 10);
    const praised = brain.applyConditioning('pet', 14);
    expect(praised.action).toBe('bring_wood');
    expect(praised.newWeight).toBeGreaterThan(initialWeight);
    expect(brain.alignment).toBeGreaterThan(0);

    const scolded = brain.applyConditioning('slap', 16);
    expect(scolded.newWeight).toBeLessThan(praised.newWeight);
  });

  it('shifts evil when praised for throwing rocks at rival village', () => {
    const brain = new CreatureBrain();
    brain.recordAction('throw_rock_rival', 20);
    brain.applyConditioning('pet', 23);
    expect(brain.alignment).toBeLessThan(0);
  });

  it('boosts imitation likelihood when observing player actions', () => {
    const brain = new CreatureBrain();
    brain.observePlayerAction('entertain_rival');
    brain.observePlayerAction('entertain_rival');
    const chosen = brain.chooseNextAction(5, () => 0.5);
    expect(chosen).toBe('entertain_rival');
  });

  it('prioritizes eating when hunger is very high', () => {
    const brain = new CreatureBrain();
    brain.hunger = 0.95;
    const chosen = brain.chooseNextAction(5, () => 0.5);
    expect(chosen).toBe('eat_food');
  });
});
