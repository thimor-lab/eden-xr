import * as THREE from 'three';
import { IslandTerrain, PLAYER_VILLAGE_POS } from '../world/IslandTerrain';
import { HandState } from './HandTracker';

export type VRNavMode = 'world-pull' | 'point-glide';

/**
 * VR-native God Locomotion designed for bare-hand Android XR:
 * - World-Pull mode: 1-hand grab air to pull & flick-glide (with smooth inertia),
 *   2-hand grab to scale (zoom) AND twist-rotate the island like a living diorama!
 * - Point-Glide mode: Open-palm/pinch aim glides smoothly toward where you point.
 * - Smooth Swoop-To-Target: Instant comfortable jumps to Home, Rival Village, or Creature!
 */
export class WorldLocomotion {
  public navMode: VRNavMode = 'world-pull';

  private pullingHand: 'left' | 'right' | null = null;
  private lastPullPos = new THREE.Vector3();
  private glideVelocity = new THREE.Vector3();

  private twoHandActive = false;
  private initialTwoHandDist = 1;
  private initialRigScale = 8.5;
  private lastTwoHandAngle = 0;

  private swoopTargetPos: THREE.Vector3 | null = null;
  private swoopTargetScale: number | null = null;

  constructor(
    public readonly godRig: THREE.Group,
    private readonly terrain: IslandTerrain
  ) {
    this.resetView();
  }

  resetView(): void {
    this.swoopTargetPos = null;
    this.swoopTargetScale = null;
    this.glideVelocity.set(0, 0, 0);
    this.godRig.position.set(PLAYER_VILLAGE_POS.x - 4, 16, PLAYER_VILLAGE_POS.z + 24);
    this.godRig.rotation.set(0, 0, 0);
    this.godRig.scale.setScalar(8.5);
  }

  toggleNavMode(): VRNavMode {
    this.navMode = this.navMode === 'world-pull' ? 'point-glide' : 'world-pull';
    this.glideVelocity.set(0, 0, 0);
    this.pullingHand = null;
    return this.navMode;
  }

  /** Smoothly swoops the player over a target world coordinate (e.g. Home, Rival, Creature) */
  swoopTo(worldTarget: THREE.Vector3, targetScale = 7.5): void {
    const y = Math.max(12, this.terrain.getHeightAt(worldTarget.x, worldTarget.z) + targetScale * 1.45);
    this.swoopTargetPos = new THREE.Vector3(worldTarget.x, y, worldTarget.z + targetScale * 2.0);
    this.swoopTargetScale = THREE.MathUtils.clamp(targetScale, 2.5, 20);
    this.glideVelocity.set(0, 0, 0);
    this.pullingHand = null;
  }

  update(left: HandState, right: HandState, leftBusy: boolean, rightBusy: boolean, dt = 1 / 72): void {
    // 1. Handle smooth swoop jump if active
    if (this.swoopTargetPos && this.swoopTargetScale !== null) {
      const alpha = 1 - Math.exp(-5.5 * dt);
      this.godRig.position.lerp(this.swoopTargetPos, alpha);
      const nextScale = THREE.MathUtils.lerp(this.godRig.scale.x, this.swoopTargetScale, alpha);
      this.godRig.scale.setScalar(nextScale);
      if (this.godRig.position.distanceTo(this.swoopTargetPos) < 0.35) {
        this.swoopTargetPos = null;
        this.swoopTargetScale = null;
      }
      return;
    }

    const leftFreeGrab = left.tracked && (left.isGrabbing || left.isPinching) && !leftBusy;
    const rightFreeGrab = right.tracked && (right.isGrabbing || right.isPinching) && !rightBusy;

    // 2. Two-hand diorama scale (zoom) + twist rotation!
    if (leftFreeGrab && rightFreeGrab) {
      this.pullingHand = null;
      this.glideVelocity.set(0, 0, 0);
      const lLocal = left.palmLocalPos;
      const rLocal = right.palmLocalPos;
      const dist = Math.max(0.08, lLocal.distanceTo(rLocal));
      const angle = Math.atan2(rLocal.z - lLocal.z, rLocal.x - lLocal.x);

      if (!this.twoHandActive) {
        this.twoHandActive = true;
        this.initialTwoHandDist = dist;
        this.initialRigScale = this.godRig.scale.x;
        this.lastTwoHandAngle = angle;
      } else {
        const ratio = this.initialTwoHandDist / dist;
        const nextScale = THREE.MathUtils.clamp(this.initialRigScale * ratio, 2.0, 24.0);
        this.godRig.scale.setScalar(nextScale);

        // Smooth yaw twist rotation
        let dAngle = angle - this.lastTwoHandAngle;
        if (dAngle > Math.PI) dAngle -= Math.PI * 2;
        if (dAngle < -Math.PI) dAngle += Math.PI * 2;
        this.godRig.rotation.y += dAngle * 0.85;
        this.lastTwoHandAngle = angle;
      }
      return;
    }

    this.twoHandActive = false;

    // 3. Point-Glide navigation mode (fly smoothly in the direction your free hand points)
    if (this.navMode === 'point-glide') {
      const activeHand = leftFreeGrab ? left : rightFreeGrab ? right : null;
      if (activeHand) {
        const flySpeed = Math.max(12, this.godRig.scale.x * 2.4);
        const dir = activeHand.aimDirectionWorld.clone();
        dir.y *= 0.45; // Gentle vertical glide
        this.glideVelocity.lerp(dir.multiplyScalar(flySpeed), Math.min(1, dt * 6));
      } else {
        this.glideVelocity.multiplyScalar(Math.exp(-4.5 * dt));
      }
      this.godRig.position.addScaledVector(this.glideVelocity, dt);
      this.clampRigPosition();
      return;
    }

    // 4. World-Pull mode with inertial flick-glide!
    const activeHand = leftFreeGrab ? left : rightFreeGrab ? right : null;
    if (!activeHand) {
      this.pullingHand = null;
      if (this.glideVelocity.lengthSq() > 0.02) {
        this.godRig.position.addScaledVector(this.glideVelocity, dt);
        this.glideVelocity.multiplyScalar(Math.exp(-3.8 * dt));
        this.clampRigPosition();
      }
      return;
    }

    const localPos = activeHand.palmLocalPos;
    if (this.pullingHand !== activeHand.handedness) {
      this.pullingHand = activeHand.handedness;
      this.lastPullPos.copy(localPos);
      this.glideVelocity.set(0, 0, 0);
      return;
    }

    const deltaLocal = localPos.clone().sub(this.lastPullPos);
    // Rotate local delta by rig yaw so pulling always matches your facing direction
    deltaLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.godRig.rotation.y);
    const deltaWorld = deltaLocal.multiplyScalar(this.godRig.scale.x * 1.25);
    this.godRig.position.sub(deltaWorld);

    if (dt > 1e-4) {
      const instantVel = deltaWorld.clone().divideScalar(-dt);
      this.glideVelocity.lerp(instantVel, 0.35);
      if (this.glideVelocity.length() > 45) this.glideVelocity.setLength(45);
    }

    this.clampRigPosition();
    this.lastPullPos.copy(localPos);
  }

  private clampRigPosition(): void {
    this.godRig.position.x = THREE.MathUtils.clamp(this.godRig.position.x, -110, 110);
    this.godRig.position.z = THREE.MathUtils.clamp(this.godRig.position.z, -110, 110);
    const groundY = this.terrain.getHeightAt(this.godRig.position.x, this.godRig.position.z);
    this.godRig.position.y = THREE.MathUtils.clamp(this.godRig.position.y, Math.max(3.0, groundY + 2.2), 75);
  }
}
