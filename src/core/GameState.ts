import { EventBus } from './EventBus';

export class GameState {
  public prayerPower = 65;
  public readonly maxPrayerPower = 100;
  public playerBelief = 120;
  public playerImpressiveness = 40;
  public villageFood = 45;
  public villageWood = 40;
  public readonly maxResource = 200;
  public rivalConversion = 0; // 0..100%
  public rivalConverted = false;
  public victoryMethod: 'peaceful' | 'conquest' | null = null;

  constructor(private readonly bus: EventBus) {}

  /** Influence ring radius in world meters, scales with Belief + Impressiveness */
  get influenceRadius(): number {
    const raw = 26 + Math.sqrt(Math.max(0, this.playerBelief + this.playerImpressiveness * 1.5)) * 1.85;
    return Math.min(95, raw);
  }

  addPrayerPower(amount: number): void {
    this.prayerPower = Math.max(0, Math.min(this.maxPrayerPower, this.prayerPower + amount));
  }

  spendPrayerPower(cost: number): boolean {
    if (this.prayerPower < cost) return false;
    this.prayerPower -= cost;
    return true;
  }

  addBelief(amount: number): void {
    this.playerBelief = Math.max(10, this.playerBelief + amount);
  }

  addImpressiveness(amount: number): void {
    this.playerImpressiveness = Math.max(0, this.playerImpressiveness + amount);
  }

  addFood(amount: number): void {
    this.villageFood = Math.max(0, Math.min(this.maxResource, this.villageFood + amount));
  }

  addWood(amount: number): void {
    this.villageWood = Math.max(0, Math.min(this.maxResource, this.villageWood + amount));
  }

  consumeWood(amount: number): boolean {
    if (this.villageWood < amount) return false;
    this.villageWood -= amount;
    return true;
  }

  advanceRivalConversion(delta: number, method: 'peaceful' | 'conquest'): void {
    if (this.rivalConverted) return;
    this.rivalConversion = Math.max(0, Math.min(100, this.rivalConversion + delta));
    if (this.rivalConversion >= 100) {
      this.rivalConverted = true;
      this.victoryMethod = method;
      this.addBelief(250);
      this.bus.emit('village:converted', { villageId: 'rival', method });
      this.bus.emit('toast:show', {
        message:
          method === 'peaceful'
            ? 'The Rival Village bows in awe! Your peaceful radiance unites Eden.'
            : 'The Rival Village submits in terror! Your dark dominion rules Eden.',
        durationMs: 6000,
      });
    }
  }

  reset(): void {
    this.prayerPower = 65;
    this.playerBelief = 120;
    this.playerImpressiveness = 40;
    this.villageFood = 45;
    this.villageWood = 40;
    this.rivalConversion = 0;
    this.rivalConverted = false;
    this.victoryMethod = null;
  }
}
