import * as THREE from 'three';
import { AlignmentPalette } from '../core/AlignmentSystem';
import { GodHandMesh } from './GodHandMesh';

export interface HandState {
  handedness: 'left' | 'right';
  tracked: boolean;
  palmLocalPos: THREE.Vector3;
  indexTipLocalPos: THREE.Vector3;
  palmWorldPos: THREE.Vector3;
  pinchWorldPos: THREE.Vector3;
  indexTipWorldPos: THREE.Vector3;
  aimDirectionWorld: THREE.Vector3;
  palmNormalLocal: THREE.Vector3;
  isPalmFacingCamera: boolean;
  velocityWorld: THREE.Vector3;
  peakVelocityWorld: THREE.Vector3;
  isPinching: boolean;
  wasPinching: boolean;
  isGrabbing: boolean;
  wasGrabbing: boolean;
  isPointing: boolean;
  wasPointing: boolean;
  isOpenPalm: boolean;
}

/**
 * Returns the strongest velocity vector from a short recent frame buffer,
 * preventing VR throws from losing momentum during the 2-3 frames fingers open.
 */
export function computePeakVelocity(history: THREE.Vector3[]): THREE.Vector3 {
  if (history.length === 0) return new THREE.Vector3();
  let best = history[0];
  let bestLenSq = best.lengthSq();
  for (let i = 1; i < history.length; i++) {
    const lsq = history[i].lengthSq();
    if (lsq > bestLenSq) {
      bestLenSq = lsq;
      best = history[i];
    }
  }
  return best.clone();
}

const JOINT_ORDER: XRHandJoint[] = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
];

function createEmptyHand(handedness: 'left' | 'right'): HandState {
  return {
    handedness,
    tracked: false,
    palmLocalPos: new THREE.Vector3(),
    indexTipLocalPos: new THREE.Vector3(),
    palmWorldPos: new THREE.Vector3(),
    pinchWorldPos: new THREE.Vector3(),
    indexTipWorldPos: new THREE.Vector3(),
    aimDirectionWorld: new THREE.Vector3(0, -1, 0),
    palmNormalLocal: new THREE.Vector3(0, 1, 0),
    isPalmFacingCamera: false,
    velocityWorld: new THREE.Vector3(),
    peakVelocityWorld: new THREE.Vector3(),
    isPinching: false,
    wasPinching: false,
    isGrabbing: false,
    wasGrabbing: false,
    isPointing: false,
    wasPointing: false,
    isOpenPalm: false,
  };
}

/**
 * Extracts 25-joint skeletal hand poses from WebXR on Android XR,
 * classifies pinch/grab/point/open-palm poses, and computes smoothed & peak world velocity.
 */
export class HandTracker {
  public readonly left: HandState = createEmptyHand('left');
  public readonly right: HandState = createEmptyHand('right');

  private readonly leftMesh: GodHandMesh;
  private readonly rightMesh: GodHandMesh;
  private readonly prevPos = { left: new THREE.Vector3(), right: new THREE.Vector3() };
  private readonly velHistory: Record<'left' | 'right', THREE.Vector3[]> = { left: [], right: [] };

  constructor(private readonly godRig: THREE.Group) {
    this.leftMesh = new GodHandMesh(godRig);
    this.rightMesh = new GodHandMesh(godRig);
  }

  update(
    renderer: THREE.WebGLRenderer,
    frame: XRFrame | undefined,
    dt: number,
    palette: AlignmentPalette,
    headLocalPos?: THREE.Vector3
  ): void {
    const session = renderer.xr.getSession();
    const refSpace = renderer.xr.getReferenceSpace();

    this.prepareFrame(this.left);
    this.prepareFrame(this.right);

    if (!session || !frame || !refSpace) {
      this.leftMesh.hide();
      this.rightMesh.hide();
      return;
    }

    for (const source of session.inputSources) {
      if (source.handedness !== 'left' && source.handedness !== 'right') continue;
      const state = source.handedness === 'left' ? this.left : this.right;
      const visual = source.handedness === 'left' ? this.leftMesh : this.rightMesh;

      if (source.hand) {
        this.readXRHand(source.hand, frame, refSpace, state, visual, dt, palette, headLocalPos);
      } else if (source.gripSpace) {
        // Fallback if user has XR controllers instead of bare hands
        const pose = frame.getPose(source.gripSpace, refSpace);
        if (pose) {
          state.tracked = true;
          const localPos = new THREE.Vector3(
            pose.transform.position.x,
            pose.transform.position.y,
            pose.transform.position.z
          );
          const worldPos = localPos.clone().applyMatrix4(this.godRig.matrixWorld);
          this.updateVelocity(state, worldPos, dt);
          state.palmWorldPos.copy(worldPos);
          state.pinchWorldPos.copy(worldPos);
          state.indexTipWorldPos.copy(worldPos);
          const gp = source.gamepad;
          if (gp) {
            state.isPinching = gp.buttons[0]?.pressed ?? false;
            state.isGrabbing = gp.buttons[1]?.pressed ?? false;
            state.isPointing = gp.buttons[4]?.pressed ?? false;
          }
          visual.updateJoints([], localPos, palette);
        }
      }
    }

    if (!this.left.tracked) this.leftMesh.hide();
    if (!this.right.tracked) this.rightMesh.hide();
  }

  private prepareFrame(state: HandState): void {
    state.wasPinching = state.isPinching;
    state.wasGrabbing = state.isGrabbing;
    state.wasPointing = state.isPointing;
    state.tracked = false;
    state.isPinching = false;
    state.isGrabbing = false;
    state.isPointing = false;
    state.isOpenPalm = false;
    state.isPalmFacingCamera = false;
  }

  private readXRHand(
    hand: XRHand,
    frame: XRFrame,
    refSpace: XRReferenceSpace,
    state: HandState,
    visual: GodHandMesh,
    dt: number,
    palette: AlignmentPalette,
    headLocalPos?: THREE.Vector3
  ): void {
    const localJoints: THREE.Vector3[] = [];
    const map = new Map<XRHandJoint, THREE.Vector3>();

    for (const jointName of JOINT_ORDER) {
      const jointSpace = hand.get(jointName);
      if (!jointSpace) continue;
      const pose = frame.getJointPose?.(jointSpace, refSpace);
      if (!pose) continue;
      const p = new THREE.Vector3(
        pose.transform.position.x,
        pose.transform.position.y,
        pose.transform.position.z
      );
      localJoints.push(p);
      map.set(jointName, p);
    }

    const palmLocal = map.get('middle-finger-metacarpal') ?? map.get('wrist');
    const thumbTip = map.get('thumb-tip');
    const indexTip = map.get('index-finger-tip');
    const middleTip = map.get('middle-finger-tip');
    const ringTip = map.get('ring-finger-tip');
    const pinkyTip = map.get('pinky-finger-tip');

    if (!palmLocal || !thumbTip || !indexTip) return;

    state.tracked = true;
    state.palmLocalPos.copy(palmLocal);
    state.indexTipLocalPos.copy(indexTip);
    const pinchLocal = thumbTip.clone().lerp(indexTip, 0.5);

    // Compute palm normal in rig-local space from wrist -> index-metacarpal x pinky-metacarpal
    const wristLocal = map.get('wrist') ?? palmLocal;
    const indexMeta = map.get('index-finger-metacarpal');
    const pinkyMeta = map.get('pinky-finger-metacarpal');
    if (indexMeta && pinkyMeta) {
      const v1 = indexMeta.clone().sub(wristLocal);
      const v2 = pinkyMeta.clone().sub(wristLocal);
      const normal = state.handedness === 'left' ? v1.cross(v2) : v2.cross(v1);
      if (normal.lengthSq() > 1e-6) {
        state.palmNormalLocal.copy(normal.normalize());
      }
    }

    if (headLocalPos) {
      const toHead = headLocalPos.clone().sub(palmLocal).normalize();
      state.isPalmFacingCamera = state.palmNormalLocal.dot(toHead) > 0.52;
    }

    // Transform from rig-local XR space into scaled world space
    state.palmWorldPos.copy(palmLocal).applyMatrix4(this.godRig.matrixWorld);
    state.pinchWorldPos.copy(pinchLocal).applyMatrix4(this.godRig.matrixWorld);
    state.indexTipWorldPos.copy(indexTip).applyMatrix4(this.godRig.matrixWorld);

    // Compute world-space aiming direction from wrist through palm/index
    const wristWorld = wristLocal.clone().applyMatrix4(this.godRig.matrixWorld);
    const dir = state.indexTipWorldPos.clone().sub(wristWorld);
    if (dir.lengthSq() > 1e-5) {
      state.aimDirectionWorld.copy(dir.normalize());
    }

    this.updateVelocity(state, state.palmWorldPos, dt);

    // Pose classification in physical meter space (independent of godRig.scale!)
    const pinchDist = thumbTip.distanceTo(indexTip);
    state.isPinching = pinchDist < 0.032;

    const indexDist = indexTip.distanceTo(palmLocal);
    const midDist = middleTip ? middleTip.distanceTo(palmLocal) : 0.08;
    const ringDist = ringTip ? ringTip.distanceTo(palmLocal) : 0.08;
    const pinkyDist = pinkyTip ? pinkyTip.distanceTo(palmLocal) : 0.08;
    const avgCurl = (indexDist + midDist + ringDist + pinkyDist) * 0.25;

    state.isGrabbing = avgCurl < 0.072;
    state.isPointing = indexDist > 0.088 && midDist < 0.068 && ringDist < 0.068 && !state.isPinching;
    state.isOpenPalm = avgCurl > 0.095 && !state.isPinching;

    visual.updateJoints(localJoints, palmLocal, palette);
  }

  private updateVelocity(state: HandState, currentWorldPos: THREE.Vector3, dt: number): void {
    const prev = this.prevPos[state.handedness];
    const hist = this.velHistory[state.handedness];
    if (dt > 1e-4 && prev.lengthSq() > 0) {
      const instant = currentWorldPos.clone().sub(prev).divideScalar(dt);
      state.velocityWorld.lerp(instant, 0.42);
      hist.push(state.velocityWorld.clone());
      if (hist.length > 6) hist.shift();
      state.peakVelocityWorld.copy(computePeakVelocity(hist));
    }
    prev.copy(currentWorldPos);
  }
}
