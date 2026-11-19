import * as THREE from 'three';
import { MiracleType } from '../core/EventBus';
import { PhysicsProp, PhysicsWorld } from '../physics/PhysicsWorld';
import { Village } from '../villages/Village';
import { IslandTerrain, PLAYER_VILLAGE_POS } from '../world/IslandTerrain';
import { GestureRecognizer } from './GestureRecognizer';

export interface DesktopCallbacks {
  onCastMiracle: (type: MiracleType, targetPos: THREE.Vector3) => void;
  onPetCreature: () => void;
  onSlapCreature: () => void;
  onToggleTotem: () => void;
}

/**
 * Mouse + Keyboard God-Hand simulator for desktop testing & verification
 * when not inside an Android XR headset.
 */
export class DesktopSimulator {
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly keys = new Set<string>();

  private yaw = 0.25;
  private pitch = -0.58;
  private distance = 34;
  private focus = new THREE.Vector3(PLAYER_VILLAGE_POS.x + 2, 5, PLAYER_VILLAGE_POS.z);

  private orbiting = false;
  private lastMouse = new THREE.Vector2();
  private grabbedProp: PhysicsProp | null = null;
  private lastGrabWorld = new THREE.Vector3();
  private throwVelocity = new THREE.Vector3();
  private drawingGesture = false;

  public readonly cursorWorldPos = new THREE.Vector3(PLAYER_VILLAGE_POS.x, 5, PLAYER_VILLAGE_POS.z);

  constructor(
    private readonly domElement: HTMLElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly terrain: IslandTerrain,
    private readonly physics: PhysicsWorld,
    private readonly gestureRecognizer: GestureRecognizer,
    private readonly playerVillage: Village,
    private readonly callbacks: DesktopCallbacks
  ) {
    this.bindEvents();
    this.updateCamera();
  }

  private bindEvents(): void {
    this.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    this.domElement.addEventListener('pointerdown', (e) => {
      this.updatePointer(e);
      this.lastMouse.set(e.clientX, e.clientY);

      if (e.button === 2) {
        this.orbiting = true;
        return;
      }

      if (this.keys.has('KeyG')) {
        this.drawingGesture = true;
        const hit = this.raycastTerrain();
        this.gestureRecognizer.beginStroke(hit.clone().add(new THREE.Vector3(0, 4, 0)));
        return;
      }

      // Check if clicking near a grabbable physics prop
      const hit = this.raycastTerrain();
      const nearest = this.physics.findNearestGrabbable(hit, 3.6);
      if (nearest) {
        this.grabbedProp = nearest;
        this.physics.grabProp(nearest, 'desktop');
        this.lastGrabWorld.copy(hit).add(new THREE.Vector3(0, 3.5, 0));
        this.throwVelocity.set(0, 0, 0);
      }
    });

    window.addEventListener('pointermove', (e) => {
      this.updatePointer(e);
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.lastMouse.set(e.clientX, e.clientY);

      if (this.orbiting) {
        this.yaw -= dx * 0.006;
        this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.005, -1.35, -0.18);
        return;
      }

      const hit = this.raycastTerrain();
      this.cursorWorldPos.copy(hit);

      if (this.drawingGesture) {
        this.gestureRecognizer.addPoint(hit.clone().add(new THREE.Vector3(0, 4, 0)));
      } else if (this.grabbedProp) {
        const lifted = hit.clone().add(new THREE.Vector3(0, 4.2, 0));
        this.throwVelocity.copy(lifted).sub(this.lastGrabWorld).multiplyScalar(18);
        this.lastGrabWorld.copy(lifted);
        this.physics.moveGrabbedProp(this.grabbedProp, lifted);
      }
    });

    window.addEventListener('pointerup', () => {
      this.orbiting = false;
      if (this.drawingGesture) {
        this.drawingGesture = false;
        const match = this.gestureRecognizer.endStroke(this.camera);
        if (match) {
          this.callbacks.onCastMiracle(match.type, this.cursorWorldPos.clone());
        }
      }
      if (this.grabbedProp) {
        this.physics.releaseProp(this.grabbedProp, this.throwVelocity);
        this.grabbedProp = null;
      }
    });

    this.domElement.addEventListener(
      'wheel',
      (e) => {
        this.distance = THREE.MathUtils.clamp(this.distance + e.deltaY * 0.03, 10, 95);
      },
      { passive: true }
    );

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Digit1') this.callbacks.onCastMiracle('food', this.cursorWorldPos.clone());
      if (e.code === 'Digit2') this.callbacks.onCastMiracle('wood', this.cursorWorldPos.clone());
      if (e.code === 'Digit3') this.callbacks.onCastMiracle('rain', this.cursorWorldPos.clone());
      if (e.code === 'Digit4') this.callbacks.onCastMiracle('fireball', this.cursorWorldPos.clone());
      if (e.code === 'Digit5') this.callbacks.onCastMiracle('lightning', this.cursorWorldPos.clone());
      if (e.code === 'KeyP') this.callbacks.onPetCreature();
      if (e.code === 'KeyX') this.callbacks.onSlapCreature();
      if (e.code === 'KeyT') this.callbacks.onToggleTotem();
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
  }

  private updatePointer(e: PointerEvent): void {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private raycastTerrain(): THREE.Vector3 {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.terrain.mesh, false);
    if (hits.length > 0) return hits[0].point;
    // Intersect y = 4 plane fallback
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -4);
    const out = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(plane, out);
    return out;
  }

  update(dt: number, inVR: boolean): void {
    if (inVR) return;
    const speed = 26 * dt;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.focus.addScaledVector(forward, speed);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.focus.addScaledVector(forward, -speed);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.focus.addScaledVector(right, speed);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.focus.addScaledVector(right, -speed);

    this.focus.x = THREE.MathUtils.clamp(this.focus.x, -75, 75);
    this.focus.z = THREE.MathUtils.clamp(this.focus.z, -75, 75);
    this.focus.y = Math.max(2, this.terrain.getHeightAt(this.focus.x, this.focus.z) + 1.5);
    this.updateCamera();
  }

  private updateCamera(): void {
    const horiz = Math.cos(this.pitch) * this.distance;
    const vert = -Math.sin(this.pitch) * this.distance;
    this.camera.position.set(
      this.focus.x + Math.sin(this.yaw) * horiz,
      this.focus.y + vert,
      this.focus.z + Math.cos(this.yaw) * horiz
    );
    this.camera.lookAt(this.focus);
  }
}
