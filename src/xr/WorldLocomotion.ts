import * as THREE from 'three';
import { IslandTerrain, PLAYER_VILLAGE_POS } from '../world/IslandTerrain';
import { HandState } from './HandTracker';

export type VRNavMode = 'world-pull' | 'point-glide';

/**
 * Reworked VR-native Diorama God Locomotion:
 * - Triggered ONLY by deliberate FIST (`isGripFist`) so navigation NEVER fights Pinch object grabbing!
 * - 1-Hand Fist + Pull: Pure horizontal XZ world-pull with gentle flick-glide inertia (zero vertical sky-launch!).
 * - 2-Hand Fist + Spread/Squeeze: Scales smoothly PIVOTED AROUND THE MIDPOINT between both hands
 *   so the village/island you are looking at stays locked right in front of you!
 * - 2-Hand Fist + Twist: Rotates the island like a turntable around that same midpoint (zero swing nausea!).
 * - 2-Hand Fist + Raise/Lower both hands together: Deliberate smooth altitude adjustment.
 * - Point-Glide mode + Swoop-To-Target (Teleport / Quick Jumps).
 */
export class WorldLocomotion {
  public navMode: VRNavMode = 'world-pull';
  public hasMovedByNav = false;
  public hasZoomedByTwoHand = false;

  private pullingHand: 'left' | 'right' | null = null;
  private lastPullLocal = new THREE.Vector3();
  private glideVelocityXZ = new THREE.Vector3();

  private twoHandActive = false;
  private lastTwoHandDist = 1;
  private lastTwoHandAngle = 0;
  private lastTwoHandMidY = 0;

  private swoopTargetPos: THREE.Vector3 | null = null;
  private swoopTargetScale: number | null = null;

  private readonly grabAnchorMesh: THREE.Mesh;
  private readonly twoHandLine: THREE.Line;

  constructor(
    public readonly godRig: THREE.Group,
    private readonly terrain: IslandTerrain
  ) {
    this.grabAnchorMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x66f0ff, transparent: true, opacity: 0.8 })
    );
    this.grabAnchorMesh.visible = false;

    this.twoHandLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xffe488, transparent: true, opacity: 0.9 })
    );
    this.twoHandLine.frustumCulled = false;
    this.twoHandLine.visible = false;

    this.godRig.add(this.grabAnchorMesh, this.twoHandLine);
    this.resetView();
  }

  resetView(): void {
    this.swoopTargetPos = null;
    this.swoopTargetScale = null;
    this.glideVelocityXZ.set(0, 0, 0);
    this.pullingHand = null;
    this.twoHandActive = false;
    this.godRig.position.set(PLAYER_VILLAGE_POS.x - 4, 14, PLAYER_VILLAGE_POS.z + 22);
    this.godRig.rotation.set(0, 0, 0);
    this.godRig.scale.setScalar(8.0);
    this.godRig.updateMatrixWorld(true);
  }

  toggleNavMode(): VRNavMode {
    this.navMode = this.navMode === 'world-pull' ? 'point-glide' : 'world-pull';
    this.glideVelocityXZ.set(0, 0, 0);
    this.pullingHand = null;
    return this.navMode;
  }

  /** Smoothly swoops the player over any world coordinate (used by Teleport & Quick Jumps) */
  swoopTo(worldTarget: THREE.Vector3, targetScale?: number): void {
    const scale = THREE.MathUtils.clamp(targetScale ?? this.godRig.scale.x, 2.5, 20);
    const groundY = Math.max(0, this.terrain.getHeightAt(worldTarget.x, worldTarget.z));
    // Place rig slightly back along current facing direction so target sits right in front of the player
    const backOffset = new THREE.Vector3(0, 0, scale * 1.8).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      this.godRig.rotation.y
    );
    this.swoopTargetPos = new THREE.Vector3(
      worldTarget.x + backOffset.x,
      Math.max(6, groundY + scale * 0.9),
      worldTarget.z + backOffset.z
    );
    this.swoopTargetScale = scale;
    this.glideVelocityXZ.set(0, 0, 0);
    this.pullingHand = null;
    this.twoHandActive = false;
  }

  update(left: HandState, right: HandState, leftBusy: boolean, rightBusy: boolean, dt = 1 / 72): void {
    // 1. Handle smooth swoop jump / teleport if active
    if (this.swoopTargetPos && this.swoopTargetScale !== null) {
      const alpha = 1 - Math.exp(-5.8 * dt);
      this.godRig.position.lerp(this.swoopTargetPos, alpha);
      const nextScale = THREE.MathUtils.lerp(this.godRig.scale.x, this.swoopTargetScale, alpha);
      this.godRig.scale.setScalar(nextScale);
      this.godRig.updateMatrixWorld(true);
      if (this.godRig.position.distanceTo(this.swoopTargetPos) < 0.35) {
        this.swoopTargetPos = null;
        this.swoopTargetScale = null;
      }
      return;
    }

    // Navigation uses deliberate FIST (`isGripFist`) — completely separate from Pinch!
    const leftFist = left.tracked && left.isGripFist && !leftBusy;
    const rightFist = right.tracked && right.isGripFist && !rightBusy;

    // 2. Two-hand midpoint-pivoted Zoom + Turntable Yaw Rotate + Deliberate Vertical Lift!
    if (leftFist && rightFist) {
      this.pullingHand = null;
      this.grabAnchorMesh.visible = false;
      this.glideVelocityXZ.set(0, 0, 0);

      const lLocal = left.palmLocalPos;
      const rLocal = right.palmLocalPos;
      const midLocal = lLocal.clone().lerp(rLocal, 0.5);
      const dist = Math.max(0.08, lLocal.distanceTo(rLocal));
      const angle = Math.atan2(rLocal.z - lLocal.z, rLocal.x - lLocal.x);

      this.twoHandLine.geometry.dispose();
      this.twoHandLine.geometry = new THREE.BufferGeometry().setFromPoints([lLocal, rLocal]);
      this.twoHandLine.visible = true;

      if (!this.twoHandActive) {
        this.twoHandActive = true;
        this.lastTwoHandDist = dist;
        this.lastTwoHandAngle = angle;
        this.lastTwoHandMidY = midLocal.y;
        return;
      }

      // Compute world position of midpoint BEFORE transform so we can keep it pinned in world space!
      this.godRig.updateMatrixWorld(true);
      const pivotWorldBefore = midLocal.clone().applyMatrix4(this.godRig.matrixWorld);

      // a) Incremental scale (spread hands = zoom IN / shrink rig scale; squeeze = zoom OUT)
      const scaleRatio = this.lastTwoHandDist / dist;
      const clampedRatio = THREE.MathUtils.clamp(scaleRatio, 0.85, 1.18);
      const nextScale = THREE.MathUtils.clamp(this.godRig.scale.x * clampedRatio, 2.0, 22.0);
      if (Math.abs(nextScale - this.godRig.scale.x) > 0.04) {
        this.hasZoomedByTwoHand = true;
      }
      this.godRig.scale.setScalar(nextScale);

      // b) Incremental turntable yaw rotation around midpoint
      let dAngle = angle - this.lastTwoHandAngle;
      if (dAngle > Math.PI) dAngle -= Math.PI * 2;
      if (dAngle < -Math.PI) dAngle += Math.PI * 2;
      this.godRig.rotation.y += THREE.MathUtils.clamp(dAngle, -0.15, 0.15);

      // Recompute midpoint in world space AFTER scale+rotation and compensate position so pivot stays FIXED!
      this.godRig.updateMatrixWorld(true);
      const pivotWorldAfter = midLocal.clone().applyMatrix4(this.godRig.matrixWorld);
      this.godRig.position.add(pivotWorldBefore.sub(pivotWorldAfter));

      // c) Deliberate altitude change when raising/lowering BOTH fists together
      const dMidY = midLocal.y - this.lastTwoHandMidY;
      this.godRig.position.y -= dMidY * this.godRig.scale.x * 0.9;

      this.clampRigPosition();
      this.godRig.updateMatrixWorld(true);

      this.lastTwoHandDist = dist;
      this.lastTwoHandAngle = angle;
      this.lastTwoHandMidY = midLocal.y;
      return;
    }

    this.twoHandActive = false;
    this.twoHandLine.visible = false;

    // 3. Point-Glide navigation mode (horizontal flight in pointing direction)
    if (this.navMode === 'point-glide') {
      const activeHand = leftFist ? left : rightFist ? right : null;
      if (activeHand) {
        this.grabAnchorMesh.position.copy(activeHand.palmLocalPos);
        this.grabAnchorMesh.visible = true;
        this.hasMovedByNav = true;
        const flySpeed = Math.max(14, this.godRig.scale.x * 2.5);
        const dir = activeHand.aimDirectionWorld.clone();
        dir.y = 0; // Keep flight level and comfortable!
        if (dir.lengthSq() > 1e-4) dir.normalize();
        this.glideVelocityXZ.lerp(dir.multiplyScalar(flySpeed), Math.min(1, dt * 6));
      } else {
        this.grabAnchorMesh.visible = false;
        this.glideVelocityXZ.multiplyScalar(Math.exp(-5.0 * dt));
      }
      this.godRig.position.x += this.glideVelocityXZ.x * dt;
      this.godRig.position.z += this.glideVelocityXZ.z * dt;
      this.clampRigPosition();
      this.godRig.updateMatrixWorld(true);
      return;
    }

    // 4. World-Pull mode: pure horizontal XZ diorama pull with gentle flick-glide inertia!
    const activeHand = leftFist ? left : rightFist ? right : null;
    if (!activeHand) {
      this.pullingHand = null;
      this.grabAnchorMesh.visible = false;
      if (this.glideVelocityXZ.lengthSq() > 0.04) {
        this.godRig.position.x += this.glideVelocityXZ.x * dt;
        this.godRig.position.z += this.glideVelocityXZ.z * dt;
        this.glideVelocityXZ.multiplyScalar(Math.exp(-4.5 * dt));
        this.clampRigPosition();
        this.godRig.updateMatrixWorld(true);
      }
      return;
    }

    const localPos = activeHand.palmLocalPos;
    this.grabAnchorMesh.position.copy(localPos);
    this.grabAnchorMesh.visible = true;

    if (this.pullingHand !== activeHand.handedness) {
      this.pullingHand = activeHand.handedness;
      this.lastPullLocal.copy(localPos);
      this.glideVelocityXZ.set(0, 0, 0);
      return;
    }

    // Horizontal-only delta (y = 0) so pulling never accidentally launches you into the sky or ground!
    const deltaLocal = new THREE.Vector3(localPos.x - this.lastPullLocal.x, 0, localPos.z - this.lastPullLocal.z);
    if (deltaLocal.length() > 0.005) {
      this.hasMovedByNav = true;
    }

    // Rotate local delta by rig yaw so pulling always moves the world in exact lockstep with your hand!
    deltaLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.godRig.rotation.y);
    const deltaWorldXZ = deltaLocal.multiplyScalar(this.godRig.scale.x * 1.35);

    this.godRig.position.x -= deltaWorldXZ.x;
    this.godRig.position.z -= deltaWorldXZ.z;

    if (dt > 1e-4) {
      const instantVel = new THREE.Vector3(-deltaWorldXZ.x / dt, 0, -deltaWorldXZ.z / dt);
      this.glideVelocityXZ.lerp(instantVel, 0.35);
      if (this.glideVelocityXZ.length() > 38) this.glideVelocityXZ.setLength(38);
    }

    this.clampRigPosition();
    this.godRig.updateMatrixWorld(true);
    this.lastPullLocal.copy(localPos);
  }

  private clampRigPosition(): void {
    this.godRig.position.x = THREE.MathUtils.clamp(this.godRig.position.x, -125, 125);
    this.godRig.position.z = THREE.MathUtils.clamp(this.godRig.position.z, -125, 125);
    const groundY = Math.max(0, this.terrain.getHeightAt(this.godRig.position.x, this.godRig.position.z));
    // Keep camera comfortably above terrain (head sits at rig.y + ~1.5 * rig.scale)
    const minRigY = Math.max(1.5, groundY - this.godRig.scale.x * 0.5);
    this.godRig.position.y = THREE.MathUtils.clamp(this.godRig.position.y, minRigY, 60);
  }
}
