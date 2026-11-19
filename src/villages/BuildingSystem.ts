import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import { IslandTerrain } from '../world/IslandTerrain';

export type BuildingKind = 'house' | 'granary' | 'wonder' | 'temple';

export interface Building {
  id: string;
  villageId: string;
  kind: BuildingKind;
  position: THREE.Vector3;
  group: THREE.Group;
  scaffoldMesh: THREE.Object3D;
  completedMesh: THREE.Object3D;
  fireMesh: THREE.Mesh;
  progress: number; // 0..1 (1 = built)
  health: number; // 0..100
  onFire: boolean;
  destroyed: boolean;
  impressiveness: number;
  woodDelivered: number;
  woodNeeded: number;
}

export class BuildingSystem {
  public readonly buildings: Building[] = [];
  private nextId = 1;

  private readonly wallMat = new THREE.MeshStandardMaterial({ color: 0xe6dbc5, roughness: 0.85, flatShading: true });
  private readonly roofGoodMat = new THREE.MeshStandardMaterial({ color: 0x3b78b8, roughness: 0.75, flatShading: true });
  private readonly roofRivalMat = new THREE.MeshStandardMaterial({ color: 0xb54b38, roughness: 0.75, flatShading: true });
  private readonly scaffoldMat = new THREE.MeshStandardMaterial({
    color: 0xa67c52,
    roughness: 0.9,
    wireframe: false,
    flatShading: true,
  });
  private readonly fireMat = new THREE.MeshBasicMaterial({
    color: 0xff5511,
    transparent: true,
    opacity: 0.85,
  });

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: IslandTerrain,
    private readonly bus: EventBus
  ) {}

  createBuilding(options: {
    villageId: string;
    kind: BuildingKind;
    x: number;
    z: number;
    built: boolean;
  }): Building {
    const y = this.terrain.getHeightAt(options.x, options.z);
    const position = new THREE.Vector3(options.x, y, options.z);
    const group = new THREE.Group();
    group.position.copy(position);

    // Scaffold visual (wooden posts)
    const scaffoldMesh = new THREE.Group();
    const postGeom = new THREE.BoxGeometry(0.18, 2.2, 0.18);
    for (const [px, pz] of [
      [-1.3, -1.3],
      [1.3, -1.3],
      [-1.3, 1.3],
      [1.3, 1.3],
    ]) {
      const p = new THREE.Mesh(postGeom, this.scaffoldMat);
      p.position.set(px, 1.1, pz);
      scaffoldMesh.add(p);
    }
    const basePad = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.15, 3.0), this.scaffoldMat);
    basePad.position.y = 0.08;
    scaffoldMesh.add(basePad);

    // Completed building visual
    const completedMesh = new THREE.Group();
    const roofMat = options.villageId === 'player' ? this.roofGoodMat : this.roofRivalMat;

    if (options.kind === 'house') {
      const walls = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.9, 2.6), this.wallMat);
      walls.position.y = 0.95;
      walls.castShadow = true;
      walls.receiveShadow = true;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.6, 4), roofMat);
      roof.position.y = 2.6;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      completedMesh.add(walls, roof);
    } else if (options.kind === 'granary') {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 2.4, 8), this.wallMat);
      base.position.y = 1.2;
      base.castShadow = true;
      const dome = new THREE.Mesh(new THREE.ConeGeometry(2.0, 1.5, 8), roofMat);
      dome.position.y = 3.1;
      dome.castShadow = true;
      completedMesh.add(base, dome);
    } else if (options.kind === 'wonder') {
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3.0, 1.2, 6), this.wallMat);
      plinth.position.y = 0.6;
      const spire = new THREE.Mesh(new THREE.ConeGeometry(1.4, 6.2, 6), roofMat);
      spire.position.y = 4.2;
      spire.castShadow = true;
      completedMesh.add(plinth, spire);
    } else {
      // Temple
      const base = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.2, 1.5, 8), this.wallMat);
      base.position.y = 0.75;
      base.castShadow = true;
      const hall = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 3.0, 8), this.wallMat);
      hall.position.y = 2.8;
      hall.castShadow = true;
      const crown = new THREE.Mesh(new THREE.ConeGeometry(2.4, 3.2, 8), roofMat);
      crown.position.y = 5.8;
      crown.castShadow = true;
      completedMesh.add(base, hall, crown);
    }

    const fireMesh = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3.2, 6), this.fireMat);
    fireMesh.position.y = 2.0;
    fireMesh.visible = false;

    group.add(scaffoldMesh, completedMesh, fireMesh);
    this.scene.add(group);

    const impressiveness =
      options.kind === 'wonder' ? 45 : options.kind === 'temple' ? 35 : options.kind === 'granary' ? 20 : 15;
    const woodNeeded = options.kind === 'wonder' ? 3 : 1;

    const building: Building = {
      id: `bldg_${this.nextId++}`,
      villageId: options.villageId,
      kind: options.kind,
      position,
      group,
      scaffoldMesh,
      completedMesh,
      fireMesh,
      progress: options.built ? 1 : 0.1,
      health: 100,
      onFire: false,
      destroyed: false,
      impressiveness,
      woodDelivered: options.built ? woodNeeded : 0,
      woodNeeded,
    };

    this.syncVisual(building);
    this.buildings.push(building);
    return building;
  }

  deliverWood(building: Building, amount = 1): void {
    if (building.progress >= 1 || building.destroyed) return;
    building.woodDelivered += amount;
    this.addProgress(building, 0.45 * amount);
  }

  addProgress(building: Building, delta: number): void {
    if (building.progress >= 1 || building.destroyed) return;
    building.progress = Math.min(1, building.progress + delta);
    this.syncVisual(building);
    if (building.progress >= 1) {
      this.bus.emit('building:completed', {
        villageId: building.villageId,
        position: building.position.clone(),
        impressiveness: building.impressiveness,
      });
    }
  }

  damageBuilding(building: Building, amount: number, ignite = false): void {
    if (building.destroyed) return;
    building.health = Math.max(0, building.health - amount);
    if (ignite) building.onFire = true;
    if (building.health <= 0) {
      building.destroyed = true;
      building.onFire = false;
      building.completedMesh.scale.set(1, 0.2, 1);
      building.scaffoldMesh.visible = false;
    }
    this.syncVisual(building);
    this.bus.emit('building:damaged', {
      villageId: building.villageId,
      position: building.position.clone(),
      amount,
      destroyed: building.destroyed,
    });
  }

  extinguishNear(center: THREE.Vector3, radius: number): number {
    let count = 0;
    for (const b of this.buildings) {
      if (b.onFire && b.position.distanceTo(center) <= radius) {
        b.onFire = false;
        b.fireMesh.visible = false;
        count++;
      }
    }
    return count;
  }

  damageInRadius(center: THREE.Vector3, radius: number, maxDamage: number, ignite = false): Building[] {
    const hit: Building[] = [];
    for (const b of this.buildings) {
      if (b.destroyed) continue;
      const d = b.position.distanceTo(center);
      if (d <= radius) {
        const falloff = 1 - d / radius;
        this.damageBuilding(b, maxDamage * (0.4 + 0.6 * falloff), ignite);
        hit.push(b);
      }
    }
    return hit;
  }

  update(dt: number, elapsed: number): void {
    for (const b of this.buildings) {
      if (b.onFire && !b.destroyed) {
        b.fireMesh.visible = true;
        b.fireMesh.scale.setScalar(0.85 + Math.sin(elapsed * 14 + b.position.x) * 0.22);
        b.fireMesh.rotation.y += dt * 4;
        b.health = Math.max(0, b.health - dt * 6.5);
        if (b.health <= 0) {
          this.damageBuilding(b, 1, false);
        }
      } else {
        b.fireMesh.visible = false;
      }
    }
  }

  private syncVisual(b: Building): void {
    if (b.destroyed) {
      b.fireMesh.visible = false;
      return;
    }
    if (b.progress >= 1) {
      b.scaffoldMesh.visible = false;
      b.completedMesh.visible = true;
      b.completedMesh.scale.set(1, 1, 1);
    } else {
      b.scaffoldMesh.visible = true;
      b.completedMesh.visible = b.progress > 0.25;
      b.completedMesh.scale.set(1, Math.max(0.15, b.progress), 1);
    }
  }

  clearAll(): void {
    for (const b of this.buildings) {
      this.scene.remove(b.group);
    }
    this.buildings.length = 0;
  }
}
