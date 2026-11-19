import * as THREE from 'three';

export class OceanShader {
  public readonly mesh: THREE.Mesh;
  private readonly uniforms: {
    uTime: { value: number };
    uDeepColor: { value: THREE.Color };
    uShallowColor: { value: THREE.Color };
    uSunDir: { value: THREE.Vector3 };
    uSunColor: { value: THREE.Color };
  };

  constructor() {
    this.uniforms = {
      uTime: { value: 0 },
      uDeepColor: { value: new THREE.Color(0x0b3a5b) },
      uShallowColor: { value: new THREE.Color(0x1f8fa8) },
      uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.3).normalize() },
      uSunColor: { value: new THREE.Color(0xfff1cc) },
    };

    const geom = new THREE.PlaneGeometry(900, 900, 96, 96);
    geom.rotateX(-Math.PI / 2);

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vWorldPos;
        varying float vWave;

        void main() {
          vec3 p = position;
          float w1 = sin(p.x * 0.08 + uTime * 1.1) * cos(p.z * 0.07 + uTime * 0.9) * 0.22;
          float w2 = sin(p.x * 0.19 - uTime * 1.6 + p.z * 0.14) * 0.09;
          p.y += w1 + w2;
          vWave = w1 + w2;
          vec4 world = modelMatrix * vec4(p, 1.0);
          vWorldPos = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        varying vec3 vWorldPos;
        varying float vWave;

        void main() {
          float dist = length(vWorldPos.xz);
          float shore = smoothstep(140.0, 48.0, dist);
          vec3 base = mix(uDeepColor, uShallowColor, shore);

          // Approximate normal from wave height for sparkle
          vec3 N = normalize(vec3(dFdx(vWave) * 4.5, 1.0, dFdy(vWave) * 4.5));
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(dot(N, H), 0.0), 64.0) * 0.7;
          float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.35;

          // Subtle crest highlights
          float foam = smoothstep(0.18, 0.3, vWave) * 0.25;
          vec3 color = base + uSunColor * (spec + fresnel) + vec3(foam);
          float alpha = mix(0.92, 0.78, shore);
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.position.y = 0.0;
    this.mesh.name = 'Ocean';
  }

  update(dt: number, sunColor: THREE.Color, alignment: number): void {
    this.uniforms.uTime.value += dt;
    this.uniforms.uSunColor.value.copy(sunColor);
    if (alignment < 0) {
      this.uniforms.uDeepColor.value.setHex(0x0b3a5b).lerp(new THREE.Color(0x1e0e16), -alignment * 0.75);
      this.uniforms.uShallowColor.value.setHex(0x1f8fa8).lerp(new THREE.Color(0x4f2326), -alignment * 0.7);
    } else {
      this.uniforms.uDeepColor.value.setHex(0x0b3a5b).lerp(new THREE.Color(0x0d5285), alignment * 0.5);
      this.uniforms.uShallowColor.value.setHex(0x1f8fa8).lerp(new THREE.Color(0x36c7d9), alignment * 0.5);
    }
  }
}
