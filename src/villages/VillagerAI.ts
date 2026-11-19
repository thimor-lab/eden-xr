import * as THREE from 'three';
import { IslandTerrain } from '../world/IslandTerrain';
import { Building } from './BuildingSystem';

export type VillagerState = 'idle' | 'worship' | 'build' | 'flee' | 'cheer';

export interface VillagerAgent {
  position: THREE.Vector3;
  target: THREE.Vector3;
  state: VillagerState;
  phase: number;
  timer: number;
  buildTarget: Building | null;
}

/**
 * Instanced stylized villagers with autonomous worship, building, fleeing, and cheering states.
 */
export class VillagerAI {
  public readonly agents: VillagerAgent[] = [];
  private readonly bodyMesh: THREE.InstancedMesh;
  private readonly headMesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();

  constructor(
    scene: THREE.Scene,
    private readonly terrain: IslandTerrain,
    private readonly center: THREE.Vector3,
    colorHex: number,
    count: number
  ) {
    const bodyGeom = new THREE.ConeGeometry(0.28, 0.95, 6);
    const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.85, flatShading: true });
    this.bodyMesh = new THREE.InstancedMesh(bodyGeom, bodyMat, count);
    this.bodyMesh.castShadow = true;

    const headGeom = new THREE.SphereGeometry(0.2, 6, 5);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xf1c7a4, roughness: 0.8, flatShading: true });
    this.headMesh = new THREE.InstancedMesh(headGeom, headMat, count);
    this.headMesh.castShadow = true;

    scene.add(this.bodyMesh, this.headMesh);

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const dist = 4 + (i % 5) * 1.8;
      const x = center.x + Math.cos(angle) * dist;
      const z = center.z + Math.sin(angle) * dist;
      const y = terrain.getHeightAt(x, z);
      this.agents.push({
        position: new THREE.Vector3(x, y, z),
        target: new THREE.Vector3(x, y, z),
        state: 'idle',
        phase: Math.random() * Math.PI * 2,
        timer: Math.random() * 4,
        buildTarget: null,
      });
    }
  }

  triggerPanic(hazardPos: THREE.Vector3, radius: number): void {
    for (const v of this.agents) {
      if (v.position.distanceTo(hazardPos) <= radius) {
        v.state = 'flee';
        v.timer = 5.5;
        const away = v.position.clone().sub(hazardPos).setY(0).normalize();
        if (away.lengthSq() < 0.01) away.set(1, 0, 0);
        v.target.copy(v.position).addScaledVector(away, 12);
      }
    }
  }

  triggerCheer(nearPos: THREE.Vector3, radius: number): void {
    for (const v of this.agents) {
      if (v.position.distanceTo(nearPos) <= radius) {
        v.state = 'cheer';
        v.timer = 4.5;
      }
    }
  }

  /** Returns number of actively worshipping villagers this frame */
  update(
    dt: number,
    elapsed: number,
    totemPos: THREE.Vector3,
    worshipRatio: number,
    unfinishedBuildings: Building[],
    onBuildTick: (b: Building, amount: number) => void
  ): number {
    const desiredWorshippers = Math.round(this.agents.length * worshipRatio);
    let worshippingCount = 0;

    for (let i = 0; i < this.agents.length; i++) {
      const v = this.agents[i];
      v.timer -= dt;

      // Decide state if not fleeing or cheering
      if (v.state === 'flee' || v.state === 'cheer') {
        if (v.timer <= 0) v.state = 'idle';
      } else if (i < desiredWorshippers) {
        v.state = 'worship';
        const angle = (i / Math.max(1, desiredWorshippers)) * Math.PI * 2 + elapsed * 0.25;
        v.target.set(totemPos.x + Math.cos(angle) * 3.8, totemPos.y, totemPos.z + Math.sin(angle) * 3.8);
      } else if (unfinishedBuildings.length > 0) {
        v.state = 'build';
        v.buildTarget = unfinishedBuildings[i % unfinishedBuildings.length];
        v.target.copy(v.buildTarget.position);
      } else if (v.timer <= 0) {
        v.state = 'idle';
        v.timer = 3 + Math.random() * 4;
        const angle = Math.random() * Math.PI * 2;
        const r = 4 + Math.random() * 10;
        v.target.set(this.center.x + Math.cos(angle) * r, 0, this.center.z + Math.sin(angle) * r);
      }

      // Move toward target
      const dx = v.target.x - v.position.x;
      const dz = v.target.z - v.position.z;
      const dist = Math.hypot(dx, dz);
      const speed = v.state === 'flee' ? 4.4 : 2.1;

      if (dist > 0.6) {
        const step = Math.min(dist, speed * dt);
        v.position.x += (dx / dist) * step;
        v.position.z += (dz / dist) * step;
      } else if (v.state === 'worship') {
        worshippingCount++;
      } else if (v.state === 'build' && v.buildTarget && !v.buildTarget.destroyed) {
        onBuildTick(v.buildTarget, dt * 0.04);
      }

      const groundY = this.terrain.getHeightAt(v.position.x, v.position.z);
      v.position.y = groundY;

      // Expressive animation bounce
      let bob = 0;
      if (v.state === 'worship') {
        bob = Math.abs(Math.sin(elapsed * 5.2 + v.phase)) * 0.25;
      } else if (v.state === 'cheer') {
        bob = Math.abs(Math.sin(elapsed * 9.0 + v.phase)) * 0.45;
      } else if (dist > 0.6) {
        bob = Math.abs(Math.sin(elapsed * 8.0 + v.phase)) * 0.14;
      }

      this.dummy.position.set(v.position.x, v.position.y + 0.5 + bob, v.position.z);
      this.dummy.rotation.set(0, Math.atan2(dx, dz), 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.bodyMesh.setMatrixAt(i, this.dummy.matrix);

      this.dummy.position.set(v.position.x, v.position.y + 1.12 + bob, v.position.z);
      this.dummy.updateMatrix();
      this.headMesh.setMatrixAt(i, this.dummy.matrix);
    }

    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.headMesh.instanceMatrix.needsUpdate = true;
    return worshippingCount;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.bodyMesh, this.headMesh);
  }
}
