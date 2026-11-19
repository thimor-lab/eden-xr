import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import { IslandTerrain } from '../world/IslandTerrain';

export type BuildingKind = 'house' | 'granary' | 'wonder' | 'temple';

export interface GranaryVisualRefs {
  grainMound: THREE.Mesh;
  woodStack: THREE.Group;
  dropRing: THREE.Mesh;
}

export interface Building {
  id: string;
  villageId: string;
  kind: BuildingKind;
  position: THREE.Vector3;
  group: THREE.Group;
  scaffoldMesh: THREE.Object3D;
  completedMesh: THREE.Object3D;
  fireMesh: THREE.Mesh;
  granaryRefs?: GranaryVisualRefs;
  templeOrbitRing?: THREE.Mesh;
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

  private readonly stoneMat = new THREE.MeshStandardMaterial({ color: 0x9b968d, roughness: 0.9, flatShading: true });
  private readonly wallMat = new THREE.MeshStandardMaterial({ color: 0xefe5d0, roughness: 0.82, flatShading: true });
  private readonly timberMat = new THREE.MeshStandardMaterial({ color: 0x5c3c24, roughness: 0.88, flatShading: true });
  private readonly windowMat = new THREE.MeshStandardMaterial({
    color: 0xffdf8e,
    emissive: 0xffaa33,
    emissiveIntensity: 0.7,
    roughness: 0.3,
  });
  private readonly roofGoodMat = new THREE.MeshStandardMaterial({ color: 0x356ea8, roughness: 0.72, flatShading: true });
  private readonly roofRivalMat = new THREE.MeshStandardMaterial({ color: 0xb34232, roughness: 0.72, flatShading: true });
  private readonly grainMat = new THREE.MeshStandardMaterial({
    color: 0xf4c84b,
    emissive: 0x5c3f05,
    emissiveIntensity: 0.25,
    roughness: 0.75,
    flatShading: true,
  });
  private readonly woodLogMat = new THREE.MeshStandardMaterial({ color: 0x8f5b30, roughness: 0.85, flatShading: true });
  private readonly scaffoldMat = new THREE.MeshStandardMaterial({ color: 0xa67c52, roughness: 0.9, flatShading: true });
  private readonly fireMat = new THREE.MeshBasicMaterial({ color: 0xff5511, transparent: true, opacity: 0.85 });

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

    // Scaffold visual (timber framing + stone foundation)
    const scaffoldMesh = new THREE.Group();
    const basePad = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.22, 3.4), this.stoneMat);
    basePad.position.y = 0.11;
    scaffoldMesh.add(basePad);

    const postGeom = new THREE.BoxGeometry(0.18, 2.5, 0.18);
    for (const [px, pz] of [
      [-1.4, -1.4],
      [1.4, -1.4],
      [-1.4, 1.4],
      [1.4, 1.4],
    ]) {
      const p = new THREE.Mesh(postGeom, this.scaffoldMat);
      p.position.set(px, 1.3, pz);
      scaffoldMesh.add(p);
    }
    const crossBeam = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.16, 0.16), this.scaffoldMat);
    crossBeam.position.set(0, 2.4, -1.4);
    const crossBeam2 = crossBeam.clone();
    crossBeam2.position.z = 1.4;
    scaffoldMesh.add(crossBeam, crossBeam2);

    // Completed building visual
    const completedMesh = new THREE.Group();
    const roofMat = options.villageId === 'player' ? this.roofGoodMat : this.roofRivalMat;
    let granaryRefs: GranaryVisualRefs | undefined;
    let templeOrbitRing: THREE.Mesh | undefined;

    if (options.kind === 'house') {
      this.buildHouseMesh(completedMesh, roofMat);
    } else if (options.kind === 'granary') {
      granaryRefs = this.buildGranaryMesh(completedMesh, roofMat);
    } else if (options.kind === 'wonder') {
      this.buildWonderMesh(completedMesh, roofMat);
    } else {
      templeOrbitRing = this.buildTempleMesh(completedMesh, roofMat);
    }

    const fireMesh = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3.4, 6), this.fireMat);
    fireMesh.position.y = 2.2;
    fireMesh.visible = false;

    group.add(scaffoldMesh, completedMesh, fireMesh);
    this.scene.add(group);

    const impressiveness =
      options.kind === 'wonder' ? 45 : options.kind === 'temple' ? 35 : options.kind === 'granary' ? 25 : 15;
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
      granaryRefs,
      templeOrbitRing,
      progress: options.built ? 1 : 0.12,
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

  private buildHouseMesh(target: THREE.Group, roofMat: THREE.Material): void {
    // Stone foundation plinth
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.45, 3.0), this.stoneMat);
    plinth.position.y = 0.22;
    plinth.receiveShadow = true;

    // Main plaster walls
    const walls = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2.0, 2.5), this.wallMat);
    walls.position.y = 1.45;
    walls.castShadow = true;
    walls.receiveShadow = true;

    // Corner timber beams
    const beamGeom = new THREE.BoxGeometry(0.22, 2.05, 0.22);
    for (const [bx, bz] of [
      [-1.35, -1.2],
      [1.35, -1.2],
      [-1.35, 1.2],
      [1.35, 1.2],
    ]) {
      const beam = new THREE.Mesh(beamGeom, this.timberMat);
      beam.position.set(bx, 1.45, bz);
      target.add(beam);
    }

    // Horizontal timber lintel
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.92, 0.18, 2.62), this.timberMat);
    lintel.position.y = 2.42;

    // Pitched gabled roof (prism via 3-sided cylinder)
    const roofGeom = new THREE.CylinderGeometry(1.75, 1.75, 3.35, 3);
    roofGeom.rotateZ(Math.PI / 2);
    const roof = new THREE.Mesh(roofGeom, roofMat);
    roof.position.y = 3.22;
    roof.scale.set(1, 0.9, 1.05);
    roof.castShadow = true;

    // Wooden door
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.15, 0.12), this.timberMat);
    door.position.set(0, 1.02, 1.26);

    // Warm glowing windows on front & sides
    const winGeom = new THREE.BoxGeometry(0.44, 0.48, 0.1);
    const winL = new THREE.Mesh(winGeom, this.windowMat);
    winL.position.set(-0.78, 1.65, 1.26);
    const winR = winL.clone();
    winR.position.x = 0.78;

    // Stone chimney
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.6, 0.45), this.stoneMat);
    chimney.position.set(0.85, 3.55, -0.55);
    chimney.castShadow = true;

    target.add(plinth, walls, lintel, roof, door, winL, winR, chimney);
  }

  /**
   * Iconic Black & White Village Storehouse / Granary:
   * Dual open stone bins (left: golden grain pile, right: stacked timber logs)
   * with a timber archway and glowing drop zone ring.
   */
  private buildGranaryMesh(target: THREE.Group, roofMat: THREE.Material): GranaryVisualRefs {
    // Broad stone courtyard base
    const base = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 0.55, 10), this.stoneMat);
    base.position.y = 0.27;
    base.receiveShadow = true;

    // Back canopy shelter
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.2, 0.5), this.wallMat);
    backWall.position.set(0, 1.6, -2.5);
    backWall.castShadow = true;
    const canopyRoof = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.35, 2.4), roofMat);
    canopyRoof.position.set(0, 2.95, -1.8);
    canopyRoof.rotation.x = 0.22;
    canopyRoof.castShadow = true;

    // Timber posts supporting canopy
    const postGeom = new THREE.CylinderGeometry(0.18, 0.2, 2.5, 6);
    for (const px of [-2.6, 0, 2.6]) {
      const post = new THREE.Mesh(postGeom, this.timberMat);
      post.position.set(px, 1.7, -0.9);
      target.add(post);
    }

    // Left bin: Food / Grain Pit (stone rim + rising golden grain mound)
    const foodRim = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.24, 6, 12), this.stoneMat);
    foodRim.rotation.x = Math.PI / 2;
    foodRim.position.set(-1.75, 0.72, 0.75);

    const grainMound = new THREE.Mesh(new THREE.ConeGeometry(1.42, 2.1, 10), this.grainMat);
    grainMound.position.set(-1.75, 0.6, 0.75);
    grainMound.castShadow = true;

    // Right bin: Wood / Timber Pit (stone rim + rising stacked logs)
    const woodRim = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.24, 6, 12), this.stoneMat);
    woodRim.rotation.x = Math.PI / 2;
    woodRim.position.set(1.75, 0.72, 0.75);

    const woodStack = new THREE.Group();
    woodStack.position.set(1.75, 0.65, 0.75);
    const logGeom = new THREE.CylinderGeometry(0.22, 0.22, 2.1, 6);
    logGeom.rotateZ(Math.PI / 2);
    const logOffsets: [number, number, number][] = [
      [0, 0.2, -0.5],
      [0, 0.2, 0],
      [0, 0.2, 0.5],
      [0, 0.62, -0.25],
      [0, 0.62, 0.25],
      [0, 1.04, 0],
    ];
    for (const [lx, ly, lz] of logOffsets) {
      const log = new THREE.Mesh(logGeom, this.woodLogMat);
      log.position.set(lx, ly, lz);
      log.castShadow = true;
      woodStack.add(log);
    }

    // Subtle glowing drop-zone indicator ring around the Granary
    const dropRing = new THREE.Mesh(
      new THREE.RingGeometry(4.6, 5.1, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffd970,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      })
    );
    dropRing.rotation.x = -Math.PI / 2;
    dropRing.position.y = 0.16;

    target.add(base, backWall, canopyRoof, foodRim, grainMound, woodRim, woodStack, dropRing);
    return { grainMound, woodStack, dropRing };
  }

  private buildTempleMesh(target: THREE.Group, roofMat: THREE.Material): THREE.Mesh {
    // Stepped dais
    const step1 = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.2, 0.7, 10), this.stoneMat);
    step1.position.y = 0.35;
    step1.receiveShadow = true;
    const step2 = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 4.2, 0.65, 10), this.stoneMat);
    step2.position.y = 1.0;

    // Inner sanctuary hall
    const hall = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.5, 3.2, 10), this.wallMat);
    hall.position.y = 2.9;
    hall.castShadow = true;

    // 6 perimeter classical columns
    const colGeom = new THREE.CylinderGeometry(0.24, 0.28, 3.3, 8);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const col = new THREE.Mesh(colGeom, this.wallMat);
      col.position.set(Math.cos(a) * 3.25, 2.95, Math.sin(a) * 3.25);
      col.castShadow = true;
      target.add(col);
    }

    // Upper cornice + dome + tall spire
    const cornice = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.5, 0.45, 10), this.stoneMat);
    cornice.position.y = 4.75;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2.5, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), roofMat);
    dome.position.y = 4.95;
    dome.castShadow = true;
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.75, 4.2, 8), roofMat);
    spire.position.y = 8.4;
    spire.castShadow = true;

    // Orbiting divine ring around spire
    const orbitRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.85, 0.1, 8, 28),
      new THREE.MeshBasicMaterial({ color: 0xffe488, transparent: true, opacity: 0.75 })
    );
    orbitRing.position.y = 7.4;
    orbitRing.rotation.x = Math.PI / 3;

    target.add(step1, step2, hall, cornice, dome, spire, orbitRing);
    return orbitRing;
  }

  private buildWonderMesh(target: THREE.Group, roofMat: THREE.Material): void {
    const base1 = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.8, 5.2), this.stoneMat);
    base1.position.y = 0.4;
    const base2 = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.8, 3.8), this.stoneMat);
    base2.position.y = 1.2;

    const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 1.35, 7.2, 4), roofMat);
    obelisk.position.y = 5.2;
    obelisk.rotation.y = Math.PI / 4;
    obelisk.castShadow = true;

    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.85, 0), this.windowMat);
    crystal.position.y = 9.4;

    const miniGeom = new THREE.ConeGeometry(0.45, 2.2, 4);
    for (const [ox, oz] of [
      [-1.9, -1.9],
      [1.9, -1.9],
      [-1.9, 1.9],
      [1.9, 1.9],
    ]) {
      const mini = new THREE.Mesh(miniGeom, this.wallMat);
      mini.position.set(ox, 2.0, oz);
      target.add(mini);
    }

    target.add(base1, base2, obelisk, crystal);
  }

  findGranary(villageId: string): Building | undefined {
    return this.buildings.find((b) => b.villageId === villageId && b.kind === 'granary' && !b.destroyed);
  }

  syncGranaryStock(villageId: string, foodRatio: number, woodRatio: number): void {
    const granary = this.findGranary(villageId);
    if (!granary?.granaryRefs) return;
    const f = THREE.MathUtils.clamp(foodRatio, 0.08, 1.35);
    const w = THREE.MathUtils.clamp(woodRatio, 0.08, 1.35);
    granary.granaryRefs.grainMound.scale.set(0.7 + f * 0.4, f, 0.7 + f * 0.4);
    granary.granaryRefs.grainMound.position.y = 0.55 + f * 0.52;
    granary.granaryRefs.woodStack.scale.set(0.8 + w * 0.25, w, 0.8 + w * 0.25);
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
      if (b.templeOrbitRing && !b.destroyed) {
        b.templeOrbitRing.rotation.z = elapsed * 0.9;
        b.templeOrbitRing.rotation.y = elapsed * 0.5;
      }
      if (b.granaryRefs && !b.destroyed) {
        (b.granaryRefs.dropRing.material as THREE.MeshBasicMaterial).opacity =
          0.32 + Math.sin(elapsed * 2.5) * 0.14;
      }
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
