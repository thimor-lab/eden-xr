import * as THREE from 'three';
import { HandState } from './HandTracker';
import { findPokedButtonIndex } from './VRWristMenu';

export interface TutorialProgress {
  moved: boolean;
  zoomed: boolean;
  openedMenu: boolean;
  interacted: boolean;
}

/**
 * Interactive 3D Floating Tutorial Tablet in VR:
 * Appears comfortably in front of the player on VR entry, checks off each
 * navigation & interaction step live, and offers pokeable "Pin Menu" and "Hide Guide" buttons.
 */
export class VRTutorialPanel {
  public readonly group = new THREE.Group();
  public visible = true;

  private readonly canvas: HTMLCanvasElement | null;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly texture: THREE.CanvasTexture | null;
  private readonly pinBtnMesh: THREE.Mesh;
  private readonly hideBtnMesh: THREE.Mesh;
  private readonly btnOffsets: THREE.Vector3[];

  private lastSignature = '';
  private pokeCooldown = 0;
  private initializedPlacement = false;

  constructor(parent: THREE.Object3D) {
    if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 640;
      this.canvas.height = 420;
      this.ctx = this.canvas.getContext('2d');
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.colorSpace = THREE.SRGBColorSpace;
    } else {
      this.canvas = null;
      this.ctx = null;
      this.texture = null;
    }

    const panelMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.68, 0.44),
      new THREE.MeshBasicMaterial({
        map: this.texture ?? undefined,
        color: this.texture ? 0xffffff : 0x101a28,
        transparent: true,
        side: THREE.DoubleSide,
      })
    );
    this.group.add(panelMesh);

    // Two easy-to-poke 3D buttons along the bottom edge
    const makeBtn = (label: string, color: string, x: number): THREE.Mesh => {
      let tex: THREE.CanvasTexture | null = null;
      if (typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        c.width = 256;
        c.height = 80;
        const g = c.getContext('2d');
        if (g) {
          g.fillStyle = 'rgba(18, 30, 46, 0.96)';
          g.strokeStyle = color;
          g.lineWidth = 5;
          g.beginPath();
          g.roundRect(4, 4, 248, 72, 18);
          g.fill();
          g.stroke();
          g.fillStyle = '#f6f2e8';
          g.font = 'bold 28px system-ui, sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(label, 128, 42);
          tex = new THREE.CanvasTexture(c);
          tex.colorSpace = THREE.SRGBColorSpace;
        }
      }
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.24, 0.075),
        new THREE.MeshBasicMaterial({
          map: tex ?? undefined,
          color: tex ? 0xffffff : 0x334455,
          transparent: true,
          side: THREE.DoubleSide,
        })
      );
      mesh.position.set(x, -0.265, 0.012);
      this.group.add(mesh);
      return mesh;
    };

    this.pinBtnMesh = makeBtn('Toggle Menu', '#66e8ff', -0.15);
    this.hideBtnMesh = makeBtn('Hide Guide', '#ffd970', 0.15);
    this.btnOffsets = [this.pinBtnMesh.position.clone(), this.hideBtnMesh.position.clone()];

    this.group.visible = false;
    parent.add(this.group);
    this.redraw({ moved: false, zoomed: false, openedMenu: false, interacted: false }, 'world-pull');
  }

  resetForVRSession(): void {
    this.visible = true;
    this.initializedPlacement = false;
  }

  update(
    headLocalPos: THREE.Vector3,
    headForwardLocal: THREE.Vector3,
    right: HandState,
    left: HandState,
    progress: TutorialProgress,
    navMode: string,
    dt: number,
    onTogglePinMenu: () => void
  ): boolean {
    if (this.pokeCooldown > 0) this.pokeCooldown -= dt;

    if (!this.visible) {
      this.group.visible = false;
      return false;
    }

    this.group.visible = true;

    // Place gently ~0.85m in front of player on entry (slightly upper-left so island stays clear)
    if (!this.initializedPlacement) {
      const horizFwd = headForwardLocal.clone().setY(0);
      if (horizFwd.lengthSq() < 0.01) horizFwd.set(0, 0, -1);
      horizFwd.normalize();
      const rightDir = new THREE.Vector3(-horizFwd.z, 0, horizFwd.x);
      this.group.position
        .copy(headLocalPos)
        .addScaledVector(horizFwd, 0.88)
        .addScaledVector(rightDir, -0.22)
        .add(new THREE.Vector3(0, 0.08, 0));
      this.group.lookAt(headLocalPos);
      this.initializedPlacement = true;
    }

    this.redraw(progress, navMode);

    // Check either index fingertip poking the two bottom buttons
    let poking = false;
    const worldBtns = this.btnOffsets.map((o) => o.clone().applyMatrix4(this.group.matrix));
    const fingers: THREE.Vector3[] = [];
    if (right.tracked) fingers.push(right.indexTipLocalPos);
    if (left.tracked) fingers.push(left.indexTipLocalPos);

    let hitIdx = -1;
    for (const f of fingers) {
      const idx = findPokedButtonIndex(f, worldBtns, 0.065);
      if (idx !== -1) {
        hitIdx = idx;
        break;
      }
    }

    this.pinBtnMesh.scale.setScalar(hitIdx === 0 ? 1.12 : 1.0);
    this.hideBtnMesh.scale.setScalar(hitIdx === 1 ? 1.12 : 1.0);

    if (hitIdx !== -1) {
      poking = true;
      if (this.pokeCooldown <= 0) {
        this.pokeCooldown = 0.65;
        if (hitIdx === 0) {
          onTogglePinMenu();
        } else {
          this.visible = false;
          this.group.visible = false;
        }
      }
    }

    return poking;
  }

  private redraw(p: TutorialProgress, navMode: string): void {
    if (!this.ctx || !this.texture) return;
    const sig = `${p.moved}-${p.zoomed}-${p.openedMenu}-${p.interacted}-${navMode}`;
    if (sig === this.lastSignature) return;
    this.lastSignature = sig;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, 640, 420);

    // Dark translucent mythic panel
    ctx.fillStyle = 'rgba(10, 18, 28, 0.90)';
    ctx.strokeStyle = '#ffd970';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.roundRect(8, 8, 624, 404, 24);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffd970';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillText('EDEN XR — GOD GUIDE', 32, 54);

    ctx.fillStyle = '#8ad8ff';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText(`Current Nav Mode: ${navMode === 'world-pull' ? 'Diorama World-Pull' : 'Point-to-Glide'}`, 32, 86);

    const steps: { done: boolean; title: string; desc: string }[] = [
      {
        done: p.moved,
        title: '1. Move Around the Island',
        desc: 'Pinch or make a fist in empty air & PULL (flick to glide!)',
      },
      {
        done: p.zoomed,
        title: '2. Zoom & Rotate World',
        desc: 'Grab empty air with BOTH hands: spread/squeeze to zoom, twist to turn',
      },
      {
        done: p.openedMenu,
        title: '3. Open Grimoire Menu',
        desc: 'Turn LEFT palm UP toward your face (or poke "Toggle Menu" below)',
      },
      {
        done: p.interacted,
        title: '4. Grab, Leash & Cast Miracles',
        desc: 'Pinch rocks/trees to throw · Poke Miracles/Leash in Menu · Pet/Slap Creature',
      },
    ];

    let y = 132;
    for (const s of steps) {
      ctx.fillStyle = s.done ? '#7aff9e' : '#ffe49e';
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.fillText(`${s.done ? '✓' : '○'}  ${s.title}`, 32, y);

      ctx.fillStyle = '#d4dde8';
      ctx.font = '17px system-ui, sans-serif';
      ctx.fillText(s.desc, 64, y + 24);
      y += 68;
    }

    this.texture.needsUpdate = true;
  }
}
