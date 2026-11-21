import * as THREE from 'three';
import { MiracleType } from '../core/EventBus';
import { HandState } from './HandTracker';

export type WristMenuAction =
  | MiracleType
  | 'leash'
  | 'unleash'
  | 'jump_home'
  | 'jump_rival'
  | 'jump_creature'
  | 'toggle_nav';

export interface WristButtonDef {
  id: WristMenuAction;
  title: string;
  subtitle: string;
  symbol: 'circle' | 'triangle' | 'wave' | 'spiral' | 'zigzag' | 'leash' | 'unleash' | 'home' | 'rival' | 'creature' | 'nav';
  accentColor: string;
  row: 0 | 1;
  col: number;
}

const BUTTON_DEFS: WristButtonDef[] = [
  // Row 0: Miracles with drawn gesture reminders
  { id: 'food', title: 'Food', subtitle: 'Draw O · 12', symbol: 'circle', accentColor: '#ffd966', row: 0, col: 0 },
  { id: 'wood', title: 'Wood', subtitle: 'Draw Δ · 12', symbol: 'triangle', accentColor: '#d99b52', row: 0, col: 1 },
  { id: 'rain', title: 'Rain', subtitle: 'Draw ~ · 15', symbol: 'wave', accentColor: '#66d4ff', row: 0, col: 2 },
  { id: 'fireball', title: 'Fireball', subtitle: 'Draw @ · 18', symbol: 'spiral', accentColor: '#ff6633', row: 0, col: 3 },
  { id: 'lightning', title: 'Lightning', subtitle: 'Draw Z · 24', symbol: 'zigzag', accentColor: '#a6e3ff', row: 0, col: 4 },
  // Row 1: Creature Leash & VR Navigation shortcuts
  { id: 'leash', title: 'Leash', subtitle: 'Aim & Pinch', symbol: 'leash', accentColor: '#66f0ff', row: 1, col: 0 },
  { id: 'unleash', title: 'Unleash', subtitle: 'Free Roam', symbol: 'unleash', accentColor: '#99c4d6', row: 1, col: 1 },
  { id: 'jump_home', title: 'Home', subtitle: 'Swoop', symbol: 'home', accentColor: '#88f0a4', row: 1, col: 2 },
  { id: 'jump_rival', title: 'Rival', subtitle: 'Swoop', symbol: 'rival', accentColor: '#ff7d6b', row: 1, col: 3 },
  { id: 'jump_creature', title: 'Creature', subtitle: 'Swoop', symbol: 'creature', accentColor: '#ffe07d', row: 1, col: 4 },
  { id: 'toggle_nav', title: 'Nav Mode', subtitle: 'Pull/Glide', symbol: 'nav', accentColor: '#c9a6ff', row: 1, col: 5 },
];

interface MenuButtonInstance {
  def: WristButtonDef;
  mesh: THREE.Mesh;
  localOffset: THREE.Vector3;
}

/** Pure helper for unit testing button poke hit detection */
export function findPokedButtonIndex(
  fingerLocalPos: THREE.Vector3,
  buttonPositions: THREE.Vector3[],
  pokeRadius = 0.036
): number {
  let bestIdx = -1;
  let bestDistSq = pokeRadius * pokeRadius;
  for (let i = 0; i < buttonPositions.length; i++) {
    const dSq = fingerLocalPos.distanceToSquared(buttonPositions[i]);
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function drawSymbol(ctx: CanvasRenderingContext2D, symbol: WristButtonDef['symbol'], color: string): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();

  const cx = 64;
  const cy = 46;

  if (symbol === 'circle') {
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.stroke();
  } else if (symbol === 'triangle') {
    ctx.moveTo(cx, cy - 23);
    ctx.lineTo(cx + 24, cy + 19);
    ctx.lineTo(cx - 24, cy + 19);
    ctx.closePath();
    ctx.stroke();
  } else if (symbol === 'wave') {
    ctx.moveTo(cx - 28, cy);
    ctx.bezierCurveTo(cx - 14, cy - 26, cx + 2, cy - 26, cx, cy);
    ctx.bezierCurveTo(cx - 2, cy + 26, cx + 14, cy + 26, cx + 28, cy);
    ctx.stroke();
  } else if (symbol === 'spiral') {
    for (let i = 0; i <= 36; i++) {
      const t = i / 36;
      const a = t * Math.PI * 3.8;
      const r = 4 + t * 22;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else if (symbol === 'zigzag') {
    ctx.moveTo(cx - 20, cy - 22);
    ctx.lineTo(cx + 20, cy - 22);
    ctx.lineTo(cx - 18, cy + 4);
    ctx.lineTo(cx + 20, cy + 22);
    ctx.stroke();
  } else if (symbol === 'leash') {
    ctx.arc(cx - 16, cy - 8, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy - 2);
    ctx.quadraticCurveTo(cx + 4, cy + 22, cx + 22, cy + 8);
    ctx.stroke();
  } else if (symbol === 'unleash') {
    ctx.moveTo(cx - 18, cy - 16);
    ctx.lineTo(cx + 18, cy + 16);
    ctx.moveTo(cx + 18, cy - 16);
    ctx.lineTo(cx - 18, cy + 16);
    ctx.stroke();
  } else if (symbol === 'home') {
    ctx.moveTo(cx - 20, cy + 2);
    ctx.lineTo(cx, cy - 20);
    ctx.lineTo(cx + 20, cy + 2);
    ctx.stroke();
    ctx.strokeRect(cx - 13, cy + 2, 26, 18);
  } else if (symbol === 'rival') {
    ctx.moveTo(cx - 18, cy + 18);
    ctx.lineTo(cx + 18, cy - 18);
    ctx.moveTo(cx + 4, cy - 18);
    ctx.lineTo(cx + 18, cy - 18);
    ctx.lineTo(cx + 18, cy - 4);
    ctx.stroke();
  } else if (symbol === 'creature') {
    ctx.arc(cx, cy + 4, 14, 0, Math.PI * 2);
    ctx.fill();
    for (const [ox, oy] of [
      [-16, -14],
      [-5, -20],
      [6, -20],
      [17, -14],
    ]) {
      ctx.beginPath();
      ctx.arc(cx + ox, cy + oy, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Nav compass arrows
    ctx.moveTo(cx, cy - 22);
    ctx.lineTo(cx, cy + 22);
    ctx.moveTo(cx - 22, cy);
    ctx.lineTo(cx + 22, cy);
    ctx.stroke();
  }
}

function createButtonTexture(def: WristButtonDef): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Rounded dark glass card
  ctx.fillStyle = 'rgba(14, 22, 34, 0.92)';
  ctx.strokeStyle = def.accentColor;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(4, 4, 120, 120, 18);
  ctx.fill();
  ctx.stroke();

  drawSymbol(ctx, def.symbol, def.accentColor);

  ctx.fillStyle = '#f6f2e8';
  ctx.font = 'bold 19px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(def.title, 64, 96);

  ctx.fillStyle = def.accentColor;
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillText(def.subtitle, 64, 115);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Diegetic 3D Left-Palm Wrist Menu ("God's Grimoire"):
 * Turn your left palm up toward your face to reveal Miracle gesture reminders,
 * one-poke Miracle & Leash arming, and comfortable VR swoop navigation!
 */
export class VRWristMenu {
  public readonly group = new THREE.Group();
  public isOpen = false;
  public pinned = false;
  public armedAction: MiracleType | 'leash' | null = null;

  private readonly buttons: MenuButtonInstance[] = [];
  private openAmount = 0;
  private pokeCooldown = 0;
  private smoothedPos = new THREE.Vector3();
  private hasSmoothedPos = false;
  private readonly lookMat = new THREE.Matrix4();
  private readonly upVec = new THREE.Vector3(0, 1, 0);

  constructor(parent: THREE.Object3D) {
    // Backplate panel
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.49, 0.2),
      new THREE.MeshBasicMaterial({
        color: 0x0a111c,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
      })
    );
    plate.position.z = -0.004;
    this.group.add(plate);

    const cardGeom = new THREE.PlaneGeometry(0.07, 0.07);

    for (const def of BUTTON_DEFS) {
      const tex = createButtonTexture(def);
      const mat = new THREE.MeshBasicMaterial({
        map: tex ?? undefined,
        color: tex ? 0xffffff : 0x223344,
        transparent: true,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(cardGeom, mat);

      const colsInRow = def.row === 0 ? 5 : 6;
      const xSpacing = 0.076;
      const x = (def.col - (colsInRow - 1) * 0.5) * xSpacing;
      const y = def.row === 0 ? 0.044 : -0.042;
      const z = 0.006;

      const localOffset = new THREE.Vector3(x, y, z);
      mesh.position.copy(localOffset);
      this.group.add(mesh);
      this.buttons.push({ def, mesh, localOffset });
    }

    this.group.visible = false;
    parent.add(this.group);
  }

  togglePinned(headLocalPos: THREE.Vector3, headForwardLocal: THREE.Vector3): boolean {
    this.pinned = !this.pinned;
    if (this.pinned) {
      const fwd = headForwardLocal.clone().setY(0);
      if (fwd.lengthSq() < 0.01) fwd.set(0, 0, -1);
      fwd.normalize();
      this.smoothedPos.copy(headLocalPos).addScaledVector(fwd, 0.62).add(new THREE.Vector3(0, -0.14, 0));
      this.hasSmoothedPos = true;
    }
    return this.pinned;
  }

  update(
    left: HandState,
    right: HandState,
    headLocalPos: THREE.Vector3,
    dt: number,
    onAction: (action: WristMenuAction) => void
  ): boolean {
    if (this.pokeCooldown > 0) this.pokeCooldown -= dt;

    // Reveal menu when pinned OR when left palm is turned upward/toward face (forgiving threshold!)
    const palmTriggered = left.tracked && left.isPalmFacingCamera && !left.isPinching && !left.isGrabbing;
    const shouldOpen = this.pinned || palmTriggered;
    this.isOpen = shouldOpen;
    this.openAmount = THREE.MathUtils.lerp(this.openAmount, shouldOpen ? 1 : 0, Math.min(1, dt * 11));

    if (this.openAmount < 0.04) {
      this.group.visible = false;
      this.hasSmoothedPos = false;
      return false;
    }

    this.group.visible = true;
    if (!this.pinned && left.tracked) {
      // Float 13cm above left palm with gentle smoothing so buttons stay steady while poking
      const targetPos = left.palmLocalPos.clone().add(new THREE.Vector3(0, 0.13, 0));
      if (!this.hasSmoothedPos) {
        this.smoothedPos.copy(targetPos);
        this.hasSmoothedPos = true;
      } else {
        this.smoothedPos.lerp(targetPos, Math.min(1, dt * 9));
      }
    }
    this.group.position.copy(this.smoothedPos);
    // Orient +Z front face directly toward headLocalPos in parent (godRig) local space
    this.lookMat.lookAt(headLocalPos, this.group.position, this.upVec);
    this.group.quaternion.setFromRotationMatrix(this.lookMat);
    this.group.scale.setScalar(this.openAmount);

    // Check right index fingertip (or left if pinned) poking any 3D button
    let interacting = false;
    if (right.tracked && this.openAmount > 0.65) {
      this.group.updateMatrix();
      const buttonRigPositions = this.buttons.map((b) => {
        const p = b.localOffset.clone();
        p.applyMatrix4(this.group.matrix);
        return p;
      });

      const pokedIdx = findPokedButtonIndex(right.indexTipLocalPos, buttonRigPositions, 0.048);

      for (let i = 0; i < this.buttons.length; i++) {
        const btn = this.buttons[i];
        const isArmed = this.armedAction === btn.def.id;
        const isHovered = i === pokedIdx;
        btn.mesh.scale.setScalar(isHovered ? 1.18 : isArmed ? 1.1 : 1.0);
        (btn.mesh.material as THREE.MeshBasicMaterial).color.setHex(
          isHovered ? 0xffffcc : isArmed ? 0x99ffff : 0xffffff
        );
      }

      if (pokedIdx !== -1) {
        interacting = true;
        if (this.pokeCooldown <= 0) {
          this.pokeCooldown = 0.55;
          const action = this.buttons[pokedIdx].def.id;
          if (
            action === 'food' ||
            action === 'wood' ||
            action === 'rain' ||
            action === 'fireball' ||
            action === 'lightning' ||
            action === 'leash'
          ) {
            this.armedAction = this.armedAction === action ? null : action;
          } else if (action === 'unleash') {
            this.armedAction = null;
          }
          onAction(action);
        }
      }
    }

    return interacting;
  }
}
