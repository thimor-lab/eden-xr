import * as THREE from 'three';
import { AlignmentPalette } from '../core/AlignmentSystem';
import { IslandTerrain } from '../world/IslandTerrain';

export type HoverIntent = 'none' | 'prop' | 'special' | 'blocked';

interface BurstParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  ttl: number;
  maxTtl: number;
}

/**
 * Pure helper: computes a ballistic trajectory curve under gravity until it hits terrain.
 */
export function computeTrajectoryPoints(
  start: THREE.Vector3,
  velocity: THREE.Vector3,
  gravity: number,
  getGroundY: (x: number, z: number) => number,
  steps = 22,
  stepDt = 0.08
): { points: THREE.Vector3[]; landing: THREE.Vector3 | null } {
  const points: THREE.Vector3[] = [start.clone()];
  const pos = start.clone();
  const vel = velocity.clone();
  let landing: THREE.Vector3 | null = null;

  for (let i = 1; i <= steps; i++) {
    vel.y += gravity * stepDt;
    pos.addScaledVector(vel, stepDt);
    const groundY = getGroundY(pos.x, pos.z);
    if (pos.y <= groundY + 0.15) {
      pos.y = groundY + 0.15;
      points.push(pos.clone());
      landing = pos.clone();
      break;
    }
    points.push(pos.clone());
  }

  return { points, landing };
}

/**
 * Diegetic visual feedback for hand/cursor interactions:
 * - Color-coded hover ring around grabbable targets
 * - Subtle VR aiming ray when telekinetically targeting from god-height
 * - Dotted ballistic throw preview arc + landing reticle
 * - 3D floating Desktop God-Hand cursor
 * - Leaf & earth particle bursts when uprooting trees or grabbing
 */
export class InteractionFeedback {
  private readonly hoverRings: Record<'left' | 'right' | 'desktop', THREE.Mesh>;
  private readonly aimRays: Record<'left' | 'right', THREE.Line>;
  private readonly arcLine: THREE.Line;
  private readonly landingReticle: THREE.Mesh;
  private readonly desktopCursor: THREE.Group;
  private readonly desktopCursorMat: THREE.MeshStandardMaterial;
  private readonly particles: BurstParticle[] = [];

  private readonly leafGeom = new THREE.TetrahedronGeometry(0.28, 0);
  private readonly leafMat = new THREE.MeshStandardMaterial({ color: 0x3b9940, roughness: 0.8, flatShading: true });
  private readonly dirtMat = new THREE.MeshStandardMaterial({ color: 0x6e4f35, roughness: 0.95, flatShading: true });

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: IslandTerrain
  ) {
    const makeRing = () => {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1.22, 28),
        new THREE.MeshBasicMaterial({
          color: 0xffd970,
          transparent: true,
          opacity: 0.82,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 8;
      this.scene.add(mesh);
      return mesh;
    };

    this.hoverRings = {
      left: makeRing(),
      right: makeRing(),
      desktop: makeRing(),
    };

    const makeRay = () => {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]),
        new THREE.LineBasicMaterial({ color: 0xffe49e, transparent: true, opacity: 0.32 })
      );
      line.frustumCulled = false;
      line.visible = false;
      this.scene.add(line);
      return line;
    };

    this.aimRays = {
      left: makeRay(),
      right: makeRay(),
    };

    // Ballistic throw arc + landing target
    this.arcLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffdf7a, transparent: true, opacity: 0.75 })
    );
    this.arcLine.frustumCulled = false;
    this.arcLine.visible = false;

    this.landingReticle = new THREE.Mesh(
      new THREE.RingGeometry(0.75, 1.35, 24),
      new THREE.MeshBasicMaterial({
        color: 0xff9b42,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.landingReticle.rotation.x = -Math.PI / 2;
    this.landingReticle.visible = false;
    this.landingReticle.renderOrder = 9;
    this.scene.add(this.arcLine, this.landingReticle);

    // 3D Floating Desktop God-Hand Cursor
    this.desktopCursor = new THREE.Group();
    this.desktopCursorMat = new THREE.MeshStandardMaterial({
      color: 0xffe6a3,
      emissive: 0xffb833,
      emissiveIntensity: 0.65,
      roughness: 0.25,
      flatShading: true,
    });
    const pointerCone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.25, 6), this.desktopCursorMat);
    pointerCone.rotation.x = Math.PI;
    pointerCone.position.y = 1.4;
    const crownRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.08, 6, 18),
      this.desktopCursorMat
    );
    crownRing.rotation.x = Math.PI / 2;
    crownRing.position.y = 2.05;
    this.desktopCursor.add(pointerCone, crownRing);
    this.scene.add(this.desktopCursor);
  }

  setHover(
    channel: 'left' | 'right' | 'desktop',
    worldPos: THREE.Vector3 | null,
    radius: number,
    intent: HoverIntent,
    elapsed: number
  ): void {
    const ring = this.hoverRings[channel];
    if (!worldPos || intent === 'none') {
      ring.visible = false;
      return;
    }

    const groundY = this.terrain.getHeightAt(worldPos.x, worldPos.z);
    ring.position.set(worldPos.x, Math.max(groundY + 0.25, worldPos.y - radius * 0.5), worldPos.z);
    const pulse = 1 + Math.sin(elapsed * 7) * 0.08;
    const scale = Math.max(1.1, radius * 1.25) * pulse;
    ring.scale.setScalar(scale);

    const mat = ring.material as THREE.MeshBasicMaterial;
    if (intent === 'special') {
      mat.color.setHex(0x66e8ff);
    } else if (intent === 'blocked') {
      mat.color.setHex(0xff3e2e);
    } else {
      mat.color.setHex(0xffdf70);
    }
    ring.visible = true;
  }

  setAimRay(side: 'left' | 'right', start: THREE.Vector3 | null, end: THREE.Vector3 | null, color?: THREE.Color): void {
    const ray = this.aimRays[side];
    if (!start || !end) {
      ray.visible = false;
      return;
    }
    ray.geometry.dispose();
    ray.geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    if (color) {
      (ray.material as THREE.LineBasicMaterial).color.copy(color);
    }
    ray.visible = true;
  }

  setThrowArc(start: THREE.Vector3 | null, velocity: THREE.Vector3 | null): void {
    if (!start || !velocity || velocity.length() < 4.5) {
      this.arcLine.visible = false;
      this.landingReticle.visible = false;
      return;
    }

    const { points, landing } = computeTrajectoryPoints(
      start,
      velocity,
      -14.5,
      (x, z) => this.terrain.getHeightAt(x, z)
    );

    this.arcLine.geometry.dispose();
    this.arcLine.geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.arcLine.visible = true;

    if (landing) {
      this.landingReticle.position.set(landing.x, landing.y + 0.15, landing.z);
      this.landingReticle.visible = true;
    } else {
      this.landingReticle.visible = false;
    }
  }

  updateDesktopCursor(worldPos: THREE.Vector3, visible: boolean, elapsed: number, palette: AlignmentPalette): void {
    this.desktopCursor.visible = visible;
    if (!visible) return;
    const groundY = this.terrain.getHeightAt(worldPos.x, worldPos.z);
    this.desktopCursor.position.set(worldPos.x, groundY + Math.sin(elapsed * 4.5) * 0.2, worldPos.z);
    this.desktopCursor.rotation.y = elapsed * 1.4;
    this.desktopCursorMat.color.copy(palette.handPrimary);
    this.desktopCursorMat.emissive.copy(palette.handEmissive);
  }

  spawnUprootBurst(position: THREE.Vector3): void {
    for (let i = 0; i < 14; i++) {
      const isLeaf = i < 9;
      const mesh = new THREE.Mesh(this.leafGeom, isLeaf ? this.leafMat : this.dirtMat);
      mesh.position.copy(position).add(new THREE.Vector3(0, isLeaf ? 1.8 : 0.3, 0));
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.5 + Math.random() * 4.5;
      const vel = new THREE.Vector3(
        Math.cos(angle) * speed,
        3.5 + Math.random() * 4.5,
        Math.sin(angle) * speed
      );
      this.scene.add(mesh);
      this.particles.push({ mesh, vel, ttl: 0.9 + Math.random() * 0.4, maxTtl: 1.3 });
    }
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.ttl -= dt;
      p.vel.y -= 13.5 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 5;
      p.mesh.rotation.y += dt * 4;
      const s = Math.max(0.01, p.ttl / p.maxTtl);
      p.mesh.scale.setScalar(s);
      if (p.ttl <= 0) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
      }
    }
  }
}
