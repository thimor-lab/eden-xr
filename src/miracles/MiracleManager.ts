import * as THREE from 'three';
import { EventBus, MiracleType } from '../core/EventBus';
import { GameState } from '../core/GameState';
import { Village } from '../villages/Village';
import { InfluenceRing } from '../world/InfluenceRing';
import { MiracleEffects } from './MiracleEffects';

export const MIRACLE_COSTS: Record<MiracleType, number> = {
  food: 12,
  wood: 12,
  rain: 15,
  fireball: 18,
  lightning: 24,
};

export class MiracleManager {
  constructor(
    private readonly gameState: GameState,
    private readonly influenceRing: InfluenceRing,
    private readonly effects: MiracleEffects,
    private readonly bus: EventBus
  ) {}

  tryCast(
    type: MiracleType,
    targetPos: THREE.Vector3,
    launchVelocity: THREE.Vector3 | null,
    playerVillage: Village,
    rivalVillage: Village,
    bypassInfluenceCheck = false
  ): boolean {
    const cost = MIRACLE_COSTS[type];
    if (!bypassInfluenceCheck && !this.influenceRing.isInside(targetPos) && type !== 'fireball') {
      this.bus.emit('toast:show', {
        message: 'Outside your Influence Ring! Grow Belief or send your Creature.',
        durationMs: 2200,
      });
      return false;
    }

    if (!this.gameState.spendPrayerPower(cost)) {
      this.bus.emit('toast:show', {
        message: `Not enough Prayer Power (need ${cost}). Raise your Village Totem!`,
        durationMs: 2200,
      });
      return false;
    }

    this.effects.execute(type, targetPos, launchVelocity, playerVillage, rivalVillage);
    this.bus.emit('toast:show', {
      message: `Cast ${type.toUpperCase()} Miracle!`,
      durationMs: 1600,
    });
    return true;
  }
}
