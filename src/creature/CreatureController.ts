import * as THREE from 'three';
import { AlignmentSystem } from '../core/AlignmentSystem';
import { EventBus } from '../core/EventBus';
import { GameState } from '../core/GameState';
import { BuildingSystem } from '../villages/BuildingSystem';
import { Village } from '../villages/Village';
import { IslandTerrain, PLAYER_VILLAGE_POS } from '../world/IslandTerrain';
import { CreatureActionType, CreatureBrain } from './CreatureBrain';
import { CreatureVisuals } from './CreatureVisuals';

export class CreatureController {
  public readonly brain = new CreatureBrain();
  public readonly visuals: CreatureVisuals;
  public readonly position: THREE.Vector3;
  public leashTarget: THREE.Vector3 | null = null;

  private currentTarget = new THREE.Vector3();
  private currentAction: CreatureActionType = 'wander';
  private decisionTimer = 3.0;
  private conditioningCooldown = 0;

  constructor(
    scene: THREE.Scene,
    private readonly terrain: IslandTerrain,
    private readonly buildings: BuildingSystem,
    private readonly alignment: AlignmentSystem,
    private readonly gameState: GameState,
    private readonly bus: EventBus
  ) {
    this.visuals = new CreatureVisuals(scene);
    this.position = new THREE.Vector3(PLAYER_VILLAGE_POS.x + 8, 0, PLAYER_VILLAGE_POS.z + 9);
    this.position.y = terrain.getHeightAt(this.position.x, this.position.z);
    this.currentTarget.copy(this.position);
    this.visuals.root.position.copy(this.position);
  }

  get interactionCenter(): THREE.Vector3 {
    return new THREE.Vector3(this.position.x, this.position.y + 3.2, this.position.z);
  }

  /** Detect direct VR hand petting (gentle palm) or slapping (fast palm) */
  checkHandConditioning(handWorldPos: THREE.Vector3, handSpeed: number, nowSec: number): boolean {
    if (this.conditioningCooldown > 0) return false;
    const dist = handWorldPos.distanceTo(this.interactionCenter);
    if (dist > 3.2) return false;

    if (handSpeed > 2.2) {
      this.condition('slap', nowSec);
      return true;
    } else if (handSpeed > 0.25 && handSpeed <= 1.6) {
      this.condition('pet', nowSec);
      return true;
    }
    return false;
  }

  condition(type: 'pet' | 'slap', nowSec: number): void {
    if (this.conditioningCooldown > 0) return;
    this.conditioningCooldown = 1.4;
    const result = this.brain.applyConditioning(type, nowSec);
    this.visuals.triggerFeedback(type);
    this.bus.emit('creature:conditioned', {
      type,
      action: result.action ?? 'general',
      newWeight: result.newWeight,
    });
    this.bus.emit('toast:show', {
      message:
        type === 'pet'
          ? `Creature praised! (${this.brain.lastConditioningText})`
          : `Creature scolded! (${this.brain.lastConditioningText})`,
      durationMs: 2200,
    });
  }

  update(
    dt: number,
    elapsed: number,
    playerVillage: Village,
    rivalVillage: Village,
    lookAtPos?: THREE.Vector3
  ): void {
    this.brain.tickNeeds(dt);
    if (this.conditioningCooldown > 0) this.conditioningCooldown -= dt;

    this.decisionTimer -= dt;
    if (this.decisionTimer <= 0) {
      this.decisionTimer = 6.5;
      this.currentAction = this.brain.chooseNextAction(elapsed);
      this.pickTargetForAction(this.currentAction, playerVillage, rivalVillage);
    }

    // Move toward target
    const dx = this.currentTarget.x - this.position.x;
    const dz = this.currentTarget.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    let speed = 0;

    if (dist > 2.2) {
      speed = 4.6;
      const step = Math.min(dist, speed * dt);
      this.position.x += (dx / dist) * step;
      this.position.z += (dz / dist) * step;
      const yaw = Math.atan2(dx, dz);
      this.visuals.root.rotation.y = THREE.MathUtils.lerp(this.visuals.root.rotation.y, yaw, Math.min(1, dt * 4));
    } else if (this.decisionTimer > 4.5) {
      // Execute arrived action once
      this.executeArrivedAction(playerVillage, rivalVillage);
      this.decisionTimer = 3.5;
    }

    this.position.y = this.terrain.getHeightAt(this.position.x, this.position.z);
    this.visuals.root.position.copy(this.position);

    // Subtle head tracking toward player's hand so Creature feels alive & observant
    if (lookAtPos && lookAtPos.distanceTo(this.position) < 28) {
      const toHand = lookAtPos.clone().sub(this.interactionCenter);
      const targetYaw = Math.atan2(toHand.x, toHand.z) - this.visuals.root.rotation.y;
      this.visuals.headGroup.rotation.y = THREE.MathUtils.clamp(targetYaw, -0.7, 0.7);
    }

    this.visuals.update(dt, elapsed, speed, this.brain.alignment);
  }

  private pickTargetForAction(action: CreatureActionType, playerVillage: Village, rivalVillage: Village): void {
    if (this.leashTarget) {
      this.currentTarget.copy(this.leashTarget);
      return;
    }
    if (action === 'bring_wood') {
      const scaffold = playerVillage.myBuildings.find((b) => b.progress < 1 && !b.destroyed);
      this.currentTarget.copy(scaffold ? scaffold.position : playerVillage.center);
    } else if (action === 'feed_village' || action === 'eat_food') {
      this.currentTarget.copy(playerVillage.center);
    } else if (action === 'entertain_rival' || action === 'throw_rock_rival') {
      this.currentTarget.copy(rivalVillage.center);
    } else {
      const angle = Math.random() * Math.PI * 2;
      this.currentTarget.set(
        playerVillage.center.x + Math.cos(angle) * 16,
        0,
        playerVillage.center.z + Math.sin(angle) * 16
      );
    }
  }

  private executeArrivedAction(playerVillage: Village, rivalVillage: Village): void {
    if (this.currentAction === 'bring_wood') {
      const scaffold = playerVillage.myBuildings.find((b) => b.progress < 1 && !b.destroyed);
      if (scaffold) {
        this.buildings.deliverWood(scaffold, 0.6);
        this.alignment.shift(0.03, 'Creature Helped Build');
      }
    } else if (this.currentAction === 'feed_village') {
      this.gameState.addBelief(8);
      playerVillage.villagers.triggerCheer(this.position, 15);
    } else if (this.currentAction === 'entertain_rival') {
      rivalVillage.villagers.triggerCheer(this.position, 18);
      this.gameState.advanceRivalConversion(9, 'peaceful');
      this.alignment.shift(0.04, 'Creature Entertained Rival');
    } else if (this.currentAction === 'throw_rock_rival') {
      this.buildings.damageInRadius(rivalVillage.center, 12, 22, false);
      rivalVillage.villagers.triggerPanic(this.position, 18);
      this.gameState.advanceRivalConversion(10, 'conquest');
      this.alignment.shift(-0.05, 'Creature Attacked Rival');
    }

    this.bus.emit('creature:action', {
      action: this.currentAction,
      targetType: 'village',
      position: this.position.clone(),
    });
  }

  dispose(scene: THREE.Scene): void {
    this.visuals.dispose(scene);
  }
}
