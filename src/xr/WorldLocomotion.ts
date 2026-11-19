import * as THREE from 'three';
import { IslandTerrain, PLAYER_VILLAGE_POS } from '../world/IslandTerrain';
import { HandState } from './HandTracker';

/**
 * Black & White inspired God Locomotion for VR:
 * - 1-hand grab in empty air: Pull/glide across the island.
 * - 2-hand pinch/grab in empty air: Spread to zoom in (shrink scale), squeeze to zoom out to cloud level.
 */
export class WorldLocomotion {
  private pullingHand: 'left' | 'right' | null = null;
  private lastPullPos = new THREE.Vector3();
  private twoHandActive = false;
  private initialTwoHandDist = 1;
  private initialRigScale = 8;

  constructor(
    public readonly godRig: THREE.Group,
    private readonly terrain: IslandTerrain
  ) {
    this.resetView();
  }

  resetView(): void {
    this.godRig.position.set(PLAYER_VILLAGE_POS.x - 4, 16, PLAYER_VILLAGE_POS.z + 24);
    this.godRig.rotation.set(0, 0, 0);
    this.godRig.scale.setScalar(8.5);
  }

  update(left: HandState, right: HandState, leftBusy: boolean, rightBusy: boolean): void {
    const leftFreeGrab = left.tracked && (left.isGrabbing || left.isPinching) && !leftBusy;
    const rightFreeGrab = right.tracked && (right.isGrabbing || right.isPinching) && !rightBusy;

    // Two-hand world scaling (zoom in/out)
    if (leftFreeGrab && rightFreeGrab) {
      this.pullingHand = null;
      // Measure hand separation in rig-local space so scaling doesn't feedback-loop
      const inv = this.godRig.matrixWorld.clone().invert();
      const lLocal = left.palmWorldPos.clone().applyMatrix4(inv);
      const rLocal = right.palmWorldPos.clone().applyMatrix4(inv);
      const dist = Math.max(0.08, lLocal.distanceTo(rLocal));

      if (!this.twoHandActive) {
        this.twoHandActive = true;
        this.initialTwoHandDist = dist;
        this.initialRigScale = this.godRig.scale.x;
      } else {
        const ratio = this.initialTwoHandDist / dist;
        const nextScale = THREE.MathUtils.clamp(this.initialRigScale * ratio, 2.0, 22.0);
        this.godRig.scale.setScalar(nextScale);
      }
      return;
    }

    this.twoHandActive = false;

    // One-hand world pull
    const activeHand = leftFreeGrab ? left : rightFreeGrab ? right : null;
    if (!activeHand) {
      this.pullingHand = null;
      return;
    }

    const inv = this.godRig.matrixWorld.clone().invert();
    const localPos = activeHand.palmWorldPos.clone().applyMatrix4(inv);

    if (this.pullingHand !== activeHand.handedness) {
      this.pullingHand = activeHand.handedness;
      this.lastPullPos.copy(localPos);
      return;
    }

    const deltaLocal = localPos.clone().sub(this.lastPullPos);
    const deltaWorld = deltaLocal.multiplyScalar(this.godRig.scale.x * 1.15);
    this.godRig.position.sub(deltaWorld);

    // Keep player comfortably within island bounds and above ground
    this.godRig.position.x = THREE.MathUtils.clamp(this.godRig.position.x, -85, 85);
    this.godRig.position.z = THREE.MathUtils.clamp(this.godRig.position.z, -85, 85);
    const groundY = this.terrain.getHeightAt(this.godRig.position.x, this.godRig.position.z);
    this.godRig.position.y = THREE.MathUtils.clamp(this.godRig.position.y, Math.max(2.5, groundY + 1.8), 65);

    this.lastPullPos.copy(localPos);
  }
}
