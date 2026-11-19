import * as THREE from 'three';
import { IslandTerrain } from './IslandTerrain';

/**
 * Luminous Influence Ring projected directly onto the island terrain,
 * mirroring Black & White's iconic territory boundary.
 */
export class InfluenceRing {
  public readonly mesh: THREE.Mesh;
  private readonly segments = 128;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private currentRadius = 30;
  private time = 0;

  constructor(
    private readonly center: THREE.Vector3,
    private readonly terrain: IslandTerrain
  ) {
    this.geometry = new THREE.BufferGeometry();
    const positions = new Float32Array((this.segments + 1) * 2 * 3);
    const uvs = new Float32Array((this.segments + 1) * 2 * 2);
    const indices: number[] = [];

    for (let i = 0; i < this.segments; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }

    for (let i = 0; i <= this.segments; i++) {
      const u = i / this.segments;
      uvs[i * 4] = u;
      uvs[i * 4 + 1] = 0;
      uvs[i * 4 + 2] = u;
      uvs[i * 4 + 3] = 1;
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setIndex(indices);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(0xffd670) },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float edge = sin(vUv.y * 3.14159);
          float pulse = 0.65 + 0.35 * sin(vUv.x * 62.8318 - uTime * 2.5);
          float alpha = pow(edge, 1.6) * pulse * 0.82;
          gl_FragColor = vec4(uColor * (1.2 + 0.3 * pulse), alpha);
        }
      `,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 5;
    this.rebuildRing(this.currentRadius);
  }

  get radius(): number {
    return this.currentRadius;
  }

  isInside(pos: THREE.Vector3): boolean {
    const dx = pos.x - this.center.x;
    const dz = pos.z - this.center.z;
    return dx * dx + dz * dz <= this.currentRadius * this.currentRadius;
  }

  update(dt: number, targetRadius: number, color: THREE.Color): void {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    this.material.uniforms.uColor.value.copy(color);

    if (Math.abs(targetRadius - this.currentRadius) > 0.05) {
      this.currentRadius = THREE.MathUtils.lerp(this.currentRadius, targetRadius, Math.min(1, dt * 2.5));
      this.rebuildRing(this.currentRadius);
    }
  }

  private rebuildRing(radius: number): void {
    const pos = this.geometry.attributes.position as THREE.BufferAttribute;
    const width = 1.4;
    for (let i = 0; i <= this.segments; i++) {
      const theta = (i / this.segments) * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);

      const xIn = this.center.x + cos * (radius - width * 0.5);
      const zIn = this.center.z + sin * (radius - width * 0.5);
      const yIn = Math.max(0.25, this.terrain.getHeightAt(xIn, zIn) + 0.35);

      const xOut = this.center.x + cos * (radius + width * 0.5);
      const zOut = this.center.z + sin * (radius + width * 0.5);
      const yOut = Math.max(0.25, this.terrain.getHeightAt(xOut, zOut) + 0.35);

      pos.setXYZ(i * 2, xIn, yIn, zIn);
      pos.setXYZ(i * 2 + 1, xOut, yOut, zOut);
    }
    pos.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }
}
