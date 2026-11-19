import * as THREE from 'three';
import { SpatialAudio } from './audio/SpatialAudio';
import { AlignmentSystem } from './core/AlignmentSystem';
import { EventBus } from './core/EventBus';
import { GameState } from './core/GameState';
import { CreatureController } from './creature/CreatureController';
import { MiracleEffects } from './miracles/MiracleEffects';
import { MiracleManager } from './miracles/MiracleManager';
import { PhysicsProp, PhysicsWorld } from './physics/PhysicsWorld';
import { BuildingSystem } from './villages/BuildingSystem';
import { Village } from './villages/Village';
import { InfluenceRing } from './world/InfluenceRing';
import { InteractableProps } from './world/InteractableProps';
import { IslandTerrain, PLAYER_VILLAGE_POS, RIVAL_VILLAGE_POS } from './world/IslandTerrain';
import { OceanShader } from './world/OceanShader';
import { SkyAtmosphere } from './world/SkyAtmosphere';
import { DesktopSimulator } from './xr/DesktopSimulator';
import { GestureRecognizer } from './xr/GestureRecognizer';
import { HandState, HandTracker } from './xr/HandTracker';
import { WorldLocomotion } from './xr/WorldLocomotion';
import { XRSessionManager } from './xr/XRSessionManager';

async function bootstrap(): Promise<void> {
  const container = document.getElementById('app')!;
  const enterVrBtn = document.getElementById('enter-vr-btn') as HTMLButtonElement;
  const toggleAudioBtn = document.getElementById('toggle-audio-btn') as HTMLButtonElement;
  const resetWorldBtn = document.getElementById('reset-world-btn') as HTMLButtonElement;
  const overlayEl = document.getElementById('overlay')!;
  const toastEl = document.getElementById('toast')!;

  const alignmentLabelEl = document.getElementById('alignment-label')!;
  const alignmentBarEl = document.getElementById('alignment-bar')!;
  const manaValEl = document.getElementById('mana-val')!;
  const manaBarEl = document.getElementById('mana-bar')!;
  const beliefValEl = document.getElementById('belief-val')!;
  const granaryValEl = document.getElementById('granary-val')!;
  const rivalValEl = document.getElementById('rival-val')!;
  const creatureValEl = document.getElementById('creature-val')!;

  // Renderer & Scene
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const godRig = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.05, 800);
  godRig.add(camera);
  scene.add(godRig);

  // Core systems
  const bus = new EventBus();
  const alignment = new AlignmentSystem(bus);
  const gameState = new GameState(bus);
  const audio = new SpatialAudio();

  // Toast helper
  let toastTimeout: number | undefined;
  bus.on('toast:show', ({ message, durationMs }) => {
    toastEl.textContent = message;
    toastEl.classList.add('visible');
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => {
      toastEl.classList.remove('visible');
    }, durationMs ?? 2400);
  });

  // World & Physics
  const terrain = new IslandTerrain();
  scene.add(terrain.mesh);

  const ocean = new OceanShader();
  scene.add(ocean.mesh);

  const sky = new SkyAtmosphere(scene);
  const influenceRing = new InfluenceRing(PLAYER_VILLAGE_POS, terrain);
  scene.add(influenceRing.mesh);

  const physics = new PhysicsWorld(scene, terrain, bus);
  await physics.init();

  const props = new InteractableProps(terrain, physics);
  props.populateIsland();

  // Villages
  const buildings = new BuildingSystem(scene, terrain, bus);
  const playerVillage = new Village(scene, terrain, buildings, bus, {
    id: 'player',
    center: PLAYER_VILLAGE_POS,
    villagerCount: 16,
  });
  const rivalVillage = new Village(scene, terrain, buildings, bus, {
    id: 'rival',
    center: RIVAL_VILLAGE_POS,
    villagerCount: 14,
  });

  // Miracles
  const miracleEffects = new MiracleEffects(scene, terrain, physics, props, buildings, alignment, gameState, bus);
  const miracleManager = new MiracleManager(gameState, influenceRing, miracleEffects, bus);

  // Creature
  const creature = new CreatureController(scene, terrain, buildings, alignment, gameState, bus);

  // XR & Desktop Input
  const handTracker = new HandTracker(godRig);
  const locomotion = new WorldLocomotion(godRig, terrain);
  const gestureRecognizer = new GestureRecognizer(scene);

  const xrManager = new XRSessionManager(renderer, enterVrBtn, (inVR) => {
    overlayEl.style.display = inVR ? 'none' : 'flex';
    if (inVR) {
      locomotion.resetView();
    }
  });

  let elapsedSec = 0;

  const desktopSim = new DesktopSimulator(
    renderer.domElement,
    camera,
    terrain,
    physics,
    gestureRecognizer,
    playerVillage,
    {
      onCastMiracle: (type, pos) => {
        miracleManager.tryCast(type, pos, null, playerVillage, rivalVillage);
      },
      onPetCreature: () => creature.condition('pet', elapsedSec),
      onSlapCreature: () => creature.condition('slap', elapsedSec),
      onToggleTotem: () => {
        const next = playerVillage.worshipRatio > 0.7 ? 0.2 : playerVillage.worshipRatio + 0.35;
        playerVillage.setTotemRatio(next);
        bus.emit('toast:show', {
          message: `Totem Worship set to ${Math.round(playerVillage.worshipRatio * 100)}%`,
          durationMs: 1500,
        });
      },
      onLeashCreature: (targetPos) => {
        creature.tieLeashTo(targetPos, playerVillage, rivalVillage);
      },
      onUnleashCreature: () => {
        creature.unleash();
      },
      getCreaturePos: () => creature.position.clone(),
    }
  );

  // Event wiring
  bus.on('building:completed', ({ villageId, impressiveness }) => {
    if (villageId === 'player') {
      gameState.addImpressiveness(impressiveness);
      gameState.addBelief(35);
      alignment.shift(0.08, 'Building Completed');
      creature.brain.observePlayerAction('bring_wood');
      bus.emit('toast:show', {
        message: `Building completed! +${impressiveness} Impressiveness`,
        durationMs: 2200,
      });
    }
  });

  bus.on('object:thrown', ({ kind, position }) => {
    if (kind === 'rock' && position.distanceTo(rivalVillage.center) < 48) {
      creature.brain.observePlayerAction('throw_rock_rival');
    }
  });

  bus.on('object:impact', ({ kind, position, impulse }) => {
    miracleEffects.handleImpact(kind, position, impulse, playerVillage, rivalVillage);
    audio.playImpact(position, kind === 'fireball' || impulse > 18);
  });

  bus.on('miracle:cast', ({ type, position }) => {
    audio.playMiracle(type, position);
    if (type === 'food' || type === 'rain') {
      creature.brain.observePlayerAction('feed_village');
    } else if (type === 'fireball' || type === 'lightning') {
      creature.brain.observePlayerAction('throw_rock_rival');
    }
  });

  bus.on('creature:conditioned', ({ type }) => {
    audio.playCreature(type);
  });

  // UI Buttons
  toggleAudioBtn.addEventListener('click', () => {
    const on = audio.toggle();
    toggleAudioBtn.textContent = on ? 'Audio: On (3D Spatial)' : 'Audio: Off (Click to Enable)';
  });

  resetWorldBtn.addEventListener('click', () => {
    physics.clearAll();
    props.populateIsland();
    alignment.reset();
    gameState.reset();
    playerVillage.setTotemRatio(0.45);
    locomotion.resetView();
    bus.emit('toast:show', { message: 'Island of Eden reset!', durationMs: 1800 });
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Per-hand VR interaction state
  const heldProps: Record<'left' | 'right', PhysicsProp | null> = { left: null, right: null };
  const grabbingTotem: Record<'left' | 'right', boolean> = { left: false, right: false };
  let drawingHand: 'left' | 'right' | null = null;

  function processVRHand(hand: HandState): boolean {
    if (!hand.tracked) return false;
    const side = hand.handedness;
    const isGrasping = hand.isPinching || hand.isGrabbing;
    const wasGrasping = hand.wasPinching || hand.wasGrabbing;
    const grabRadius = Math.max(2.2, godRig.scale.x * 0.35);

    // 1. Direct Creature Petting / Slapping with open palm
    if (hand.isOpenPalm && !heldProps[side]) {
      creature.checkHandConditioning(hand.palmWorldPos, hand.velocityWorld.length(), elapsedSec);
    }

    // 2. 3D Miracle Gesture Drawing when pointing with index finger
    if (hand.isPointing && !heldProps[side] && !grabbingTotem[side]) {
      if (drawingHand === null) {
        drawingHand = side;
        gestureRecognizer.beginStroke(hand.indexTipWorldPos);
      } else if (drawingHand === side) {
        gestureRecognizer.addPoint(hand.indexTipWorldPos);
      }
      return true;
    } else if (drawingHand === side) {
      drawingHand = null;
      const match = gestureRecognizer.endStroke(camera);
      if (match) {
        const castPos = hand.indexTipWorldPos.clone();
        const throwVel = match.type === 'fireball' ? hand.velocityWorld.clone().multiplyScalar(1.4) : null;
        miracleManager.tryCast(match.type, castPos, throwVel, playerVillage, rivalVillage);
      }
    }

    // 3. Holding the Creature Leash in VR
    if (creature.leashHeldByHand === side) {
      if (isGrasping) {
        creature.updateHeldLeash(hand.pinchWorldPos);
        return true;
      } else {
        // Release on Creature itself -> unleash; release anywhere else -> tie leash there!
        if (hand.pinchWorldPos.distanceTo(creature.interactionCenter) < 4.5) {
          creature.unleash();
        } else {
          creature.tieLeashTo(hand.pinchWorldPos, playerVillage, rivalVillage);
        }
        return false;
      }
    }

    // 4. Grabbing the Player Village Totem to dial worship
    if (grabbingTotem[side]) {
      if (isGrasping) {
        playerVillage.adjustTotemByWorldY(hand.pinchWorldPos.y);
        return true;
      } else {
        grabbingTotem[side] = false;
      }
    }

    // 5. Holding a Physics Prop
    const held = heldProps[side];
    if (held) {
      if (isGrasping) {
        physics.moveGrabbedProp(held, hand.pinchWorldPos);
        return true;
      } else {
        physics.releaseProp(held, hand.velocityWorld.clone().multiplyScalar(1.35));
        heldProps[side] = null;
        return false;
      }
    }

    // 6. Starting a new grab (Creature Leash -> Totem -> Physics Prop)
    if (isGrasping && !wasGrasping) {
      if (hand.pinchWorldPos.distanceTo(creature.collarWorldPos) < grabRadius + 2.8) {
        creature.grabLeash(side, hand.pinchWorldPos);
        return true;
      }

      const totemCenter = playerVillage.totemPos.clone().add(new THREE.Vector3(0, 2.5, 0));
      if (hand.pinchWorldPos.distanceTo(totemCenter) < grabRadius + 1.5) {
        grabbingTotem[side] = true;
        return true;
      }

      const prop = physics.findNearestGrabbable(hand.pinchWorldPos, grabRadius);
      if (prop && influenceRing.isInside(prop.mesh.position)) {
        physics.grabProp(prop, side);
        heldProps[side] = prop;
        return true;
      }
    }

    return false;
  }

  // Main Animation Loop (WebXR compatible)
  let lastTimeMs = performance.now();
  const palette = alignment.samplePalette();

  renderer.setAnimationLoop((timeMs: number, frame?: XRFrame) => {
    const dt = Math.min(0.05, Math.max(0.001, (timeMs - lastTimeMs) / 1000));
    lastTimeMs = timeMs;
    elapsedSec += dt;

    alignment.samplePalette(palette);

    // XR Hand Tracking & God Locomotion
    handTracker.update(renderer, frame, dt, palette);
    if (xrManager.inVR) {
      const leftBusy = processVRHand(handTracker.left);
      const rightBusy = processVRHand(handTracker.right);
      locomotion.update(handTracker.left, handTracker.right, leftBusy, rightBusy);
    } else {
      desktopSim.update(dt, false);
    }

    // Simulation step
    physics.step(dt);
    miracleEffects.checkGranaryDeposits(playerVillage);
    buildings.update(dt, elapsedSec);
    playerVillage.update(dt, elapsedSec, gameState, palette);
    rivalVillage.update(dt, elapsedSec, gameState, palette);
    miracleEffects.update(dt);

    const lookAtPos = xrManager.inVR
      ? handTracker.right.tracked
        ? handTracker.right.palmWorldPos
        : handTracker.left.palmWorldPos
      : desktopSim.cursorWorldPos;
    creature.update(dt, elapsedSec, playerVillage, rivalVillage, lookAtPos);

    // World atmosphere & shaders
    sky.update(dt, palette, alignment.alignment);
    ocean.update(dt, palette.sunColor, alignment.alignment);
    influenceRing.update(dt, gameState.influenceRadius, palette.ringColor);
    audio.updateListener(camera);

    // Update Desktop HUD
    if (!xrManager.inVR) {
      alignmentLabelEl.textContent = `Alignment: ${alignment.label} (${Math.round(alignment.alignment * 100)}%)`;
      alignmentBarEl.style.width = `${Math.round(alignment.normalized * 100)}%`;
      alignmentBarEl.style.background =
        alignment.alignment >= 0.2 ? '#7be8ff' : alignment.alignment <= -0.2 ? '#ff4a33' : '#d4b872';
      manaValEl.textContent = `${Math.round(gameState.prayerPower)} / ${gameState.maxPrayerPower}`;
      manaBarEl.style.width = `${Math.round((gameState.prayerPower / gameState.maxPrayerPower) * 100)}%`;
      beliefValEl.textContent = `${Math.round(gameState.playerBelief)} (Impr. ${Math.round(gameState.playerImpressiveness)})`;
      granaryValEl.textContent = `Food ${Math.round(gameState.villageFood)} · Wood ${Math.round(gameState.villageWood)}`;
      rivalValEl.textContent = gameState.rivalConverted
        ? `Converted (${gameState.victoryMethod})!`
        : `Unconverted (${Math.round(gameState.rivalConversion)}%)`;
      creatureValEl.textContent = creature.brain.moodLabel;
    }

    renderer.render(scene, camera);
  });
}

void bootstrap();
