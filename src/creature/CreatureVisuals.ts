import * as THREE from 'three';

/**
 * Articulated stylized Guardian Beast that morphs visually with its alignment
 * (radiant golden fur + halo for Good ↔ shadowy obsidian fur + growing horns for Evil).
 */
export class CreatureVisuals {
  public readonly root = new THREE.Group();
  public readonly headGroup = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();

  private readonly furMat: THREE.MeshStandardMaterial;
  private readonly accentMat: THREE.MeshStandardMaterial;
  private readonly haloMesh: THREE.Mesh;
  private readonly leftHorn: THREE.Mesh;
  private readonly rightHorn: THREE.Mesh;
  private readonly feedbackOrb: THREE.Mesh;
  private feedbackTimer = 0;

  constructor(scene: THREE.Scene) {
    this.furMat = new THREE.MeshStandardMaterial({ color: 0xb68b5c, roughness: 0.85, flatShading: true });
    this.accentMat = new THREE.MeshStandardMaterial({ color: 0xe6d4b3, roughness: 0.75, flatShading: true });

    // Torso
    const torso = new THREE.Mesh(new THREE.DodecahedronGeometry(1.45, 1), this.furMat);
    torso.scale.set(1.0, 1.35, 0.9);
    torso.position.y = 2.7;
    torso.castShadow = true;
    this.root.add(torso);

    const belly = new THREE.Mesh(new THREE.DodecahedronGeometry(1.05, 1), this.accentMat);
    belly.position.set(0, 2.5, 0.55);
    this.root.add(belly);

    // Head
    this.headGroup.position.set(0, 4.45, 0.35);
    const skull = new THREE.Mesh(new THREE.DodecahedronGeometry(0.95, 1), this.furMat);
    skull.castShadow = true;
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.5, 0.65), this.accentMat);
    snout.position.set(0, -0.18, 0.8);

    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: 0xffe499, emissiveIntensity: 0.5 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), eyeMat);
    eyeL.position.set(-0.34, 0.2, 0.78);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.34;

    const earGeom = new THREE.ConeGeometry(0.28, 0.6, 5);
    const earL = new THREE.Mesh(earGeom, this.furMat);
    earL.position.set(-0.68, 0.65, 0.0);
    earL.rotation.z = 0.45;
    const earR = earL.clone();
    earR.position.x = 0.68;
    earR.rotation.z = -0.45;

    // Good halo
    this.haloMesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.85, 0.08, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe680, transparent: true, opacity: 0.85 })
    );
    this.haloMesh.rotation.x = Math.PI / 2;
    this.haloMesh.position.y = 1.35;
    this.haloMesh.visible = false;

    // Evil horns
    const hornMat = new THREE.MeshStandardMaterial({ color: 0x2b1515, emissive: 0x551100, roughness: 0.5 });
    const hornGeom = new THREE.ConeGeometry(0.18, 0.95, 5);
    this.leftHorn = new THREE.Mesh(hornGeom, hornMat);
    this.leftHorn.position.set(-0.45, 0.95, 0.15);
    this.leftHorn.rotation.set(0.25, 0, 0.35);
    this.rightHorn = this.leftHorn.clone();
    this.rightHorn.position.x = 0.45;
    this.rightHorn.rotation.z = -0.35;
    this.leftHorn.visible = false;
    this.rightHorn.visible = false;

    this.headGroup.add(skull, snout, eyeL, eyeR, earL, earR, this.haloMesh, this.leftHorn, this.rightHorn);
    this.root.add(this.headGroup);

    // Limbs
    const limbGeom = new THREE.CylinderGeometry(0.32, 0.26, 2.0, 6);
    const armL = new THREE.Mesh(limbGeom, this.furMat);
    armL.position.y = -0.9;
    armL.castShadow = true;
    this.leftArm.position.set(-1.45, 3.6, 0);
    this.leftArm.add(armL);

    const armR = armL.clone();
    this.rightArm.position.set(1.45, 3.6, 0);
    this.rightArm.add(armR);

    const legGeom = new THREE.CylinderGeometry(0.38, 0.32, 1.7, 6);
    const legL = new THREE.Mesh(legGeom, this.furMat);
    legL.position.y = -0.8;
    legL.castShadow = true;
    this.leftLeg.position.set(-0.65, 1.5, 0);
    this.leftLeg.add(legL);

    const legR = legL.clone();
    this.rightLeg.position.set(0.65, 1.5, 0);
    this.rightLeg.add(legR);

    this.root.add(this.leftArm, this.rightArm, this.leftLeg, this.rightLeg);

    // Conditioning feedback orb above head
    this.feedbackOrb = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.6, 0),
      new THREE.MeshBasicMaterial({ color: 0xffe680, transparent: true, opacity: 0.9 })
    );
    this.feedbackOrb.position.set(0, 6.2, 0);
    this.feedbackOrb.visible = false;
    this.root.add(this.feedbackOrb);

    scene.add(this.root);
  }

  triggerFeedback(type: 'pet' | 'slap'): void {
    this.feedbackTimer = 1.6;
    this.feedbackOrb.visible = true;
    (this.feedbackOrb.material as THREE.MeshBasicMaterial).color.setHex(type === 'pet' ? 0x88ffaa : 0xff4433);
  }

  update(dt: number, elapsed: number, walkingSpeed: number, alignment: number): void {
    const stride = walkingSpeed > 0.2 ? Math.sin(elapsed * 6.5) * 0.55 : Math.sin(elapsed * 1.5) * 0.06;
    this.leftLeg.rotation.x = stride;
    this.rightLeg.rotation.x = -stride;
    this.leftArm.rotation.x = -stride * 0.85;
    this.rightArm.rotation.x = stride * 0.85;

    // Alignment morphing
    const goodColor = new THREE.Color(0xf2e4c9);
    const neutralColor = new THREE.Color(0xb68b5c);
    const evilColor = new THREE.Color(0x2a1b1f);
    if (alignment >= 0) {
      this.furMat.color.copy(neutralColor).lerp(goodColor, alignment);
    } else {
      this.furMat.color.copy(neutralColor).lerp(evilColor, -alignment);
    }

    this.haloMesh.visible = alignment > 0.25;
    this.haloMesh.rotation.z = elapsed * 1.5;

    const showHorns = alignment < -0.25;
    this.leftHorn.visible = showHorns;
    this.rightHorn.visible = showHorns;
    if (showHorns) {
      const s = 0.6 + (-alignment - 0.25) * 1.1;
      this.leftHorn.scale.setScalar(s);
      this.rightHorn.scale.setScalar(s);
    }

    if (this.feedbackTimer > 0) {
      this.feedbackTimer -= dt;
      this.feedbackOrb.position.y = 6.2 + Math.sin(elapsed * 10) * 0.25;
      this.feedbackOrb.rotation.y += dt * 4;
      if (this.feedbackTimer <= 0) this.feedbackOrb.visible = false;
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.root);
  }
}
