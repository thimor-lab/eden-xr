import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import { IslandTerrain } from '../world/IslandTerrain';

export type PropKind = 'rock' | 'tree' | 'wood' | 'food' | 'fireball' | 'villager';

export interface PhysicsProp {
  id: string;
  kind: PropKind;
  mesh: THREE.Object3D;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  radius: number;
  grabbedBy: string | null;
  uprooted: boolean;
  onFire: boolean;
  lastSpeed: number;
  prevPos: THREE.Vector3;
  age: number;
  maxAge?: number;
}

export class PhysicsWorld {
  public world!: RAPIER.World;
  public readonly props = new Map<string, PhysicsProp>();
  private nextId = 1;
  private initialized = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: IslandTerrain,
    private readonly bus: EventBus
  ) {}

  async init(): Promise<void> {
    if (this.initialized) return;
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -14.5, z: 0 });

    // Terrain heightfield collider
    const heights = this.terrain.getRapierHeights();
    const scale = new RAPIER.Vector3(this.terrain.size, 1, this.terrain.size);
    const hfDesc = RAPIER.ColliderDesc.heightfield(
      this.terrain.segments,
      this.terrain.segments,
      heights,
      scale
    )
      .setFriction(0.85)
      .setRestitution(0.2);
    this.world.createCollider(hfDesc);

    this.initialized = true;
  }

  registerProp(options: {
    kind: PropKind;
    mesh: THREE.Object3D;
    position: THREE.Vector3;
    radius: number;
    mass: number;
    fixed?: boolean;
    maxAge?: number;
  }): PhysicsProp {
    const id = `${options.kind}_${this.nextId++}`;
    const bodyDesc = options.fixed
      ? RAPIER.RigidBodyDesc.fixed()
      : RAPIER.RigidBodyDesc.dynamic();
    bodyDesc.setTranslation(options.position.x, options.position.y, options.position.z);
    bodyDesc.setLinearDamping(0.25);
    bodyDesc.setAngularDamping(0.45);
    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.ball(options.radius)
      .setMass(options.mass)
      .setRestitution(options.kind === 'rock' ? 0.35 : 0.2)
      .setFriction(0.75);
    const collider = this.world.createCollider(colliderDesc, body);

    options.mesh.position.copy(options.position);
    this.scene.add(options.mesh);

    const prop: PhysicsProp = {
      id,
      kind: options.kind,
      mesh: options.mesh,
      body,
      collider,
      radius: options.radius,
      grabbedBy: null,
      uprooted: !options.fixed,
      onFire: options.kind === 'fireball',
      lastSpeed: 0,
      prevPos: options.position.clone(),
      age: 0,
      maxAge: options.maxAge,
    };
    this.props.set(id, prop);
    return prop;
  }

  removeProp(id: string): void {
    const prop = this.props.get(id);
    if (!prop) return;
    this.scene.remove(prop.mesh);
    if (this.world.bodies.contains(prop.body.handle)) {
      this.world.removeRigidBody(prop.body);
    }
    this.props.delete(id);
  }

  findNearestGrabbable(worldPos: THREE.Vector3, maxDist: number): PhysicsProp | null {
    let best: PhysicsProp | null = null;
    let bestDistSq = maxDist * maxDist;
    const p = new THREE.Vector3();
    for (const prop of this.props.values()) {
      if (prop.grabbedBy) continue;
      const t = prop.body.translation();
      p.set(t.x, t.y, t.z);
      const dSq = p.distanceToSquared(worldPos);
      const threshold = (maxDist + prop.radius) * (maxDist + prop.radius);
      if (dSq < threshold && dSq < bestDistSq + prop.radius * prop.radius) {
        bestDistSq = dSq;
        best = prop;
      }
    }
    return best;
  }

  grabProp(prop: PhysicsProp, handId: string): void {
    if (!prop.uprooted) {
      // Uproot static tree into dynamic physics object!
      prop.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      prop.uprooted = true;
    }
    prop.grabbedBy = handId;
    prop.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
  }

  moveGrabbedProp(prop: PhysicsProp, targetWorldPos: THREE.Vector3): void {
    prop.body.setNextKinematicTranslation({
      x: targetWorldPos.x,
      y: targetWorldPos.y,
      z: targetWorldPos.z,
    });
    prop.mesh.position.copy(targetWorldPos);
  }

  releaseProp(prop: PhysicsProp, throwVelocity: THREE.Vector3): void {
    prop.grabbedBy = null;
    prop.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    const clamped = throwVelocity.clone();
    const maxSpeed = 52;
    if (clamped.length() > maxSpeed) {
      clamped.setLength(maxSpeed);
    }
    prop.body.setLinvel({ x: clamped.x, y: clamped.y, z: clamped.z }, true);
    prop.body.setAngvel(
      {
        x: (Math.random() - 0.5) * 4,
        y: (Math.random() - 0.5) * 4,
        z: (Math.random() - 0.5) * 4,
      },
      true
    );

    const speed = clamped.length();
    if (speed > 4) {
      const t = prop.body.translation();
      this.bus.emit('object:thrown', {
        kind: prop.kind,
        position: new THREE.Vector3(t.x, t.y, t.z),
        speed,
      });
    }
  }

  step(dt: number): void {
    if (!this.initialized) return;
    this.world.timestep = Math.min(dt, 1 / 30);
    this.world.step();

    const toRemove: string[] = [];

    for (const prop of this.props.values()) {
      prop.age += dt;
      if (prop.maxAge && prop.age >= prop.maxAge) {
        toRemove.push(prop.id);
        continue;
      }

      const t = prop.body.translation();
      const r = prop.body.rotation();
      prop.mesh.position.set(t.x, t.y, t.z);
      if (prop.uprooted) {
        prop.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }

      const lv = prop.body.linvel();
      const speed = Math.hypot(lv.x, lv.y, lv.z);

      // Detect strong impact (sudden deceleration near ground)
      if (!prop.grabbedBy && prop.lastSpeed > 9 && speed < prop.lastSpeed * 0.55) {
        const groundY = this.terrain.getHeightAt(t.x, t.z);
        if (t.y - groundY < prop.radius + 2.5) {
          this.bus.emit('object:impact', {
            kind: prop.kind,
            position: new THREE.Vector3(t.x, t.y, t.z),
            impulse: prop.lastSpeed,
          });
          if (prop.kind === 'fireball') {
            toRemove.push(prop.id);
          }
        }
      }

      // Sink cleanup if thrown deep into the ocean
      if (t.y < -8) {
        toRemove.push(prop.id);
      }

      prop.lastSpeed = speed;
      prop.prevPos.set(t.x, t.y, t.z);
    }

    for (const id of toRemove) {
      this.removeProp(id);
    }
  }

  clearAll(): void {
    for (const id of Array.from(this.props.keys())) {
      this.removeProp(id);
    }
  }
}
