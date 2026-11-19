export type CreatureActionType =
  | 'bring_wood'
  | 'feed_village'
  | 'entertain_rival'
  | 'throw_rock_rival'
  | 'eat_food'
  | 'wander';

export interface CreatureMemoryEntry {
  action: CreatureActionType;
  timestamp: number;
}

/**
 * Belief-Desire-Intention (BDI) + Operant Conditioning Reinforcement Learning Brain
 * inspired by Richard Evans' Creature AI in Black & White.
 */
export class CreatureBrain {
  public readonly weights = new Map<CreatureActionType, number>([
    ['bring_wood', 0.2],
    ['feed_village', 0.15],
    ['entertain_rival', 0.1],
    ['throw_rock_rival', 0.05],
    ['eat_food', 0.25],
    ['wander', 0.0],
  ]);

  public readonly imitationBonus = new Map<CreatureActionType, number>();

  public hunger = 0.2; // 0..1
  public energy = 0.9; // 0..1
  public alignment = 0.0; // -1 (Evil) .. +1 (Good)
  public lastAction: CreatureMemoryEntry | null = null;
  public lastConditioningText = 'Curious · Neutral';

  private readonly memoryWindowSec = 15;

  get moodLabel(): string {
    const alignWord =
      this.alignment >= 0.35 ? 'Angelic' : this.alignment <= -0.35 ? 'Fierce' : 'Neutral';
    const needWord = this.hunger > 0.7 ? 'Hungry' : this.lastAction ? this.lastAction.action.replace(/_/g, ' ') : 'Curious';
    return `${needWord} · ${alignWord}`;
  }

  /** Called when the player performs an action nearby so the Creature can imitate it */
  observePlayerAction(action: CreatureActionType): void {
    const current = this.imitationBonus.get(action) ?? 0;
    this.imitationBonus.set(action, Math.min(0.6, current + 0.35));
  }

  /** Selects the next action based on desires + learned weights + imitation curiosity */
  chooseNextAction(nowSec: number, rng: () => number = Math.random): CreatureActionType {
    const candidates: CreatureActionType[] = [
      'bring_wood',
      'feed_village',
      'entertain_rival',
      'throw_rock_rival',
      'eat_food',
      'wander',
    ];

    let bestAction: CreatureActionType = 'wander';
    let bestScore = -Infinity;

    for (const action of candidates) {
      const baseWeight = this.weights.get(action) ?? 0;
      const imitate = this.imitationBonus.get(action) ?? 0;
      const hungerDrive = action === 'eat_food' ? this.hunger * 0.9 : 0;
      const exploration = (rng() - 0.5) * 0.28;
      const score = baseWeight + imitate + hungerDrive + exploration;

      if (score > bestScore) {
        bestScore = score;
        bestAction = action;
      }
    }

    // Decay imitation bonus once acted upon
    if (this.imitationBonus.has(bestAction)) {
      this.imitationBonus.set(bestAction, Math.max(0, (this.imitationBonus.get(bestAction) ?? 0) - 0.2));
    }

    this.recordAction(bestAction, nowSec);
    return bestAction;
  }

  recordAction(action: CreatureActionType, nowSec: number): void {
    this.lastAction = { action, timestamp: nowSec };
    if (action === 'eat_food') {
      this.hunger = Math.max(0, this.hunger - 0.45);
    }
  }

  /**
   * Operant Conditioning:
   * - Petting (praise) reinforces the most recent action (+0.28 weight) and nudges alignment.
   * - Slapping (punish) suppresses the most recent action (-0.35 weight) and nudges alignment.
   */
  applyConditioning(
    type: 'pet' | 'slap',
    nowSec: number
  ): { action: CreatureActionType | null; newWeight: number } {
    const reward = type === 'pet' ? 0.28 : -0.35;

    if (!this.lastAction || nowSec - this.lastAction.timestamp > this.memoryWindowSec) {
      // General affection/fear shift even if no recent action
      this.alignment = Math.max(-1, Math.min(1, this.alignment + (type === 'pet' ? 0.05 : -0.08)));
      return { action: null, newWeight: 0 };
    }

    const action = this.lastAction.action;
    const prev = this.weights.get(action) ?? 0;
    const next = Math.max(-1, Math.min(1, prev + reward));
    this.weights.set(action, next);

    // Update creature moral alignment based on what was reinforced
    const isGoodAction = action === 'bring_wood' || action === 'feed_village' || action === 'entertain_rival';
    const isEvilAction = action === 'throw_rock_rival';

    if (isGoodAction) {
      this.alignment = Math.max(-1, Math.min(1, this.alignment + (type === 'pet' ? 0.14 : -0.1)));
    } else if (isEvilAction) {
      this.alignment = Math.max(-1, Math.min(1, this.alignment + (type === 'pet' ? -0.16 : 0.12)));
    }

    this.lastConditioningText = `${type === 'pet' ? 'Praised' : 'Scolded'} for ${action.replace(/_/g, ' ')}`;
    return { action, newWeight: next };
  }

  tickNeeds(dt: number): void {
    this.hunger = Math.min(1, this.hunger + dt * 0.012);
    for (const [k, v] of this.imitationBonus.entries()) {
      const decayed = Math.max(0, v - dt * 0.02);
      if (decayed <= 0.001) this.imitationBonus.delete(k);
      else this.imitationBonus.set(k, decayed);
    }
  }
}
