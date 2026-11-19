import * as THREE from 'three';
import { AlignmentSystem } from '../core/AlignmentSystem';
import { EventBus } from '../core/EventBus';
import { GameState } from '../core/GameState';
import { Building, BuildingSystem } from '../villages/BuildingSystem';
import { Village } from '../villages/Village';
import { IslandTerrain, PLAYER_VILLAGE_POS } from '../world/IslandTerrain';
import { CreatureActionType, CreatureBrain } from './CreatureBrain';
import { CreatureVisuals } from './CreatureVisuals';

export type LeashGoal = 'move' | 'build' | 'granary' | 'rival' | null;

export class CreatureController {
  public readonly brain = new CreatureBrain();
  public readonly visuals: CreatureVisuals;
  public readonly position: THREE.Vector3;

  public leashTarget: THREE.Vector3 | null = null;
  public leashGoal: LeashGoal = null;
  public leashBuilding: Building | null = null;
  public leashHeldByHand: 'left' | 'right' | null = null;

  private readonly leashLine: THREE.Line;
  private readonly leashBeacon: THREE.Mesh;
  private readonly leashHandAnchor = new THREE.Vector3();

  private currentTarget = new THREE.Vector3();
  private currentAction: CreatureActionType = 'wander';
  private decisionTimer = 10.0;
  private conditioningCooldown = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: IslandTerrain,
    private readonly buildings: BuildingSystem,
    private readonly alignment: AlignmentSystem,
    private readonly gameState: GameState,
    private readonly bus: EventBus
  ) {
    this.visuals = new CreatureVisuals(scene);
    // Spawn in the open southern courtyard clear of all village buildings
    this.position = new THREE.Vector3(PLAYER_VILLAGE_POS.x + 10.5, 0, PLAYER_VILLAGE_POS.z + 11.5);
    this.position.y = terrain.getHeightAt(this.position.x, this.position.z);
    this.currentTarget.copy(this.position);
    this.visuals.root.position.copy(this.position);

    // Visual glowing Leash rope (curved catenary from collar to hand or beacon)
    const lineMat = new THREE.LineBasicMaterial({ color: 0x7be8ff, transparent: true, opacity: 0.9 });
    this.leashLine = new THREE.Line(new THREE.BufferGeometry(), lineMat);
    this.leashLine.frustumCulled = false;
    this.leashLine.visible = false;

    // Ground stake/beacon where the Leash is tied
    this.leashBeacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.35, 3.2, 6),
      new THREE.MeshBasicMaterial({ color: 0x7be8ff, transparent: true, opacity: 0.85 })
    );
    this.leashBeacon.visible = false;

    this.scene.add(this.leashLine, this.leashBeacon);
  }

  get interactionCenter(): THREE.Vector3 {
    return new THREE.Vector3(this.position.x, this.position.y + 5.2, this.position.z);
  }

  get collarWorldPos(): THREE.Vector3 {
    return new THREE.Vector3(this.position.x, this.position.y + 5.6, this.position.z);
  }

  /** Pick up the Creature's leash in a VR hand */
  grabLeash(handSide: 'left' | 'right', handWorldPos: THREE.Vector3): void {
    this.leashHeldByHand = handSide;
    this.leashHandAnchor.copy(handWorldPos);
    this.leashBeacon.visible = false;
    this.leashLine.visible = true;
    this.bus.emit('toast:show', {
      message: 'Creature Leash grabbed! Release on ground, a scaffold, Granary, or Rival Village.',
      durationMs: 2200,
    });
  }

  updateHeldLeash(handWorldPos: THREE.Vector3): void {
    this.leashHandAnchor.copy(handWorldPos);
  }

  /** Tie the Creature's leash to a world point, auto-detecting context (scaffold, granary, rival, or ground) */
  tieLeashTo(worldPos: THREE.Vector3, playerVillage: Village, rivalVillage: Village): void {
    this.leashHeldByHand = null;
    const groundY = this.terrain.getHeightAt(worldPos.x, worldPos.z);
    const point = new THREE.Vector3(worldPos.x, groundY, worldPos.z);

    // Check if tied near a specific building
    let nearestBldg: Building | null = null;
    let bestDist = 9.0;
    for (const b of this.buildings.buildings) {
      if (b.destroyed) continue;
      const d = b.position.distanceTo(point);
      if (d < bestDist) {
        bestDist = d;
        nearestBldg = b;
      }
    }

    this.leashBuilding = nearestBldg;
    this.leashTarget = point.clone();

    if (nearestBldg && nearestBldg.villageId === 'player' && nearestBldg.progress < 1) {
      this.leashGoal = 'build';
      this.currentAction = 'bring_wood';
      this.bus.emit('toast:show', { message: 'Leashed Creature to help build!', durationMs: 2200 });
    } else if (nearestBldg && nearestBldg.villageId === 'player' && nearestBldg.kind === 'granary') {
      this.leashGoal = 'granary';
      this.currentAction = 'feed_village';
      this.bus.emit('toast:show', { message: 'Leashed Creature to replenish the Granary!', durationMs: 2200 });
    } else if (point.distanceTo(rivalVillage.center) < 24) {
      this.leashGoal = 'rival';
      this.currentAction = this.brain.alignment < -0.15 ? 'throw_rock_rival' : 'entertain_rival';
      this.bus.emit('toast:show', {
        message:
          this.currentAction === 'throw_rock_rival'
            ? 'Leashed Creature to attack the Rival Village!'
            : 'Leashed Creature to impress the Rival Village!',
        durationMs: 2200,
      });
    } else {
      this.leashGoal = 'move';
      this.currentAction = 'wander';
      this.bus.emit('toast:show', { message: 'Creature called to Leash point!', durationMs: 1800 });
    }

    this.currentTarget.copy(this.computeStandOffTarget(point));
    this.decisionTimer = 5.0;

    this.leashBeacon.position.set(point.x, groundY + 1.6, point.z);
    this.leashBeacon.visible = true;
    this.leashLine.visible = true;
    // Silence unused parameter lint
    void playerVillage;
  }

  unleash(): void {
    this.leashHeldByHand = null;
    this.leashTarget = null;
    this.leashGoal = null;
    this.leashBuilding = null;
    this.leashLine.visible = false;
    this.leashBeacon.visible = false;
    this.bus.emit('toast:show', { message: 'Creature unleashed to roam freely.', durationMs: 1600 });
  }

  /** Detect direct VR hand petting (gentle palm) or slapping (fast palm) */
  checkHandConditioning(handWorldPos: THREE.Vector3, handSpeed: number, nowSec: number): boolean {
    if (this.conditioningCooldown > 0) return false;
    const dist = handWorldPos.distanceTo(this.interactionCenter);
    if (dist > 5.2) return false;

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

    // If leashed, keep marching toward leash target & repeating the leashed task
    if (this.leashTarget) {
      this.currentTarget.copy(this.computeStandOffTarget(this.leashTarget));
      this.decisionTimer -= dt;
    } else {
      this.decisionTimer -= dt;
      if (this.decisionTimer <= 0) {
        this.decisionTimer = 7.0;
        this.currentAction = this.brain.chooseNextAction(elapsed);
        this.pickTargetForAction(this.currentAction, playerVillage, rivalVillage);
      }
    }

    // Desired movement vector toward target
    const dx = this.currentTarget.x - this.position.x;
    const dz = this.currentTarget.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    let speed = 0;

    if (dist > 2.4) {
      speed = this.leashTarget ? 6.8 : 4.8;
      let dirX = dx / dist;
      let dirZ = dz / dist;

      // Smooth building avoidance repulsion so Creature walks AROUND buildings instead of clipping in
      const avoid = this.computeBuildingAvoidance();
      dirX += avoid.x;
      dirZ += avoid.z;
      const len = Math.hypot(dirX, dirZ);
      if (len > 1e-4) {
        dirX /= len;
        dirZ /= len;
      }

      const step = Math.min(dist, speed * dt);
      this.position.x += dirX * step;
      this.position.z += dirZ * step;

      const yaw = Math.atan2(dirX, dirZ);
      this.visuals.root.rotation.y = THREE.MathUtils.lerp(this.visuals.root.rotation.y, yaw, Math.min(1, dt * 4.5));
    } else if (this.decisionTimer <= 0 || (!this.leashTarget && this.decisionTimer > 4.5)) {
      this.executeArrivedAction(playerVillage, rivalVillage);
      this.decisionTimer = this.leashTarget ? 4.5 : 3.5;
    }

    // Hard push-out safety net so Creature can never remain overlapping a building footprint
    this.resolveBuildingOverlap();

    this.position.y = this.terrain.getHeightAt(this.position.x, this.position.z);
    this.visuals.root.position.copy(this.position);

    // Subtle head tracking toward player's hand
    if (lookAtPos && lookAtPos.distanceTo(this.position) < 34) {
      const toHand = lookAtPos.clone().sub(this.interactionCenter);
      const targetYaw = Math.atan2(toHand.x, toHand.z) - this.visuals.root.rotation.y;
      this.visuals.headGroup.rotation.y = THREE.MathUtils.clamp(targetYaw, -0.7, 0.7);
    }

    // Update glowing Leash visuals
    this.updateLeashVisuals(elapsed);
    this.visuals.update(dt, elapsed, speed, this.brain.alignment);
  }

  /** Computes a stand-off point outside a building's footprint so Creature stands beside it */
  private computeStandOffTarget(rawTarget: THREE.Vector3): THREE.Vector3 {
    const out = rawTarget.clone();
    for (const b of this.buildings.buildings) {
      if (b.destroyed) continue;
      const clearance = this.getBuildingClearance(b);
      const dx = out.x - b.position.x;
      const dz = out.z - b.position.z;
      const d = Math.hypot(dx, dz);
      if (d < clearance) {
        const angle = d > 0.05 ? Math.atan2(dz, dx) : Math.atan2(this.position.z - b.position.z, this.position.x - b.position.x);
        out.x = b.position.x + Math.cos(angle) * (clearance + 1.0);
        out.z = b.position.z + Math.sin(angle) * (clearance + 1.0);
      }
    }
    return out;
  }

  private getBuildingClearance(b: Building): number {
    if (b.kind === 'temple') return 7.4;
    if (b.kind === 'granary') return 6.6;
    if (b.kind === 'wonder') return 5.8;
    return 4.6;
  }

  private computeBuildingAvoidance(): { x: number; z: number } {
    let ax = 0;
    let az = 0;
    for (const b of this.buildings.buildings) {
      if (b.destroyed) continue;
      const clearance = this.getBuildingClearance(b) + 2.2;
      const dx = this.position.x - b.position.x;
      const dz = this.position.z - b.position.z;
      const d = Math.hypot(dx, dz);
      if (d < clearance && d > 0.01) {
        const strength = ((clearance - d) / clearance) * 2.2;
        ax += (dx / d) * strength;
        az += (dz / d) * strength;
      }
    }
    return { x: ax, z: az };
  }

  private resolveBuildingOverlap(): void {
    for (const b of this.buildings.buildings) {
      if (b.destroyed) continue;
      const minR = this.getBuildingClearance(b);
      const dx = this.position.x - b.position.x;
      const dz = this.position.z - b.position.z;
      const d = Math.hypot(dx, dz);
      if (d < minR) {
        const nx = d > 0.01 ? dx / d : 1;
        const nz = d > 0.01 ? dz / d : 0;
        this.position.x = b.position.x + nx * minR;
        this.position.z = b.position.z + nz * minR;
      }
    }
  }

  private updateLeashVisuals(elapsed: number): void {
    if (!this.leashHeldByHand && !this.leashTarget) {
      this.leashLine.visible = false;
      this.leashBeacon.visible = false;
      return;
    }

    const start = this.collarWorldPos;
    const end = this.leashHeldByHand
      ? this.leashHandAnchor
      : new THREE.Vector3(this.leashTarget!.x, this.leashTarget!.y + 2.2, this.leashTarget!.z);

    // Build a smooth glowing catenary curve
    const pts: THREE.Vector3[] = [];
    const segs = 14;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = start.clone().lerp(end, t);
      const sag = Math.sin(t * Math.PI) * Math.min(3.5, start.distanceTo(end) * 0.14);
      p.y -= sag;
      pts.push(p);
    }
    this.leashLine.geometry.dispose();
    this.leashLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.leashLine.visible = true;

    if (this.leashBeacon.visible) {
      this.leashBeacon.rotation.y = elapsed * 2.2;
    }
  }

  private pickTargetForAction(action: CreatureActionType, playerVillage: Village, rivalVillage: Village): void {
    if (action === 'bring_wood') {
      const scaffold = playerVillage.myBuildings.find((b) => b.progress < 1 && !b.destroyed);
      const raw = scaffold ? scaffold.position : playerVillage.center;
      this.currentTarget.copy(this.computeStandOffTarget(raw));
    } else if (action === 'feed_village' || action === 'eat_food') {
      const granary = this.buildings.findGranary('player');
      const raw = granary ? granary.position : playerVillage.center;
      this.currentTarget.copy(this.computeStandOffTarget(raw));
    } else if (action === 'entertain_rival' || action === 'throw_rock_rival') {
      this.currentTarget.copy(this.computeStandOffTarget(rivalVillage.center));
    } else {
      const angle = Math.random() * Math.PI * 2;
      const raw = new THREE.Vector3(
        playerVillage.center.x + Math.cos(angle) * 18,
        0,
        playerVillage.center.z + Math.sin(angle) * 18
      );
      this.currentTarget.copy(this.computeStandOffTarget(raw));
    }
  }

  private executeArrivedAction(playerVillage: Village, rivalVillage: Village): void {
    if (this.leashGoal === 'build' && this.leashBuilding && this.leashBuilding.progress < 1 && !this.leashBuilding.destroyed) {
      this.buildings.deliverWood(this.leashBuilding, 0.75);
      this.alignment.shift(0.03, 'Creature Helped Build');
      playerVillage.villagers.triggerCheer(this.position, 14);
    } else if (this.leashGoal === 'granary') {
      this.gameState.addWood(18);
      this.gameState.addFood(18);
      this.alignment.shift(0.03, 'Creature Stocked Granary');
      playerVillage.villagers.triggerCheer(this.position, 14);
    } else if (this.currentAction === 'bring_wood') {
      const scaffold = playerVillage.myBuildings.find((b) => b.progress < 1 && !b.destroyed);
      if (scaffold) {
        this.buildings.deliverWood(scaffold, 0.6);
        this.alignment.shift(0.03, 'Creature Helped Build');
      }
    } else if (this.currentAction === 'feed_village') {
      this.gameState.addFood(12);
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

  dispose(): void {
    this.visuals.dispose(this.scene);
    this.scene.remove(this.leashLine, this.leashBeacon);
  }
}
