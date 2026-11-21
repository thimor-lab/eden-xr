import * as THREE from 'three';
import { MiracleType } from '../core/EventBus';
import { PhysicsProp, PhysicsWorld } from '../physics/PhysicsWorld';
import { Village } from '../villages/Village';
import { IslandTerrain, PLAYER_VILLAGE_POS, RIVAL_VILLAGE_POS } from '../world/IslandTerrain';
import { GestureRecognizer } from './GestureRecognizer';

export interface DesktopCallbacks {
  onCastMiracle: (type: MiracleType, targetPos: THREE.Vector3) => void;
  onPetCreature: () => void;
  onSlapCreature: () => void;
  onToggleTotem: () => void;
  onLeashCreature: (targetPos: THREE.Vector3) => void;
  onUnleashCreature: () => void;
  getCreaturePos: () => THREE.Vector3;
  onPropGrabbed?: (prop: PhysicsProp, justUprooted: boolean) => void;
  onAdjustReleaseVelocity?: (prop: PhysicsProp, vel: THREE.Vector3) => THREE.Vector3;
  tryPickupVillager?: (worldPos: THREE.Vector3) => PhysicsProp | null;
}

/**
 * Silky, unrestricted Mouse + Trackpad + Keyboard God-Hand simulator:
 * - Left-drag empty terrain: Smooth screen-space pan anywhere across the island & ocean!
 * - Left-drag rock/tree/wood/food/villager: Grab & throw!
 * - Right-drag / Shift+Left-drag / Q & E: Smooth 360° orbit & pitch tilt!
 * - WASD / Arrows (+ Shift boost): Smooth zoom-scaled panning!
 * - Scroll wheel / Trackpad scroll: Smooth exponential zoom (close-up to full-island overview)!
 * - L: Tie Creature Leash to cursor · U: Unleash · C: Focus Creature · H: Home · R: Rival
 */
export class DesktopSimulator {
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly keys = new Set<string>();

  private yaw = 0.25;
  private targetYaw = 0.25;
  private pitch = -0.58;
  private targetPitch = -0.58;
  private distance = 42;
  private targetDistance = 42;
  private focus = new THREE.Vector3(PLAYER_VILLAGE_POS.x + 2, 5, PLAYER_VILLAGE_POS.z + 2);
  private targetFocus = new THREE.Vector3(PLAYER_VILLAGE_POS.x + 2, 5, PLAYER_VILLAGE_POS.z + 2);

  private orbiting = false;
  private panningGround = false;
  private lastMouse = new THREE.Vector2();

  private grabbedProp: PhysicsProp | null = null;
  private lastGrabWorld = new THREE.Vector3();
  private throwVelocity = new THREE.Vector3();
  private drawingGesture = false;

  public readonly cursorWorldPos = new THREE.Vector3(PLAYER_VILLAGE_POS.x, 5, PLAYER_VILLAGE_POS.z);

  getHeldProp(): PhysicsProp | null {
    return this.grabbedProp;
  }

  getThrowVelocity(): THREE.Vector3 {
    return this.throwVelocity;
  }

  getFocusPos(): THREE.Vector3 {
    return this.focus;
  }

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
      try {
        this.domElement.setPointerCapture(e.pointerId);
      } catch {
        // ignore synthetic events without active pointerId
      }

      // Right-click, Middle-click, or Shift/Alt+Left-click (great for laptop trackpads!) orbits camera
      if (e.button === 2 || e.button === 1 || (e.button === 0 && (e.shiftKey || e.altKey))) {
        this.orbiting = true;
        return;
      }

      const hit = this.raycastGround();
      this.cursorWorldPos.copy(hit);

      if (this.keys.has('KeyG')) {
        this.drawingGesture = true;
        this.gestureRecognizer.beginStroke(hit.clone().add(new THREE.Vector3(0, 4, 0)));
        return;
      }

      // Tighter pick radius (1.9m) so dragging empty ground never accidentally uproots nearby trees
      const nearest = this.physics.findNearestGrabbable(hit, 1.9);
      if (nearest) {
        this.grabbedProp = nearest;
        const justUprooted = this.physics.grabProp(nearest, 'desktop');
        this.callbacks.onPropGrabbed?.(nearest, justUprooted);
        this.lastGrabWorld.copy(hit).add(new THREE.Vector3(0, 3.5, 0));
        this.throwVelocity.set(0, 0, 0);
        return;
      }

      // Or pick up a nearby villager!
      const villagerProp = this.callbacks.tryPickupVillager?.(hit) ?? null;
      if (villagerProp) {
        this.grabbedProp = villagerProp;
        this.physics.grabProp(villagerProp, 'desktop');
        this.callbacks.onPropGrabbed?.(villagerProp, false);
        this.lastGrabWorld.copy(hit).add(new THREE.Vector3(0, 3.5, 0));
        this.throwVelocity.set(0, 0, 0);
        return;
      }

      // Smooth world-pull panning on empty ground
      this.panningGround = true;
    });

    window.addEventListener('pointermove', (e) => {
      this.updatePointer(e);
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.lastMouse.set(e.clientX, e.clientY);

      if (this.orbiting) {
        this.targetYaw -= dx * 0.0065;
        this.targetPitch = THREE.MathUtils.clamp(this.targetPitch - dy * 0.0055, -1.45, -0.14);
        return;
      }

      if (this.panningGround) {
        // Screen-space horizontal panning scaled by camera distance — zero horizon jumps!
        const panScale = (this.distance * 0.0022) / Math.max(0.35, -Math.sin(this.pitch));
        const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

        this.targetFocus.addScaledVector(right, -dx * panScale);
        this.targetFocus.addScaledVector(forward, dy * panScale);
        this.clampFocus();
        return;
      }

      const hit = this.raycastGround();
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
      this.panningGround = false;
      if (this.drawingGesture) {
        this.drawingGesture = false;
        const match = this.gestureRecognizer.endStroke(this.camera);
        if (match) {
          this.callbacks.onCastMiracle(match.type, this.cursorWorldPos.clone());
        }
      }
      if (this.grabbedProp) {
        const finalVel =
          this.callbacks.onAdjustReleaseVelocity?.(this.grabbedProp, this.throwVelocity) ?? this.throwVelocity;
        this.physics.releaseProp(this.grabbedProp, finalVel);
        this.grabbedProp = null;
      }
    });

    this.domElement.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        // Laptop trackpad 2-finger horizontal/diagonal scroll => smooth panning!
        if (!e.ctrlKey && Math.abs(e.deltaX) > 2) {
          const panScale = this.distance * 0.0028;
          const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
          const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
          this.targetFocus.addScaledVector(right, e.deltaX * panScale);
          this.targetFocus.addScaledVector(forward, -e.deltaY * panScale);
          this.clampFocus();
          return;
        }
        // Mouse wheel or trackpad pinch-zoom => smooth exponential zoom!
        const clampedDelta = THREE.MathUtils.clamp(e.deltaY, -140, 140);
        const factor = Math.exp(clampedDelta * (e.ctrlKey ? 0.0065 : 0.0022));
        this.targetDistance = THREE.MathUtils.clamp(this.targetDistance * factor, 8, 180);
      },
      { passive: false }
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
      if (e.code === 'KeyL') this.callbacks.onLeashCreature(this.cursorWorldPos.clone());
      if (e.code === 'KeyU') this.callbacks.onUnleashCreature();
      if (e.code === 'KeyH') {
        this.targetFocus.set(PLAYER_VILLAGE_POS.x, 5, PLAYER_VILLAGE_POS.z);
      }
      if (e.code === 'KeyR') {
        this.targetFocus.set(RIVAL_VILLAGE_POS.x, 5, RIVAL_VILLAGE_POS.z);
      }
      if (e.code === 'KeyC') {
        const c = this.callbacks.getCreaturePos();
        this.targetFocus.set(c.x, c.y + 2, c.z);
        this.targetDistance = Math.min(this.targetDistance, 28);
      }
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

  private raycastPlane(planeY: number): THREE.Vector3 {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    const out = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(plane, out);
    return hit ? out : this.focus.clone();
  }

  private raycastGround(): THREE.Vector3 {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.terrain.mesh, false);
    if (hits.length > 0) return hits[0].point;
    return this.raycastPlane(2);
  }

  private clampFocus(): void {
    this.targetFocus.x = THREE.MathUtils.clamp(this.targetFocus.x, -180, 180);
    this.targetFocus.z = THREE.MathUtils.clamp(this.targetFocus.z, -180, 180);
    this.focus.x = THREE.MathUtils.clamp(this.focus.x, -180, 180);
    this.focus.z = THREE.MathUtils.clamp(this.focus.z, -180, 180);
  }

  update(dt: number, inVR: boolean): void {
    if (inVR) return;

    // Smooth camera orbit via Q / E keys
    if (this.keys.has('KeyQ')) this.targetYaw += 1.7 * dt;
    if (this.keys.has('KeyE')) this.targetYaw -= 1.7 * dt;

    // Zoom-scaled panning speed (faster when high up, precise when close down)
    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 2.2 : 1.0;
    const speed = Math.max(22, this.distance * 1.15) * boost * dt;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.targetFocus.addScaledVector(forward, speed);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.targetFocus.addScaledVector(forward, -speed);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.targetFocus.addScaledVector(right, speed);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.targetFocus.addScaledVector(right, -speed);

    this.clampFocus();
    const groundY = Math.max(0.5, this.terrain.getHeightAt(this.targetFocus.x, this.targetFocus.z));
    this.targetFocus.y = groundY + 1.5;

    // Silky critically-damped interpolation
    const smooth = 1 - Math.exp(-12 * dt);
    this.yaw = THREE.MathUtils.lerp(this.yaw, this.targetYaw, smooth);
    this.pitch = THREE.MathUtils.lerp(this.pitch, this.targetPitch, smooth);
    this.distance = THREE.MathUtils.lerp(this.distance, this.targetDistance, smooth);
    this.focus.lerp(this.targetFocus, smooth);

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
