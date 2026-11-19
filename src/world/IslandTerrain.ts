import * as THREE from 'three';

export const ISLAND_SIZE = 180;
export const ISLAND_SEGMENTS = 128;
export const PLAYER_VILLAGE_POS = new THREE.Vector3(-24, 0, 10);
export const RIVAL_VILLAGE_POS = new THREE.Vector3(30, 0, -14);

function hash2D(x: number, z: number): number {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2D(ix, iz);
  const b = hash2D(ix + 1, iz);
  const c = hash2D(ix, iz + 1);
  const d = hash2D(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm(x: number, z: number, octaves = 4): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    value += amp * valueNoise(x * freq, z * freq);
    freq *= 2.02;
    amp *= 0.5;
  }
  return value;
}

export class IslandTerrain {
  public readonly mesh: THREE.Mesh;
  public readonly heightData: Float32Array;
  public readonly segments = ISLAND_SEGMENTS;
  public readonly size = ISLAND_SIZE;

  constructor() {
    const geom = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    geom.rotateX(-Math.PI / 2);

    const pos = geom.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    this.heightData = new Float32Array((this.segments + 1) * (this.segments + 1));

    const cSand = new THREE.Color(0xdcc791);
    const cGrass = new THREE.Color(0x4c8c42);
    const cHighGrass = new THREE.Color(0x6ba04c);
    const cRock = new THREE.Color(0x6e6a64);
    const cSnow = new THREE.Color(0xeef2f5);
    const cDeep = new THREE.Color(0x2d4a57);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = IslandTerrain.computeHeight(x, z);
      pos.setY(i, h);
      this.heightData[i] = h;

      if (h < -0.5) {
        tmp.copy(cDeep);
      } else if (h < 1.35) {
        tmp.copy(cSand).lerp(cGrass, Math.max(0, (h - 0.55) / 0.8));
      } else if (h < 8.5) {
        tmp.copy(cGrass).lerp(cHighGrass, (h - 1.35) / 7.15);
      } else if (h < 15.5) {
        tmp.copy(cHighGrass).lerp(cRock, (h - 8.5) / 7.0);
      } else {
        tmp.copy(cRock).lerp(cSnow, Math.min(1, (h - 15.5) / 4.0));
      }

      // Subtle variation
      const jitter = (hash2D(x * 0.3, z * 0.3) - 0.5) * 0.05;
      colors[i * 3] = Math.min(1, Math.max(0, tmp.r + jitter));
      colors[i * 3 + 1] = Math.min(1, Math.max(0, tmp.g + jitter));
      colors[i * 3 + 2] = Math.min(1, Math.max(0, tmp.b + jitter));
    }

    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.02,
      flatShading: true,
    });

    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'IslandTerrain';

    // Snap village anchor Y coordinates
    PLAYER_VILLAGE_POS.y = IslandTerrain.computeHeight(PLAYER_VILLAGE_POS.x, PLAYER_VILLAGE_POS.z);
    RIVAL_VILLAGE_POS.y = IslandTerrain.computeHeight(RIVAL_VILLAGE_POS.x, RIVAL_VILLAGE_POS.z);
  }

  static computeHeight(x: number, z: number): number {
    const half = ISLAND_SIZE * 0.5;
    // Slightly elongated organic island silhouette
    const nx = x / (half * 0.82);
    const nz = z / (half * 0.72);
    const dist = Math.sqrt(nx * nx + nz * nz);
    const coastNoise = (fbm(x * 0.028 + 3.1, z * 0.028 + 1.7, 3) - 0.5) * 0.32;
    const mask = Math.max(0, 1 - Math.pow(Math.max(0, dist + coastNoise), 2.15));

    if (mask <= 0.001) {
      return -3.2;
    }

    // Base rolling hills
    const hills = fbm(x * 0.022 + 10, z * 0.022 + 5, 4) * 14.0;
    // Scenic northern mountain peak
    const peakDist = Math.hypot(x - 2, z + 38);
    const peak = Math.exp(-(peakDist * peakDist) / 420) * 17.0;
    // Gentle central ridge separating the two villages
    const ridgeDist = Math.abs(x - 3 + z * 0.35);
    const ridge = Math.exp(-(ridgeDist * ridgeDist) / 140) * 4.5 * Math.exp(-((z - 0) * (z - 0)) / 900);

    let h = -2.8 + mask * (7.2 + hills + peak + ridge);

    // Flatten plateaus for Player Village and Rival Village so buildings sit cleanly
    const dPlayer = Math.hypot(x - PLAYER_VILLAGE_POS.x, z - PLAYER_VILLAGE_POS.z);
    if (dPlayer < 22) {
      const t = Math.max(0, 1 - dPlayer / 22);
      const smooth = t * t * (3 - 2 * t);
      h = THREE.MathUtils.lerp(h, 4.2, smooth * 0.85);
    }

    const dRival = Math.hypot(x - RIVAL_VILLAGE_POS.x, z - RIVAL_VILLAGE_POS.z);
    if (dRival < 20) {
      const t = Math.max(0, 1 - dRival / 20);
      const smooth = t * t * (3 - 2 * t);
      h = THREE.MathUtils.lerp(h, 4.8, smooth * 0.85);
    }

    return h;
  }

  getHeightAt(x: number, z: number): number {
    return IslandTerrain.computeHeight(x, z);
  }

  getNormalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const eps = 0.75;
    const hL = this.getHeightAt(x - eps, z);
    const hR = this.getHeightAt(x + eps, z);
    const hD = this.getHeightAt(x, z - eps);
    const hU = this.getHeightAt(x, z + eps);
    return out.set(hL - hR, 2 * eps, hD - hU).normalize();
  }

  /** Rapier expects column-major heights for HeightField (nrows x ncols) */
  getRapierHeights(): Float32Array {
    const n = this.segments + 1;
    const out = new Float32Array(n * n);
    // PlaneGeometry fills row-major (z then x); Rapier heightfield indexes [row + col * nrows]
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        out[z + x * n] = this.heightData[z * n + x];
      }
    }
    return out;
  }
}
