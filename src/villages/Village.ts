import * as THREE from 'three';
import { AlignmentPalette } from '../core/AlignmentSystem';
import { EventBus } from '../core/EventBus';
import { GameState } from '../core/GameState';
import { IslandTerrain } from '../world/IslandTerrain';
import { Building, BuildingSystem } from './BuildingSystem';
import { VillagerAI } from './VillagerAI';

/**
 * Represents a settlement (Player Village or Rival Village) with its Totem,
 * Temple, Houses, Scaffolds, and autonomous Villagers.
 */
export class Village {
  public readonly id: 'player' | 'rival';
  public readonly center: THREE.Vector3;
  public readonly totemPos: THREE.Vector3;
  public readonly totemGroup = new THREE.Group();
  public readonly totemPillar: THREE.Mesh;
  public readonly prayerOrb: THREE.Mesh;
  public readonly villagers: VillagerAI;

  /** 0.0 (all build/idle) to 1.0 (all worship at Totem) */
  public worshipRatio = 0.45;
  public activeWorshippers = 0;

  private readonly templeMat: THREE.MeshStandardMaterial;
  private readonly orbMat: THREE.MeshStandardMaterial;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: IslandTerrain,
    private readonly buildings: BuildingSystem,
    private readonly bus: EventBus,
    options: { id: 'player' | 'rival'; center: THREE.Vector3; villagerCount: number }
  ) {
    this.id = options.id;
    this.center = options.center.clone();
    this.center.y = terrain.getHeightAt(this.center.x, this.center.z);

    // Village Totem (physically grabbable to control worship!)
    this.totemPos = new THREE.Vector3(this.center.x + 4.5, 0, this.center.z + 3.5);
    this.totemPos.y = terrain.getHeightAt(this.totemPos.x, this.totemPos.z);

    this.templeMat = new THREE.MeshStandardMaterial({
      color: options.id === 'player' ? 0xd9cfb8 : 0x9c6e58,
      roughness: 0.75,
      flatShading: true,
    });
    this.orbMat = new THREE.MeshStandardMaterial({
      color: options.id === 'player' ? 0x6ce5ff : 0xff704d,
      emissive: options.id === 'player' ? 0x2688cc : 0xaa2200,
      emissiveIntensity: 0.9,
      roughness: 0.2,
    });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 0.8, 8), this.templeMat);
    base.position.y = 0.4;
    this.totemPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.65, 4.5, 6), this.templeMat);
    this.totemPillar.position.y = 2.2;
    this.totemPillar.castShadow = true;

    this.prayerOrb = new THREE.Mesh(new THREE.OctahedronGeometry(0.85, 1), this.orbMat);
    this.prayerOrb.position.y = 5.4;

    this.totemGroup.position.copy(this.totemPos);
    this.totemGroup.add(base, this.totemPillar, this.prayerOrb);
    this.scene.add(this.totemGroup);

    // Populate starter buildings
    if (this.id === 'player') {
      this.buildings.createBuilding({ villageId: 'player', kind: 'temple', x: this.center.x - 2, z: this.center.z - 2, built: true });
      this.buildings.createBuilding({ villageId: 'player', kind: 'house', x: this.center.x - 8, z: this.center.z + 4, built: true });
      this.buildings.createBuilding({ villageId: 'player', kind: 'granary', x: this.center.x + 8, z: this.center.z - 5, built: true });
      // Two open scaffolds ready for player/villager construction!
      this.buildings.createBuilding({ villageId: 'player', kind: 'house', x: this.center.x - 6, z: this.center.z - 9, built: false });
      this.buildings.createBuilding({ villageId: 'player', kind: 'wonder', x: this.center.x + 2, z: this.center.z - 10, built: false });
    } else {
      this.buildings.createBuilding({ villageId: 'rival', kind: 'temple', x: this.center.x, z: this.center.z, built: true });
      this.buildings.createBuilding({ villageId: 'rival', kind: 'house', x: this.center.x - 7, z: this.center.z + 5, built: true });
      this.buildings.createBuilding({ villageId: 'rival', kind: 'house', x: this.center.x + 7, z: this.center.z + 4, built: true });
      this.buildings.createBuilding({ villageId: 'rival', kind: 'granary', x: this.center.x - 5, z: this.center.z - 7, built: true });
      this.buildings.createBuilding({ villageId: 'rival', kind: 'house', x: this.center.x + 6, z: this.center.z - 6, built: true });
    }

    const tunicColor = this.id === 'player' ? 0x3a82d6 : 0xc94a38;
    this.villagers = new VillagerAI(scene, terrain, this.center, tunicColor, options.villagerCount);
  }

  get myBuildings(): Building[] {
    return this.buildings.buildings.filter((b) => b.villageId === this.id);
  }

  setTotemRatio(ratio: number): void {
    this.worshipRatio = Math.max(0, Math.min(1, ratio));
    this.totemPillar.scale.y = 0.55 + this.worshipRatio * 0.95;
    this.totemPillar.position.y = 1.1 + this.worshipRatio * 1.4;
    this.prayerOrb.position.y = 3.2 + this.worshipRatio * 2.8;
  }

  adjustTotemByWorldY(handY: number): void {
    const localY = handY - this.totemPos.y;
    const ratio = THREE.MathUtils.clamp((localY - 1.2) / 4.2, 0, 1);
    this.setTotemRatio(ratio);
  }

  update(dt: number, elapsed: number, gameState: GameState, palette?: AlignmentPalette): void {
    const unfinished = this.myBuildings.filter((b) => b.progress < 1 && !b.destroyed);
    const hasWoodStock = this.id === 'player' && gameState.villageWood > 0;
    this.activeWorshippers = this.villagers.update(
      dt,
      elapsed,
      this.totemPos,
      this.worshipRatio,
      unfinished,
      (b, amt) => {
        const boost = hasWoodStock ? 2.0 : 1.0;
        if (hasWoodStock) gameState.addWood(-dt * 0.8);
        this.buildings.addProgress(b, amt * boost);
      }
    );

    this.prayerOrb.rotation.y += dt * (1.2 + this.worshipRatio * 2.5);
    this.prayerOrb.scale.setScalar(0.75 + 0.35 * (gameState.prayerPower / gameState.maxPrayerPower));

    if (this.id === 'player') {
      // Sync Granary visual piles (golden grain mound + stacked timber)
      this.buildings.syncGranaryStock(
        'player',
        gameState.villageFood / gameState.maxResource,
        gameState.villageWood / gameState.maxResource
      );

      // Gentle villager food consumption; well-fed villagers worship 30% stronger!
      gameState.addFood(-dt * 0.28);
      const fedBonus = gameState.villageFood > 20 ? 1.3 : 0.85;

      // Worshippers generate Prayer Power and gradual Belief!
      const manaGain = (1.1 + this.activeWorshippers * 0.65 * fedBonus) * dt;
      gameState.addPrayerPower(manaGain);
      if (this.activeWorshippers > 0) {
        gameState.addBelief(this.activeWorshippers * 0.22 * fedBonus * dt);
      }

      // Passive peaceful conversion if player Impressiveness is high
      if (gameState.playerImpressiveness >= 85 && !gameState.rivalConverted) {
        const rate = (gameState.playerImpressiveness - 80) * 0.045 * dt;
        gameState.advanceRivalConversion(rate, 'peaceful');
      }

      if (palette) {
        this.templeMat.color.copy(palette.templeColor);
        this.orbMat.color.copy(palette.ringColor);
        this.orbMat.emissive.copy(palette.handEmissive);
      }
    } else if (gameState.rivalConverted) {
      // Converted rival orb glows with player's color
      if (palette) {
        this.orbMat.color.copy(palette.ringColor);
        this.orbMat.emissive.copy(palette.handEmissive);
      }
    }
  }

  dispose(): void {
    this.scene.remove(this.totemGroup);
    this.villagers.dispose(this.scene);
  }
}
