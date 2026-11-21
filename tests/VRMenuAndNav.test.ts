import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { IslandTerrain, RIVAL_VILLAGE_POS } from '../src/world/IslandTerrain';
import { VRTutorialPanel } from '../src/xr/VRTutorialPanel';
import { findPokedButtonIndex, VRWristMenu } from '../src/xr/VRWristMenu';
import { WorldLocomotion } from '../src/xr/WorldLocomotion';

describe('VR Wrist Menu & Locomotion', () => {
  it('detects the closest poked 3D wrist menu button within poke radius', () => {
    const buttons = [
      new THREE.Vector3(-0.1, 0.04, 0),
      new THREE.Vector3(0.0, 0.04, 0),
      new THREE.Vector3(0.1, 0.04, 0),
    ];

    expect(findPokedButtonIndex(new THREE.Vector3(0.005, 0.035, 0.01), buttons, 0.038)).toBe(1);
    expect(findPokedButtonIndex(new THREE.Vector3(0.5, 0.5, 0.5), buttons, 0.038)).toBe(-1);
  });

  it('toggles VR navigation mode between world-pull and point-glide', () => {
    const rig = new THREE.Group();
    const terrain = new IslandTerrain();
    const nav = new WorldLocomotion(rig, terrain);

    expect(nav.navMode).toBe('world-pull');
    expect(nav.toggleNavMode()).toBe('point-glide');
    expect(nav.toggleNavMode()).toBe('world-pull');
  });

  it('smoothly swoops rig toward a target village when swoopTo is triggered', () => {
    const rig = new THREE.Group();
    const terrain = new IslandTerrain();
    const nav = new WorldLocomotion(rig, terrain);
    const startDist = rig.position.distanceTo(RIVAL_VILLAGE_POS);

    nav.swoopTo(RIVAL_VILLAGE_POS, 7.0);
    const dummyHand = {
      handedness: 'left' as const,
      tracked: false,
      jointCount: 0,
      palmLocalPos: new THREE.Vector3(),
      indexTipLocalPos: new THREE.Vector3(),
      palmWorldPos: new THREE.Vector3(),
      pinchWorldPos: new THREE.Vector3(),
      indexTipWorldPos: new THREE.Vector3(),
      aimDirectionWorld: new THREE.Vector3(0, -1, 0),
      palmNormalLocal: new THREE.Vector3(0, 1, 0),
      palmDotHead: 0,
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

    for (let i = 0; i < 30; i++) {
      nav.update(dummyHand, dummyHand, false, false, 1 / 60);
    }

    expect(rig.position.distanceTo(RIVAL_VILLAGE_POS)).toBeLessThan(startDist * 0.5);
  });

  it('orients both VR menus directly toward the user head even inside a translated/scaled godRig', () => {
    const rig = new THREE.Group();
    rig.position.set(-28, 16, 34);
    rig.rotation.set(0, 0.7, 0);
    rig.scale.setScalar(8.5);
    rig.updateMatrixWorld(true);

    const tutorial = new VRTutorialPanel(rig);
    const wrist = new VRWristMenu(rig);

    const headLocal = new THREE.Vector3(0.2, 1.6, 0.1);
    const fwdLocal = new THREE.Vector3(0, 0, -1);

    const leftHand = {
      handedness: 'left' as const,
      tracked: true,
      jointCount: 25,
      palmLocalPos: new THREE.Vector3(-0.2, 1.25, -0.45),
      indexTipLocalPos: new THREE.Vector3(-0.2, 1.32, -0.5),
      palmWorldPos: new THREE.Vector3(),
      pinchWorldPos: new THREE.Vector3(),
      indexTipWorldPos: new THREE.Vector3(),
      aimDirectionWorld: new THREE.Vector3(0, -1, 0),
      palmNormalLocal: new THREE.Vector3(0, 1, 0),
      palmDotHead: 0.9,
      isPalmFacingCamera: true,
      velocityWorld: new THREE.Vector3(),
      peakVelocityWorld: new THREE.Vector3(),
      isPinching: false,
      wasPinching: false,
      isGrabbing: false,
      wasGrabbing: false,
      isPointing: false,
      wasPointing: false,
      isOpenPalm: true,
    };

    tutorial.update(
      headLocal,
      fwdLocal,
      { ...leftHand, handedness: 'right', tracked: false },
      leftHand,
      { moved: false, zoomed: false, openedMenu: false, interacted: false },
      'world-pull',
      0.016,
      () => {}
    );
    wrist.update(leftHand, { ...leftHand, handedness: 'right', tracked: false }, headLocal, 0.2, () => {});

    // Check front +Z normal of both panels points straight toward headLocal
    const tutFront = new THREE.Vector3(0, 0, 1).applyQuaternion(tutorial.group.quaternion).normalize();
    const tutToHead = headLocal.clone().sub(tutorial.group.position).normalize();
    expect(tutFront.dot(tutToHead)).toBeGreaterThan(0.99);

    const wristFront = new THREE.Vector3(0, 0, 1).applyQuaternion(wrist.group.quaternion).normalize();
    const wristToHead = headLocal.clone().sub(wrist.group.position).normalize();
    expect(wristFront.dot(wristToHead)).toBeGreaterThan(0.99);
  });
});
