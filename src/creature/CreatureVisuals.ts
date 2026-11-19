import * as THREE from 'three';

/**
 * Articulated stylized Guardian Titan (~8.5m tall) that morphs visually with its alignment
 * (radiant golden fur + halo for Good ↔ shadowy obsidian fur + growing horns for Evil),
 * with a subtle luminous ground ring so it is always easy to spot from god-height.
 */
export class CreatureVisuals {
  public readonly root = new THREE.Group();
  public readonly headGroup = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly tailGroup = new THREE.Group();

  private readonly furMat: THREE.MeshStandardMaterial;
  private readonly maneMat: THREE.MeshStandardMaterial;
  private readonly accentMat: THREE.MeshStandardMaterial;
  private readonly groundRing: THREE.Mesh;
  private readonly haloMesh: THREE.Mesh;
  private readonly leftHorn: THREE.Mesh;
  private readonly rightHorn: THREE.Mesh;
  private readonly feedbackOrb: THREE.Mesh;
  private feedbackTimer = 0;

  constructor(scene: THREE.Scene) {
    this.furMat = new THREE.MeshStandardMaterial({ color: 0xc2935e, roughness: 0.82, flatShading: true });
    this.maneMat = new THREE.MeshStandardMaterial({ color: 0x7c502b, roughness: 0.88, flatShading: true });
    this.accentMat = new THREE.MeshStandardMaterial({ color: 0xf0dfc2, roughness: 0.72, flatShading: true });

    const scale = 1.65;
    const bodyGroup = new THREE.Group();
    bodyGroup.scale.setScalar(scale);

    // Torso & broad shoulders
    const torso = new THREE.Mesh(new THREE.DodecahedronGeometry(1.45, 1), this.furMat);
    torso.scale.set(1.12, 1.38, 0.92);
    torso.position.y = 2.75;
    torso.castShadow = true;
    bodyGroup.add(torso);

    const belly = new THREE.Mesh(new THREE.DodecahedronGeometry(1.05, 1), this.accentMat);
    belly.position.set(0, 2.55, 0.58);
    bodyGroup.add(belly);

    const mane = new THREE.Mesh(new THREE.DodecahedronGeometry(1.38, 0), this.maneMat);
    mane.scale.set(1.15, 0.85, 1.0);
    mane.position.set(0, 3.85, 0.15);
    mane.castShadow = true;
    bodyGroup.add(mane);

    // Head
    this.headGroup.position.set(0, 4.55, 0.35);
    const skull = new THREE.Mesh(new THREE.DodecahedronGeometry(0.95, 1), this.furMat);
    skull.castShadow = true;
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.52, 0.7), this.accentMat);
    snout.position.set(0, -0.18, 0.82);

    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      emissive: 0xffe499,
      emissiveIntensity: 0.85,
    });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), eyeMat);
    eyeL.position.set(-0.36, 0.22, 0.8);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.36;

    const earGeom = new THREE.ConeGeometry(0.28, 0.65, 5);
    const earL = new THREE.Mesh(earGeom, this.furMat);
    earL.position.set(-0.7, 0.68, 0.0);
    earL.rotation.z = 0.45;
    const earR = earL.clone();
    earR.position.x = 0.7;
    earR.rotation.z = -0.45;

    // Good halo
    this.haloMesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.9, 0.09, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe680, transparent: true, opacity: 0.9 })
    );
    this.haloMesh.rotation.x = Math.PI / 2;
    this.haloMesh.position.y = 1.4;
    this.haloMesh.visible = false;

    // Evil horns
    const hornMat = new THREE.MeshStandardMaterial({ color: 0x2b1515, emissive: 0x661100, roughness: 0.45 });
    const hornGeom = new THREE.ConeGeometry(0.2, 1.05, 5);
    this.leftHorn = new THREE.Mesh(hornGeom, hornMat);
    this.leftHorn.position.set(-0.48, 0.98, 0.15);
    this.leftHorn.rotation.set(0.25, 0, 0.35);
    this.rightHorn = this.leftHorn.clone();
    this.rightHorn.position.x = 0.48;
    this.rightHorn.rotation.z = -0.35;
    this.leftHorn.visible = false;
    this.rightHorn.visible = false;

    this.headGroup.add(skull, snout, eyeL, eyeR, earL, earR, this.haloMesh, this.leftHorn, this.rightHorn);
    bodyGroup.add(this.headGroup);

    // Limbs
    const limbGeom = new THREE.CylinderGeometry(0.36, 0.28, 2.1, 6);
    const armL = new THREE.Mesh(limbGeom, this.furMat);
    armL.position.y = -0.95;
    armL.castShadow = true;
    this.leftArm.position.set(-1.55, 3.65, 0);
    this.leftArm.add(armL);

    const armR = armL.clone();
    this.rightArm.position.set(1.55, 3.65, 0);
    this.rightArm.add(armR);

    const legGeom = new THREE.CylinderGeometry(0.42, 0.34, 1.75, 6);
    const legL = new THREE.Mesh(legGeom, this.furMat);
    legL.position.y = -0.82;
    legL.castShadow = true;
    this.leftLeg.position.set(-0.68, 1.55, 0);
    this.leftLeg.add(legL);

    const legR = legL.clone();
    this.rightLeg.position.set(0.68, 1.55, 0);
    this.rightLeg.add(legR);

    // Tail
    const tailMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 1.8, 6), this.maneMat);
    tailMesh.rotation.x = -0.7;
    tailMesh.position.set(0, 0, -0.7);
    this.tailGroup.position.set(0, 1.7, -1.05);
    this.tailGroup.add(tailMesh);

    bodyGroup.add(this.leftArm, this.rightArm, this.leftLeg, this.rightLeg, this.tailGroup);
    this.root.add(bodyGroup);

    // Luminous ground spirit-ring so the Creature is always easy to spot in VR
    this.groundRing = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3.25, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffe07d,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
      })
    );
    this.groundRing.rotation.x = -Math.PI / 2;
    this.groundRing.position.y = 0.25;
    this.root.add(this.groundRing);

    // Conditioning feedback orb above head
    this.feedbackOrb = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.95, 0),
      new THREE.MeshBasicMaterial({ color: 0xffe680, transparent: true, opacity: 0.92 })
    );
    this.feedbackOrb.position.set(0, 10.2, 0);
    this.feedbackOrb.visible = false;
    this.root.add(this.feedbackOrb);

    scene.add(this.root);
  }

  triggerFeedback(type: 'pet' | 'slap'): void {
    this.feedbackTimer = 1.8;
    this.feedbackOrb.visible = true;
    (this.feedbackOrb.material as THREE.MeshBasicMaterial).color.setHex(type === 'pet' ? 0x88ffaa : 0xff4433);
  }

  update(dt: number, elapsed: number, walkingSpeed: number, alignment: number): void {
    const stride = walkingSpeed > 0.2 ? Math.sin(elapsed * 5.8) * 0.55 : Math.sin(elapsed * 1.8) * 0.08;
    this.leftLeg.rotation.x = stride;
    this.rightLeg.rotation.x = -stride;
    this.leftArm.rotation.x = -stride * 0.85;
    this.rightArm.rotation.x = stride * 0.85;
    this.tailGroup.rotation.y = Math.sin(elapsed * 4.0) * 0.35;

    // Alignment morphing
    const goodColor = new THREE.Color(0xf6ead2);
    const neutralColor = new THREE.Color(0xc2935e);
    const evilColor = new THREE.Color(0x2a1b1f);
    if (alignment >= 0) {
      this.furMat.color.copy(neutralColor).lerp(goodColor, alignment);
      (this.groundRing.material as THREE.MeshBasicMaterial).color
        .setHex(0xffe07d)
        .lerp(new THREE.Color(0x7be8ff), alignment);
    } else {
      this.furMat.color.copy(neutralColor).lerp(evilColor, -alignment);
      (this.groundRing.material as THREE.MeshBasicMaterial).color
        .setHex(0xffe07d)
        .lerp(new THREE.Color(0xff3a22), -alignment);
    }
    (this.groundRing.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(elapsed * 3) * 0.18;

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
      this.feedbackOrb.position.y = 10.2 + Math.sin(elapsed * 10) * 0.35;
      this.feedbackOrb.rotation.y += dt * 4;
      if (this.feedbackTimer <= 0) this.feedbackOrb.visible = false;
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.root);
  }
}
