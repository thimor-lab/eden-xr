import * as THREE from 'three';
import { AlignmentPalette } from '../core/AlignmentSystem';

/**
 * Stylized alignment-reactive 3D God Hand rendered from WebXR 25-joint hand tracking data.
 */
export class GodHandMesh {
  public readonly group = new THREE.Group();
  private readonly jointMeshes: THREE.Mesh[] = [];
  private readonly palmGem: THREE.Mesh;
  private readonly handMat: THREE.MeshStandardMaterial;
  private readonly gemMat: THREE.MeshStandardMaterial;

  constructor(parent: THREE.Object3D) {
    this.handMat = new THREE.MeshStandardMaterial({
      color: 0xdcc7a1,
      emissive: 0x665533,
      emissiveIntensity: 0.35,
      roughness: 0.4,
      metalness: 0.15,
      flatShading: true,
    });
    this.gemMat = new THREE.MeshStandardMaterial({
      color: 0xffd670,
      emissive: 0xffb833,
      emissiveIntensity: 1.1,
      roughness: 0.15,
    });

    const jointGeom = new THREE.IcosahedronGeometry(0.013, 0);
    for (let i = 0; i < 25; i++) {
      const m = new THREE.Mesh(jointGeom, this.handMat);
      m.visible = false;
      this.group.add(m);
      this.jointMeshes.push(m);
    }

    this.palmGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.024, 0), this.gemMat);
    this.palmGem.visible = false;
    this.group.add(this.palmGem);

    parent.add(this.group);
  }

  updateJoints(jointPositions: THREE.Vector3[], palmPos: THREE.Vector3 | null, palette: AlignmentPalette): void {
    this.handMat.color.copy(palette.handPrimary);
    this.handMat.emissive.copy(palette.handEmissive);
    this.gemMat.color.copy(palette.ringColor);
    this.gemMat.emissive.copy(palette.handEmissive);

    for (let i = 0; i < this.jointMeshes.length; i++) {
      const m = this.jointMeshes[i];
      if (i < jointPositions.length) {
        m.visible = true;
        m.position.copy(jointPositions[i]);
        // Fingertips slightly larger for visual clarity
        const isTip = i === 4 || i === 9 || i === 14 || i === 19 || i === 24;
        m.scale.setScalar(isTip ? 1.15 : 0.85);
      } else {
        m.visible = false;
      }
    }

    if (palmPos) {
      this.palmGem.visible = true;
      this.palmGem.position.copy(palmPos);
      this.palmGem.rotation.y += 0.04;
    } else {
      this.palmGem.visible = false;
    }
  }

  hide(): void {
    for (const m of this.jointMeshes) m.visible = false;
    this.palmGem.visible = false;
  }
}
