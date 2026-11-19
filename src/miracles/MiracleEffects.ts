import * as THREE from 'three';
import { AlignmentSystem } from '../core/AlignmentSystem';
import { EventBus, MiracleType } from '../core/EventBus';
import { GameState } from '../core/GameState';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { BuildingSystem } from '../villages/BuildingSystem';
import { Village } from '../villages/Village';
import { InteractableProps } from '../world/InteractableProps';
import { IslandTerrain } from '../world/IslandTerrain';

interface ActiveRainCloud {
  group: THREE.Group;
  position: THREE.Vector3;
  ttl: number;
  extinguishTimer: number;
}

interface ActiveLightning {
  line: THREE.Line;
  light: THREE.PointLight;
  ttl: number;
}

interface ActiveBurst {
  mesh: THREE.Mesh;
  ttl: number;
  maxTtl: number;
}

export class MiracleEffects {
  private readonly rainClouds: ActiveRainCloud[] = [];
  private readonly bolts: ActiveLightning[] = [];
  private readonly bursts: ActiveBurst[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: IslandTerrain,
    private readonly physics: PhysicsWorld,
    private readonly props: InteractableProps,
    private readonly buildings: BuildingSystem,
    private readonly alignment: AlignmentSystem,
    private readonly gameState: GameState,
    private readonly bus: EventBus
  ) {}

  execute(
    type: MiracleType,
    targetPos: THREE.Vector3,
    launchVelocity: THREE.Vector3 | null,
    playerVillage: Village,
    rivalVillage: Village
  ): void {
    const groundY = this.terrain.getHeightAt(targetPos.x, targetPos.z);
    const groundPos = new THREE.Vector3(targetPos.x, groundY, targetPos.z);

    if (type === 'food') {
      for (let i = 0; i < 3; i++) {
        const offset = new THREE.Vector3((i - 1) * 1.4, 2.6 + i * 0.4, ((i % 2) - 0.5) * 1.2);
        this.props.spawnFood(groundPos.clone().add(offset));
      }
      this.spawnBurst(groundPos, 0xffd966, 3.5);
      this.alignment.shift(0.08, 'Food Miracle');
      this.gameState.addBelief(12);
      playerVillage.villagers.triggerCheer(groundPos, 18);
      if (groundPos.distanceTo(rivalVillage.center) < 22) {
        rivalVillage.villagers.triggerCheer(groundPos, 20);
        this.gameState.advanceRivalConversion(14, 'peaceful');
      }
    } else if (type === 'wood') {
      for (let i = 0; i < 2; i++) {
        const offset = new THREE.Vector3((i - 0.5) * 1.6, 2.5, (i - 0.5) * 1.0);
        this.props.spawnWood(groundPos.clone().add(offset));
      }
      // Also directly progress any nearby scaffold!
      for (const b of this.buildings.buildings) {
        if (b.progress < 1 && !b.destroyed && b.position.distanceTo(groundPos) < 10) {
          this.buildings.deliverWood(b, 1);
        }
      }
      this.spawnBurst(groundPos, 0xd49b54, 3.0);
      this.alignment.shift(0.06, 'Wood Miracle');
      this.gameState.addBelief(10);
    } else if (type === 'rain') {
      this.spawnRainCloud(groundPos);
      const extinguished = this.buildings.extinguishNear(groundPos, 14);
      if (groundY > 1.5 && groundY < 13) {
        this.props.spawnTree(new THREE.Vector3(groundPos.x + 1.5, groundY + 1.2, groundPos.z - 1.2), 0.9);
      }
      this.alignment.shift(0.1 + extinguished * 0.05, 'Rain Miracle');
      this.gameState.addBelief(15);
      playerVillage.villagers.triggerCheer(groundPos, 18);
      if (groundPos.distanceTo(rivalVillage.center) < 22) {
        this.gameState.advanceRivalConversion(12, 'peaceful');
      }
    } else if (type === 'fireball') {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xff5500,
        emissive: 0xff3300,
        emissiveIntensity: 2.0,
        roughness: 0.3,
      });
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1), mat);
      const spawnPos = targetPos.clone();
      if (!launchVelocity) {
        spawnPos.y = Math.max(groundY + 16, targetPos.y + 8);
      }
      const prop = this.physics.registerProp({
        kind: 'fireball',
        mesh,
        position: spawnPos,
        radius: 0.85,
        mass: 2.0,
        maxAge: 10,
      });
      const vel = launchVelocity ? launchVelocity.clone() : new THREE.Vector3(0, -18, 0);
      prop.body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
      this.alignment.shift(-0.14, 'Fireball Miracle');
    } else if (type === 'lightning') {
      this.spawnLightningBolt(groundPos);
      this.spawnBurst(groundPos, 0x99ddff, 5.5);
      const hits = this.buildings.damageInRadius(groundPos, 10, 48, true);
      playerVillage.villagers.triggerPanic(groundPos, 18);
      rivalVillage.villagers.triggerPanic(groundPos, 20);
      this.alignment.shift(-0.18, 'Lightning Miracle');
      if (hits.some((b) => b.villageId === 'rival') || groundPos.distanceTo(rivalVillage.center) < 22) {
        this.gameState.advanceRivalConversion(22, 'conquest');
      }
    }

    this.bus.emit('miracle:cast', { type, position: groundPos });
  }

  handleImpact(kind: string, position: THREE.Vector3, impulse: number, playerVillage: Village, rivalVillage: Village): void {
    if (kind === 'fireball') {
      this.spawnBurst(position, 0xff5511, 6.5);
      const hits = this.buildings.damageInRadius(position, 9.5, 42, true);
      playerVillage.villagers.triggerPanic(position, 18);
      rivalVillage.villagers.triggerPanic(position, 20);
      if (hits.some((b) => b.villageId === 'rival')) {
        this.gameState.advanceRivalConversion(20, 'conquest');
      }
    } else if (kind === 'rock' && impulse > 11) {
      this.spawnBurst(position, 0xc8b89a, 3.2);
      const hits = this.buildings.damageInRadius(position, 6.5, Math.min(45, impulse * 1.4), false);
      if (hits.length > 0) {
        this.alignment.shift(-0.1, 'Boulder Destruction');
        playerVillage.villagers.triggerPanic(position, 14);
        rivalVillage.villagers.triggerPanic(position, 16);
        if (hits.some((b) => b.villageId === 'rival')) {
          this.gameState.advanceRivalConversion(15, 'conquest');
        }
      }
    } else if (kind === 'wood') {
      for (const b of this.buildings.buildings) {
        if (b.progress < 1 && !b.destroyed && b.position.distanceTo(position) < 6.5) {
          this.buildings.deliverWood(b, 1);
          this.alignment.shift(0.05, 'Delivered Wood');
          break;
        }
      }
    }
  }

  private spawnRainCloud(groundPos: THREE.Vector3): void {
    const group = new THREE.Group();
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0x6f8ca8, roughness: 0.9, flatShading: true });
    for (let i = 0; i < 4; i++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 1), cloudMat);
      puff.position.set((i - 1.5) * 1.8, (i % 2) * 0.6, ((i % 3) - 1) * 1.1);
      group.add(puff);
    }
    const dropMat = new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.7 });
    const dropGeom = new THREE.CylinderGeometry(0.05, 0.05, 1.4, 4);
    for (let i = 0; i < 16; i++) {
      const drop = new THREE.Mesh(dropGeom, dropMat);
      drop.position.set((Math.random() - 0.5) * 6, -2 - Math.random() * 7, (Math.random() - 0.5) * 6);
      group.add(drop);
    }
    const pos = groundPos.clone().add(new THREE.Vector3(0, 10, 0));
    group.position.copy(pos);
    this.scene.add(group);
    this.rainClouds.push({ group, position: pos, ttl: 8, extinguishTimer: 0 });
  }

  private spawnLightningBolt(groundPos: THREE.Vector3): void {
    const points: THREE.Vector3[] = [];
    const topY = groundPos.y + 38;
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const jitter = i === 0 || i === steps ? 0 : 2.6;
      points.push(
        new THREE.Vector3(
          groundPos.x + (Math.random() - 0.5) * jitter,
          THREE.MathUtils.lerp(topY, groundPos.y + 0.5, t),
          groundPos.z + (Math.random() - 0.5) * jitter
        )
      );
    }
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0xd8f3ff, linewidth: 2 });
    const line = new THREE.Line(geom, mat);
    const light = new THREE.PointLight(0x88ddff, 12, 35);
    light.position.set(groundPos.x, groundPos.y + 4, groundPos.z);
    this.scene.add(line, light);
    this.bolts.push({ line, light, ttl: 0.35 });
  }

  private spawnBurst(pos: THREE.Vector3, colorHex: number, maxScale: number): void {
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.75,
      wireframe: false,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), mat);
    mesh.position.copy(pos).add(new THREE.Vector3(0, 0.8, 0));
    mesh.userData.maxScale = maxScale;
    this.scene.add(mesh);
    this.bursts.push({ mesh, ttl: 0.65, maxTtl: 0.65 });
  }

  update(dt: number): void {
    for (let i = this.rainClouds.length - 1; i >= 0; i--) {
      const c = this.rainClouds[i];
      c.ttl -= dt;
      c.extinguishTimer += dt;
      c.group.position.x += dt * 0.4;
      if (c.extinguishTimer > 1.0) {
        c.extinguishTimer = 0;
        this.buildings.extinguishNear(c.group.position, 14);
      }
      if (c.ttl <= 0) {
        this.scene.remove(c.group);
        this.rainClouds.splice(i, 1);
      }
    }

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.ttl -= dt;
      b.light.intensity = Math.max(0, (b.ttl / 0.35) * 14);
      if (b.ttl <= 0) {
        this.scene.remove(b.line, b.light);
        this.bolts.splice(i, 1);
      }
    }

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.ttl -= dt;
      const p = 1 - Math.max(0, b.ttl / b.maxTtl);
      const maxS = (b.mesh.userData.maxScale as number) || 4;
      b.mesh.scale.setScalar(1 + p * maxS);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.75;
      if (b.ttl <= 0) {
        this.scene.remove(b.mesh);
        this.bursts.splice(i, 1);
      }
    }
  }
}
