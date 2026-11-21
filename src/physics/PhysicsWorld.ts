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

/**
 * Subtle Black & White "aftertouch" aim-assist: nudges a throw velocity slightly
 * toward an intended target (e.g. Rival building or Granary) if already aimed within a cone.
 */
export function applyAftertouch(
  origin: THREE.Vector3,
  velocity: THREE.Vector3,
  candidateTargets: THREE.Vector3[],
  assistStrength = 0.28
): THREE.Vector3 {
  const speed = velocity.length();
  if (speed < 6 || candidateTargets.length === 0) return velocity.clone();

  const horizDir = new THREE.Vector3(velocity.x, 0, velocity.z);
  if (horizDir.lengthSq() < 1) return velocity.clone();
  horizDir.normalize();

  let bestTarget: THREE.Vector3 | null = null;
  let bestDot = 0.84; // ~33 degree cone

  for (const t of candidateTargets) {
    const toTarget = new THREE.Vector3(t.x - origin.x, 0, t.z - origin.z);
    const dist = toTarget.length();
    if (dist < 4 || dist > 90) continue;
    toTarget.divideScalar(dist);
    const d = horizDir.dot(toTarget);
    if (d > bestDot) {
      bestDot = d;
      bestTarget = t;
    }
  }

  if (!bestTarget) return velocity.clone();

  const desiredHoriz = new THREE.Vector3(bestTarget.x - origin.x, 0, bestTarget.z - origin.z).normalize();
  const horizSpeed = Math.hypot(velocity.x, velocity.z);
  const blended = horizDir.lerp(desiredHoriz, assistStrength).normalize().multiplyScalar(horizSpeed);
  return new THREE.Vector3(blended.x, velocity.y, blended.z);
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

  findGrabbableAlongRay(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDist: number,
    conePadding = 2.4
  ): PhysicsProp | null {
    const dir = direction.clone().normalize();
    let best: PhysicsProp | null = null;
    let bestScore = Infinity;
    const toProp = new THREE.Vector3();

    for (const prop of this.props.values()) {
      if (prop.grabbedBy) continue;
      const t = prop.body.translation();
      toProp.set(t.x - origin.x, t.y - origin.y, t.z - origin.z);
      const along = toProp.dot(dir);
      if (along < 0.5 || along > maxDist) continue;
      const perpSq = toProp.lengthSq() - along * along;
      const hitRadius = prop.radius + conePadding;
      if (perpSq <= hitRadius * hitRadius) {
        const score = Math.sqrt(Math.max(0, perpSq)) + along * 0.04;
        if (score < bestScore) {
          bestScore = score;
          best = prop;
        }
      }
    }
    return best;
  }

  /** Grabs a prop; returns true if a rooted tree was just uprooted */
  grabProp(prop: PhysicsProp, handId: string): boolean {
    let justUprooted = false;
    if (!prop.uprooted) {
      // Uproot static tree into dynamic physics object!
      prop.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      prop.uprooted = true;
      justUprooted = true;
    }
    prop.grabbedBy = handId;
    prop.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    return justUprooted;
  }

  moveGrabbedProp(prop: PhysicsProp, targetWorldPos: THREE.Vector3, smoothFactor = 0.35): void {
    const cur = prop.body.translation();
    const nextX = THREE.MathUtils.lerp(cur.x, targetWorldPos.x, smoothFactor);
    const nextY = THREE.MathUtils.lerp(cur.y, targetWorldPos.y, smoothFactor);
    const nextZ = THREE.MathUtils.lerp(cur.z, targetWorldPos.z, smoothFactor);
    prop.body.setNextKinematicTranslation({ x: nextX, y: nextY, z: nextZ });
    prop.mesh.position.set(nextX, nextY, nextZ);
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
