import * as THREE from 'three';
import { AlignmentPalette } from '../core/AlignmentSystem';

export class SkyAtmosphere {
  public readonly group = new THREE.Group();
  public readonly sunLight: THREE.DirectionalLight;
  public readonly hemiLight: THREE.HemisphereLight;
  private readonly skyUniforms: {
    uTopColor: { value: THREE.Color };
    uHorizonColor: { value: THREE.Color };
    uSunDir: { value: THREE.Vector3 };
    uSunColor: { value: THREE.Color };
  };
  private readonly clouds: THREE.Mesh[] = [];
  private readonly cloudMat: THREE.MeshStandardMaterial;

  constructor(private readonly scene: THREE.Scene) {
    const sunDir = new THREE.Vector3(0.48, 0.65, 0.35).normalize();
    this.skyUniforms = {
      uTopColor: { value: new THREE.Color(0x3a6ea5) },
      uHorizonColor: { value: new THREE.Color(0xd6d2c4) },
      uSunDir: { value: sunDir },
      uSunColor: { value: new THREE.Color(0xffe6b3) },
    };

    const skyGeom = new THREE.SphereGeometry(420, 32, 20);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTopColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        varying vec3 vDir;

        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(uHorizonColor, uTopColor, pow(h, 0.55));
          float sunDot = max(dot(normalize(vDir), uSunDir), 0.0);
          col += uSunColor * pow(sunDot, 120.0) * 1.4;
          col += uSunColor * pow(sunDot, 10.0) * 0.22;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.group.add(new THREE.Mesh(skyGeom, skyMat));

    this.sunLight = new THREE.DirectionalLight(0xffe6b3, 1.9);
    this.sunLight.position.copy(sunDir).multiplyScalar(120);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 20;
    this.sunLight.shadow.camera.far = 260;
    const d = 85;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.group.add(this.sunLight);

    this.hemiLight = new THREE.HemisphereLight(0xaad8ff, 0x3b4d32, 0.8);
    this.group.add(this.hemiLight);

    // Stylized drifting low-poly clouds
    this.cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      flatShading: true,
      transparent: true,
      opacity: 0.85,
    });
    const puffGeom = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 14; i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + (i % 3);
      for (let p = 0; p < puffs; p++) {
        const m = new THREE.Mesh(puffGeom, this.cloudMat);
        m.position.set((p - 1) * 5.5, (p % 2) * 1.5, ((p * 7) % 3 - 1) * 2.5);
        m.scale.set(5 + (p % 2) * 2, 2.6, 4.2);
        cloud.add(m);
      }
      const angle = (i / 14) * Math.PI * 2;
      const radius = 55 + (i % 4) * 28;
      cloud.position.set(Math.cos(angle) * radius, 42 + (i % 3) * 8, Math.sin(angle) * radius);
      this.group.add(cloud);
      this.clouds.push(cloud as unknown as THREE.Mesh);
    }

    this.scene.fog = new THREE.FogExp2(0xb8c7d4, 0.0026);
    this.scene.add(this.group);
  }

  update(dt: number, palette: AlignmentPalette, alignment: number): void {
    this.skyUniforms.uTopColor.value.copy(palette.skyTop);
    this.skyUniforms.uHorizonColor.value.copy(palette.skyHorizon);
    this.skyUniforms.uSunColor.value.copy(palette.sunColor);

    this.sunLight.color.copy(palette.sunColor);
    this.sunLight.intensity = THREE.MathUtils.lerp(1.2, 2.2, (alignment + 1) * 0.5);
    this.hemiLight.color.copy(palette.skyHorizon);
    this.hemiLight.intensity = THREE.MathUtils.lerp(0.45, 0.95, (alignment + 1) * 0.5);

    this.cloudMat.color.setHex(0xffffff).lerp(new THREE.Color(0x3d2429), Math.max(0, -alignment * 0.8));

    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(palette.fogColor);
      this.scene.fog.density = THREE.MathUtils.lerp(0.0038, 0.002, (alignment + 1) * 0.5);
    }

    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      c.position.x += dt * (0.9 + (i % 3) * 0.3);
      if (c.position.x > 180) c.position.x = -180;
    }
  }
}
