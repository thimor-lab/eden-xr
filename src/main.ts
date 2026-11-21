import * as THREE from 'three';
import { SpatialAudio } from './audio/SpatialAudio';
import { AlignmentSystem } from './core/AlignmentSystem';
import { EventBus } from './core/EventBus';
import { GameState } from './core/GameState';
import { SessionLogger } from './core/SessionLogger';
import { CreatureController } from './creature/CreatureController';
import { MiracleEffects } from './miracles/MiracleEffects';
import { MiracleManager } from './miracles/MiracleManager';
import { applyAftertouch, PhysicsProp, PhysicsWorld } from './physics/PhysicsWorld';
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
import { InteractionFeedback } from './xr/InteractionFeedback';
import { VRTutorialPanel } from './xr/VRTutorialPanel';
import { VRWristMenu, WristMenuAction } from './xr/VRWristMenu';
import { WorldLocomotion } from './xr/WorldLocomotion';
import { XRSessionManager } from './xr/XRSessionManager';

async function bootstrap(): Promise<void> {
  const container = document.getElementById('app')!;
  const enterVrBtn = document.getElementById('enter-vr-btn') as HTMLButtonElement;
  const toggleAudioBtn = document.getElementById('toggle-audio-btn') as HTMLButtonElement;
  const resetWorldBtn = document.getElementById('reset-world-btn') as HTMLButtonElement;
  const openLogsBtn = document.getElementById('open-logs-btn') as HTMLButtonElement;
  const logsModal = document.getElementById('logs-modal')!;
  const logsSummaryEl = document.getElementById('logs-summary')!;
  const logsTextEl = document.getElementById('logs-text') as HTMLTextAreaElement;
  const copyLogsBtn = document.getElementById('copy-logs-btn') as HTMLButtonElement;
  const downloadLogsBtn = document.getElementById('download-logs-btn') as HTMLButtonElement;
  const clearLogsBtn = document.getElementById('clear-logs-btn') as HTMLButtonElement;
  const closeLogsBtn = document.getElementById('close-logs-btn') as HTMLButtonElement;
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
  const logger = new SessionLogger(500);
  logger.installGlobalErrorHooks();
  logger.info('app', 'EdenXR bootstrap start');

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
  // Keep godRig at identity in Desktop mode so camera.position is true world space!
  godRig.position.set(0, 0, 0);
  godRig.rotation.set(0, 0, 0);
  godRig.scale.setScalar(1);
  const gestureRecognizer = new GestureRecognizer(scene);
  const feedback = new InteractionFeedback(scene, terrain);
  const wristMenu = new VRWristMenu(godRig);
  const tutorialPanel = new VRTutorialPanel(godRig);
  const tutorialProgress = { moved: false, zoomed: false, openedMenu: false, interacted: false };
  const terrainRaycaster = new THREE.Raycaster();

  function raycastTerrainWorld(origin: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 | null {
    terrainRaycaster.set(origin, dir.clone().normalize());
    const hits = terrainRaycaster.intersectObject(terrain.mesh, false);
    if (hits.length > 0) return hits[0].point;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -2);
    const out = new THREE.Vector3();
    return terrainRaycaster.ray.intersectPlane(plane, out) ? out : null;
  }

  function handleWristMenuAction(action: WristMenuAction): void {
    audio.playGrab(camera.position);
    if (action === 'jump_home') {
      locomotion.swoopTo(PLAYER_VILLAGE_POS, 7.5);
    } else if (action === 'jump_rival') {
      locomotion.swoopTo(RIVAL_VILLAGE_POS, 8.0);
    } else if (action === 'jump_creature') {
      locomotion.swoopTo(creature.position, 5.5);
    } else if (action === 'unleash') {
      creature.unleash();
    } else if (action === 'toggle_nav') {
      const mode = locomotion.toggleNavMode();
      bus.emit('toast:show', {
        message: mode === 'world-pull' ? 'Nav: Diorama World-Pull' : 'Nav: Point-to-Glide',
        durationMs: 1800,
      });
    }
  }

  function handlePropGrabbed(prop: PhysicsProp, justUprooted: boolean): void {
    tutorialProgress.interacted = true;
    if (justUprooted) {
      feedback.spawnUprootBurst(prop.mesh.position);
      audio.playUproot(prop.mesh.position);
      bus.emit('toast:show', {
        message: 'Tree uprooted! Drop it into the Granary for +45 Wood.',
        durationMs: 2000,
      });
    } else {
      audio.playGrab(prop.mesh.position);
    }
  }

  function adjustReleaseVelocity(prop: PhysicsProp, rawVel: THREE.Vector3): THREE.Vector3 {
    const pos = prop.mesh.position;
    if (prop.kind === 'rock' || prop.kind === 'fireball') {
      const targets = rivalVillage.myBuildings.filter((b) => !b.destroyed).map((b) => b.position);
      return applyAftertouch(pos, rawVel, targets, 0.3);
    }
    if (prop.kind === 'tree' || prop.kind === 'wood' || prop.kind === 'food') {
      const targets: THREE.Vector3[] = [];
      const granary = buildings.findGranary('player');
      if (granary) targets.push(granary.position);
      for (const b of playerVillage.myBuildings) {
        if (b.progress < 1 && !b.destroyed) targets.push(b.position);
      }
      return applyAftertouch(pos, rawVel, targets, 0.35);
    }
    if (prop.kind === 'villager') {
      if (rawVel.length() > 11) {
        alignment.shift(-0.08, 'Hurled Villager');
        bus.emit('toast:show', { message: 'You hurled a villager! (-Evil)', durationMs: 1800 });
      } else {
        // Gentle drop near scaffold or Totem rewards the player
        const nearScaffold = playerVillage.myBuildings.find(
          (b) => b.progress < 1 && !b.destroyed && b.position.distanceTo(pos) < 8
        );
        if (nearScaffold) {
          buildings.addProgress(nearScaffold, 0.25);
          alignment.shift(0.04, 'Assigned Builder');
          bus.emit('toast:show', { message: 'Villager assigned to build!', durationMs: 1600 });
        } else if (pos.distanceTo(playerVillage.totemPos) < 8) {
          gameState.addBelief(12);
          bus.emit('toast:show', { message: 'Villager inspired to worship! +12 Belief', durationMs: 1600 });
        }
      }
    }
    return rawVel;
  }

  function tryPickupVillager(worldPos: THREE.Vector3): PhysicsProp | null {
    if (!influenceRing.isInside(worldPos)) return null;
    for (const v of playerVillage.villagers.agents) {
      if (v.position.distanceTo(worldPos) < 2.6) {
        return props.spawnVillagerProp(v.position.clone().add(new THREE.Vector3(0, 1.2, 0)));
      }
    }
    return null;
  }

  const xrManager = new XRSessionManager(renderer, enterVrBtn, (inVR) => {
    overlayEl.style.display = inVR ? 'none' : 'flex';
    if (inVR) {
      logger.vrEntered = true;
      const session = renderer.xr.getSession();
      const features = (session as unknown as { enabledFeatures?: string[] })?.enabledFeatures ?? [];
      logger.event('xr', 'VR session started', { enabledFeatures: features });
      camera.position.set(0, 0, 0);
      camera.rotation.set(0, 0, 0);
      locomotion.resetView();
      tutorialPanel.resetForVRSession();
    } else {
      logger.event('xr', 'VR session ended');
      godRig.position.set(0, 0, 0);
      godRig.rotation.set(0, 0, 0);
      godRig.scale.setScalar(1);
      tutorialPanel.group.visible = false;
      wristMenu.group.visible = false;
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
      onPropGrabbed: handlePropGrabbed,
      onAdjustReleaseVelocity: adjustReleaseVelocity,
      tryPickupVillager,
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
    if (xrManager.inVR) {
      locomotion.resetView();
    }
    logger.event('world', 'Reset island');
    bus.emit('toast:show', { message: 'Island of Eden reset!', durationMs: 1800 });
  });

  // QA Logs Modal Controls
  function refreshLogsModal(): void {
    const exp = logger.exportObject();
    logsSummaryEl.textContent = `QA Logs · Entries: ${exp.summary.totalEntries} · Errors: ${exp.summary.errorCount} · Max Joints L:${exp.summary.maxLeftJoints} R:${exp.summary.maxRightJoints}`;
    logsTextEl.value = logger.toJSON(true);
  }

  openLogsBtn.addEventListener('click', () => {
    refreshLogsModal();
    logsModal.style.display = 'flex';
  });
  closeLogsBtn.addEventListener('click', () => {
    logsModal.style.display = 'none';
  });
  clearLogsBtn.addEventListener('click', () => {
    logger.clear();
    refreshLogsModal();
  });
  copyLogsBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(logger.toJSON(true));
      bus.emit('toast:show', { message: 'QA Log JSON copied to clipboard!', durationMs: 1800 });
    } catch {
      logsTextEl.select();
      document.execCommand('copy');
      bus.emit('toast:show', { message: 'QA Log selected & copied!', durationMs: 1800 });
    }
  });
  downloadLogsBtn.addEventListener('click', () => {
    const blob = new Blob([logger.toJSON(true)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eden-xr-qa-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
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
    const side = hand.handedness;
    if (!hand.tracked) {
      feedback.setHover(side, null, 1, 'none', elapsedSec);
      feedback.setAimRay(side, null, null);
      return false;
    }

    const isGrasping = hand.isPinching || hand.isGrabbing;
    const wasGrasping = hand.wasPinching || hand.wasGrabbing;
    const grabRadius = Math.max(2.4, godRig.scale.x * 0.38);
    const rayMaxDist = Math.max(22, godRig.scale.x * 4.5);

    // 0. If a Miracle or Leash is armed from the Left-Palm Wrist Menu, project ground reticle on right hand!
    if (side === 'right' && wristMenu.armedAction && !wristMenu.isOpen) {
      const aimHit = raycastTerrainWorld(hand.pinchWorldPos, hand.aimDirectionWorld);
      if (aimHit) {
        const isLeash = wristMenu.armedAction === 'leash';
        const allowed = isLeash || wristMenu.armedAction === 'fireball' || influenceRing.isInside(aimHit);
        feedback.setHover(side, aimHit, isLeash ? 2.4 : 2.0, allowed ? 'special' : 'blocked', elapsedSec);
        feedback.setAimRay(
          side,
          hand.pinchWorldPos,
          aimHit,
          new THREE.Color(isLeash ? 0x66f0ff : 0xffe488)
        );

        if (hand.isPinching && !hand.wasPinching) {
          const armed = wristMenu.armedAction;
          if (armed === 'leash') {
            creature.tieLeashTo(aimHit, playerVillage, rivalVillage);
          } else if (armed) {
            const vel =
              armed === 'fireball'
                ? aimHit.clone().sub(hand.pinchWorldPos).normalize().multiplyScalar(28)
                : null;
            miracleManager.tryCast(
              armed,
              armed === 'fireball' ? hand.pinchWorldPos : aimHit,
              vel,
              playerVillage,
              rivalVillage
            );
          }
          wristMenu.armedAction = null;
          feedback.setAimRay(side, null, null);
          return true;
        }
        return false;
      }
    }

    // 1. Direct Creature Petting / Slapping with open palm
    if (hand.isOpenPalm && !heldProps[side]) {
      creature.checkHandConditioning(hand.palmWorldPos, hand.velocityWorld.length(), elapsedSec);
    }

    // 2. 3D Miracle Gesture Drawing when pointing with index finger
    if (hand.isPointing && !heldProps[side] && !grabbingTotem[side]) {
      feedback.setHover(side, null, 1, 'none', elapsedSec);
      feedback.setAimRay(side, null, null);
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
        const throwVel = match.type === 'fireball' ? hand.peakVelocityWorld.clone().multiplyScalar(1.4) : null;
        miracleManager.tryCast(match.type, castPos, throwVel, playerVillage, rivalVillage);
      }
    }

    // 3. Holding the Creature Leash in VR
    if (creature.leashHeldByHand === side) {
      feedback.setHover(side, null, 1, 'none', elapsedSec);
      feedback.setAimRay(side, null, null);
      if (isGrasping) {
        creature.updateHeldLeash(hand.pinchWorldPos);
        return true;
      } else {
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
      feedback.setHover(side, playerVillage.totemPos, 2.2, 'special', elapsedSec);
      feedback.setAimRay(side, null, null);
      if (isGrasping) {
        playerVillage.adjustTotemByWorldY(hand.pinchWorldPos.y);
        return true;
      } else {
        grabbingTotem[side] = false;
      }
    }

    // 5. Holding a Physics Prop (with smooth magnetic follow + peak-velocity throw + arc preview!)
    const held = heldProps[side];
    if (held) {
      feedback.setHover(side, null, 1, 'none', elapsedSec);
      feedback.setAimRay(side, null, null);
      if (isGrasping) {
        physics.moveGrabbedProp(held, hand.pinchWorldPos, 0.42);
        const previewVel = adjustReleaseVelocity(held, hand.peakVelocityWorld.clone().multiplyScalar(1.4));
        feedback.setThrowArc(held.mesh.position, previewVel);
        return true;
      } else {
        const releaseVel = adjustReleaseVelocity(held, hand.peakVelocityWorld.clone().multiplyScalar(1.4));
        physics.releaseProp(held, releaseVel);
        feedback.setThrowArc(null, null);
        heldProps[side] = null;
        return false;
      }
    }

    // 6. Hover detection (Direct proximity first, then Telekinetic Distant Ray-Grab!)
    const totemCenter = playerVillage.totemPos.clone().add(new THREE.Vector3(0, 2.5, 0));
    const nearLeash = hand.pinchWorldPos.distanceTo(creature.collarWorldPos) < grabRadius + 2.8;
    const nearTotem = hand.pinchWorldPos.distanceTo(totemCenter) < grabRadius + 1.5;

    let hoverProp: PhysicsProp | null = null;
    let usedRay = false;
    if (!nearLeash && !nearTotem) {
      hoverProp = physics.findNearestGrabbable(hand.pinchWorldPos, grabRadius);
      if (!hoverProp) {
        hoverProp = physics.findGrabbableAlongRay(hand.pinchWorldPos, hand.aimDirectionWorld, rayMaxDist, 2.2);
        usedRay = hoverProp !== null;
      }
    }

    // Render diegetic hover ring & subtle telekinetic aim ray
    if (nearLeash) {
      feedback.setHover(side, creature.position, 3.2, 'special', elapsedSec);
      feedback.setAimRay(side, null, null);
    } else if (nearTotem) {
      feedback.setHover(side, playerVillage.totemPos, 2.4, 'special', elapsedSec);
      feedback.setAimRay(side, null, null);
    } else if (hoverProp) {
      const allowed = influenceRing.isInside(hoverProp.mesh.position);
      feedback.setHover(side, hoverProp.mesh.position, hoverProp.radius, allowed ? 'prop' : 'blocked', elapsedSec);
      if (usedRay) {
        feedback.setAimRay(side, hand.pinchWorldPos, hoverProp.mesh.position, palette.ringColor);
      } else {
        feedback.setAimRay(side, null, null);
      }
    } else {
      feedback.setHover(side, null, 1, 'none', elapsedSec);
      feedback.setAimRay(side, null, null);
    }

    // 7. Starting a new grab (Creature Leash -> Totem -> Prop -> Villager)
    if (isGrasping && !wasGrasping) {
      if (nearLeash) {
        creature.grabLeash(side, hand.pinchWorldPos);
        return true;
      }
      if (nearTotem) {
        grabbingTotem[side] = true;
        return true;
      }
      if (hoverProp && influenceRing.isInside(hoverProp.mesh.position)) {
        const justUprooted = physics.grabProp(hoverProp, side);
        handlePropGrabbed(hoverProp, justUprooted);
        heldProps[side] = hoverProp;
        return true;
      }
      const villagerProp = tryPickupVillager(hand.pinchWorldPos);
      if (villagerProp) {
        physics.grabProp(villagerProp, side);
        handlePropGrabbed(villagerProp, false);
        heldProps[side] = villagerProp;
        return true;
      }
    }

    return false;
  }

  // Main Animation Loop (WebXR compatible)
  let lastTimeMs = performance.now();
  let telemetryAccum = 0;
  let lastInputSig = '';
  const palette = alignment.samplePalette();

  renderer.setAnimationLoop((timeMs: number, frame?: XRFrame) => {
    const dt = Math.min(0.05, Math.max(0.001, (timeMs - lastTimeMs) / 1000));
    lastTimeMs = timeMs;
    elapsedSec += dt;

    alignment.samplePalette(palette);

    // XR Hand Tracking & God Locomotion
    // Use native WebXR frame.getViewerPose(refSpace) for exact headset pose in godRig-local space!
    let headLocalPos: THREE.Vector3 | undefined;
    const headForwardLocal = new THREE.Vector3(0, 0, -1);

    try {
      const session = renderer.xr.getSession();
      const refSpace = renderer.xr.getReferenceSpace();

      if (xrManager.inVR && session && frame && refSpace) {
        // Log inputSources whenever devices/hands connect or change
        const sourcesInfo = Array.from(session.inputSources).map((s) => ({
          hand: s.handedness,
          hasHand: Boolean(s.hand),
          hasGrip: Boolean(s.gripSpace),
          profiles: s.profiles,
        }));
        const sig = JSON.stringify(sourcesInfo);
        if (sig !== lastInputSig) {
          lastInputSig = sig;
          logger.event('xr.inputs', 'Input sources changed', { sources: sourcesInfo });
        }

        const viewerPose = frame.getViewerPose(refSpace);
        if (viewerPose) {
          const p = viewerPose.transform.position;
          const o = viewerPose.transform.orientation;
          headLocalPos = new THREE.Vector3(p.x, p.y, p.z);
          const q = new THREE.Quaternion(o.x, o.y, o.z, o.w);
          headForwardLocal.set(0, 0, -1).applyQuaternion(q).normalize();
        }
      }

      handTracker.update(renderer, frame, dt, palette, headLocalPos);
      logger.recordHandCounts(handTracker.left.jointCount, handTracker.right.jointCount);

      if (xrManager.inVR) {
        feedback.updateDesktopCursor(desktopSim.cursorWorldPos, false, elapsedSec, palette);
        feedback.setHover('desktop', null, 1, 'none', elapsedSec);

        const headPos = headLocalPos ?? new THREE.Vector3(0, 1.5, 0);
        tutorialProgress.moved = tutorialProgress.moved || locomotion.hasMovedByNav;
        tutorialProgress.zoomed = tutorialProgress.zoomed || locomotion.hasZoomedByTwoHand;
        tutorialProgress.openedMenu = tutorialProgress.openedMenu || wristMenu.isOpen;

        const pokingTutorial = tutorialPanel.update(
          headPos,
          headForwardLocal,
          handTracker.right,
          handTracker.left,
          tutorialProgress,
          locomotion.navMode,
          dt,
          () => {
            const pinned = wristMenu.togglePinned(headPos, headForwardLocal);
            logger.event('ui.menu', pinned ? 'Pinned menu' : 'Unpinned menu');
          }
        );

        const pokingMenu = wristMenu.update(
          handTracker.left,
          handTracker.right,
          headPos,
          dt,
          (action) => {
            tutorialProgress.interacted = true;
            logger.event('ui.menu', `Poked ${action}`);
            handleWristMenuAction(action);
          }
        );

        const leftBusy = (wristMenu.isOpen && !wristMenu.pinned) || pokingTutorial || processVRHand(handTracker.left);
        const rightBusy = pokingMenu || pokingTutorial || processVRHand(handTracker.right);
        locomotion.update(handTracker.left, handTracker.right, leftBusy, rightBusy, dt);

        // 1Hz QA telemetry snapshot while in VR
        telemetryAccum += dt;
        if (telemetryAccum >= 1.0) {
          telemetryAccum = 0;
          logger.telemetry('vr', {
            head: [Number(headPos.x.toFixed(2)), Number(headPos.y.toFixed(2)), Number(headPos.z.toFixed(2))],
            rig: [
              Number(godRig.position.x.toFixed(1)),
              Number(godRig.position.y.toFixed(1)),
              Number(godRig.position.z.toFixed(1)),
            ],
            scale: Number(godRig.scale.x.toFixed(2)),
            nav: locomotion.navMode,
            menu: { open: wristMenu.isOpen, pinned: wristMenu.pinned, armed: wristMenu.armedAction },
            L: {
              tr: handTracker.left.tracked,
              j: handTracker.left.jointCount,
              dot: Number(handTracker.left.palmDotHead.toFixed(2)),
              up: handTracker.left.isPalmFacingCamera,
              pinch: handTracker.left.isPinching,
              grab: handTracker.left.isGrabbing,
            },
            R: {
              tr: handTracker.right.tracked,
              j: handTracker.right.jointCount,
              pinch: handTracker.right.isPinching,
              grab: handTracker.right.isGrabbing,
              point: handTracker.right.isPointing,
            },
          });
        }
      } else {
        desktopSim.update(dt, false);
        feedback.updateDesktopCursor(desktopSim.cursorWorldPos, true, elapsedSec, palette);
        const heldDesktop = desktopSim.getHeldProp();
        if (heldDesktop) {
          feedback.setHover('desktop', null, 1, 'none', elapsedSec);
          const previewVel = adjustReleaseVelocity(heldDesktop, desktopSim.getThrowVelocity());
          feedback.setThrowArc(heldDesktop.mesh.position, previewVel);
        } else {
          feedback.setThrowArc(null, null);
          const hover = physics.findNearestGrabbable(desktopSim.cursorWorldPos, 3.2);
          if (hover) {
            const allowed = influenceRing.isInside(hover.mesh.position);
            feedback.setHover('desktop', hover.mesh.position, hover.radius, allowed ? 'prop' : 'blocked', elapsedSec);
          } else {
            feedback.setHover('desktop', null, 1, 'none', elapsedSec);
          }
        }
      }
    } catch (err) {
      logger.error('xr.loop', err);
    }

    // Simulation step
    physics.step(dt);
    miracleEffects.checkGranaryDeposits(playerVillage);
    buildings.update(dt, elapsedSec);
    feedback.update(dt);
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
      openLogsBtn.textContent = `QA Logs (${logger.errorCount} err · ${logger.getEntries().length})`;
    }

    renderer.render(scene, camera);
  });
}

void bootstrap();
