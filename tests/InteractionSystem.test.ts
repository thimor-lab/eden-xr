import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyAftertouch } from '../src/physics/PhysicsWorld';
import { computePeakVelocity } from '../src/xr/HandTracker';
import { computeTrajectoryPoints } from '../src/xr/InteractionFeedback';

describe('Interaction System', () => {
  it('picks peak velocity from recent frame history to prevent VR release flop', () => {
    const history = [
      new THREE.Vector3(2, 1, 0),
      new THREE.Vector3(14, 6, -3),
      new THREE.Vector3(5, 2, -1),
      new THREE.Vector3(1, 0, 0),
    ];
    const peak = computePeakVelocity(history);
    expect(peak.x).toBe(14);
    expect(peak.y).toBe(6);
    expect(peak.z).toBe(-3);
  });

  it('computes a parabolic throw trajectory and terrain landing point', () => {
    const start = new THREE.Vector3(0, 6, 0);
    const vel = new THREE.Vector3(10, 6, 0);
    const { points, landing } = computeTrajectoryPoints(start, vel, -14.5, () => 0, 40, 0.06);

    expect(points.length).toBeGreaterThan(5);
    expect(landing).not.toBeNull();
    expect(landing!.x).toBeGreaterThan(8);
    expect(landing!.y).toBeCloseTo(0.15, 1);
  });

  it('applies gentle aftertouch aim-assist toward nearby targets within cone', () => {
    const origin = new THREE.Vector3(0, 5, 0);
    const target = new THREE.Vector3(25, 0, 4); // Slightly off +X axis
    const rawVel = new THREE.Vector3(20, 8, 0); // Aimed straight +X

    const assisted = applyAftertouch(origin, rawVel, [target], 0.35);
    expect(assisted.z).toBeGreaterThan(0.5);
    expect(assisted.y).toBe(rawVel.y);
  });

  it('does not bend throws aimed away from targets', () => {
    const origin = new THREE.Vector3(0, 5, 0);
    const target = new THREE.Vector3(-25, 0, 0); // Behind throw
    const rawVel = new THREE.Vector3(20, 8, 0);

    const assisted = applyAftertouch(origin, rawVel, [target], 0.35);
    expect(assisted.x).toBeCloseTo(rawVel.x);
    expect(assisted.z).toBeCloseTo(rawVel.z);
  });
});
