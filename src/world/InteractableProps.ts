import * as THREE from 'three';
import { PhysicsProp, PhysicsWorld } from '../physics/PhysicsWorld';
import { IslandTerrain, PLAYER_VILLAGE_POS, RIVAL_VILLAGE_POS } from './IslandTerrain';

export class InteractableProps {
  private readonly trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9, flatShading: true });
  private readonly foliageMat = new THREE.MeshStandardMaterial({ color: 0x2f7d32, roughness: 0.85, flatShading: true });
  private readonly rockMat = new THREE.MeshStandardMaterial({ color: 0x7c7a76, roughness: 0.92, flatShading: true });
  private readonly woodMat = new THREE.MeshStandardMaterial({ color: 0x996538, roughness: 0.85, flatShading: true });
  private readonly foodMat = new THREE.MeshStandardMaterial({
    color: 0xf4c542,
    emissive: 0x553900,
    roughness: 0.6,
    flatShading: true,
  });

  constructor(
    private readonly terrain: IslandTerrain,
    private readonly physics: PhysicsWorld
  ) {}

  populateIsland(): void {
    // Spawn scenic forests around the valleys & hillsides
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let i = 0; i < 65; i++) {
      const x = (rand() - 0.5) * 125;
      const z = (rand() - 0.5) * 110;
      const y = this.terrain.getHeightAt(x, z);
      if (y < 1.8 || y > 13) continue;
      if (Math.hypot(x - PLAYER_VILLAGE_POS.x, z - PLAYER_VILLAGE_POS.z) < 13) continue;
      if (Math.hypot(x - RIVAL_VILLAGE_POS.x, z - RIVAL_VILLAGE_POS.z) < 13) continue;
      this.spawnTree(new THREE.Vector3(x, y + 1.2, z), 0.85 + rand() * 0.5);
    }

    // Spawn grabbable boulders near villages and central ridge
    for (let i = 0; i < 24; i++) {
      const x = (rand() - 0.5) * 100;
      const z = (rand() - 0.5) * 90;
      const y = this.terrain.getHeightAt(x, z);
      if (y < 1.5 || y > 15) continue;
      this.spawnRock(new THREE.Vector3(x, y + 0.9, z), 0.7 + rand() * 0.7);
    }

    // Starter wood & food piles near player village (kept clear of Granary auto-deposit zone)
    for (let i = 0; i < 4; i++) {
      const angle = 2.0 + (i / 4) * 2.2;
      const x = PLAYER_VILLAGE_POS.x + Math.cos(angle) * 12.5;
      const z = PLAYER_VILLAGE_POS.z + Math.sin(angle) * 12.5;
      const y = this.terrain.getHeightAt(x, z);
      this.spawnWood(new THREE.Vector3(x, y + 0.7, z));
    }
    for (let i = 0; i < 3; i++) {
      const angle = 2.4 + (i / 3) * 1.8;
      const x = PLAYER_VILLAGE_POS.x + Math.cos(angle) * 10.5;
      const z = PLAYER_VILLAGE_POS.z + Math.sin(angle) * 10.5;
      const y = this.terrain.getHeightAt(x, z);
      this.spawnFood(new THREE.Vector3(x, y + 0.7, z));
    }
  }

  spawnTree(position: THREE.Vector3, scale = 1): PhysicsProp {
    const group = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * scale, 0.36 * scale, 2.2 * scale, 6), this.trunkMat);
    trunk.position.y = 0;
    trunk.castShadow = true;
    group.add(trunk);

    const crown1 = new THREE.Mesh(new THREE.ConeGeometry(1.4 * scale, 2.5 * scale, 7), this.foliageMat);
    crown1.position.y = 1.9 * scale;
    crown1.castShadow = true;
    group.add(crown1);

    const crown2 = new THREE.Mesh(new THREE.ConeGeometry(1.0 * scale, 2.0 * scale, 7), this.foliageMat);
    crown2.position.y = 3.1 * scale;
    crown2.castShadow = true;
    group.add(crown2);

    return this.physics.registerProp({
      kind: 'tree',
      mesh: group,
      position,
      radius: 1.1 * scale,
      mass: 2.2 * scale,
      fixed: true, // Uproots dynamically when grabbed!
    });
  }

  spawnRock(position: THREE.Vector3, radius = 0.9): PhysicsProp {
    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(radius, 0), this.rockMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return this.physics.registerProp({
      kind: 'rock',
      mesh,
      position,
      radius,
      mass: 4.5 * radius,
    });
  }

  spawnWood(position: THREE.Vector3): PhysicsProp {
    const group = new THREE.Group();
    const logGeom = new THREE.CylinderGeometry(0.18, 0.18, 1.4, 6);
    logGeom.rotateZ(Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(logGeom, this.woodMat);
      m.position.set(0, i === 2 ? 0.28 : 0, i === 2 ? 0 : (i - 0.5) * 0.36);
      m.castShadow = true;
      group.add(m);
    }
    return this.physics.registerProp({
      kind: 'wood',
      mesh: group,
      position,
      radius: 0.75,
      mass: 1.4,
    });
  }

  spawnFood(position: THREE.Vector3): PhysicsProp {
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.65, 1), this.foodMat);
    mesh.scale.set(1.1, 0.85, 1.1);
    mesh.castShadow = true;
    return this.physics.registerProp({
      kind: 'food',
      mesh,
      position,
      radius: 0.7,
      mass: 1.0,
    });
  }

  spawnVillagerProp(position: THREE.Vector3, tunicHex = 0x3a82d6): PhysicsProp {
    const group = new THREE.Group();
    const tunicMat = new THREE.MeshStandardMaterial({ color: tunicHex, roughness: 0.8, flatShading: true });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xf1c7a4, roughness: 0.8, flatShading: true });
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.05, 6), tunicMat);
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), headMat);
    head.position.y = 0.65;
    // Raised waving arms
    const armGeom = new THREE.CylinderGeometry(0.06, 0.06, 0.55, 5);
    const armL = new THREE.Mesh(armGeom, tunicMat);
    armL.position.set(-0.32, 0.35, 0);
    armL.rotation.z = 0.75;
    const armR = armL.clone();
    armR.position.x = 0.32;
    armR.rotation.z = -0.75;
    group.add(body, head, armL, armR);

    return this.physics.registerProp({
      kind: 'villager',
      mesh: group,
      position,
      radius: 0.65,
      mass: 0.9,
      maxAge: 14,
    });
  }
}
