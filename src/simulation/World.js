import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createNoise2D } from 'simplex-noise';
import { UI } from './UI.js';
import { WORLD_SIZE, BIOMES } from './Constants.js';

// Shared geometries and materials for performance
const SharedGeometries = {
  body: {
    sphere: new THREE.SphereGeometry(1, 8, 8),
    torpedo: new THREE.CapsuleGeometry(0.4, 1.2, 4, 8),
    flat: new THREE.SphereGeometry(1, 8, 6),
  },
  eye: new THREE.SphereGeometry(0.15, 6, 6),
  pupil: new THREE.SphereGeometry(0.08, 4, 4),
  limb: new THREE.CapsuleGeometry(0.06, 0.4, 3, 6),
  foot: new THREE.SphereGeometry(0.1, 4, 4),
  fin: new THREE.BoxGeometry(0.02, 0.3, 0.2),
  tailFin: new THREE.BoxGeometry(0.02, 0.25, 0.35),
  jaw: new THREE.BoxGeometry(0.3, 0.08, 0.15),
  tooth: new THREE.ConeGeometry(0.03, 0.1, 3),
  spike: new THREE.ConeGeometry(0.05, 0.25, 3),
  probe: new THREE.CylinderGeometry(0.03, 0.015, 0.5, 4),
};

// Rendering-only creature (mesh wrapper)
class CreatureRenderer {
  constructor(data) {
    this.id = data.id;
    this.data = data;
    this.animTime = 0;
    this.isEating = false;
    this.eatingTimer = 0;

    this.mesh = new THREE.Group();
    this.createMesh(data);
  }

  createMesh(data) {
    // Determine body color based on primary trait
    const bodyColor = this.getBodyColor(data);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.7,
      metalness: 0.1
    });

    // Body shape - simpler selection
    let bodyGeo;
    if (data.speed > 0.5) {
      bodyGeo = SharedGeometries.body.torpedo;
    } else if (data.filterFeeding > 0.4) {
      bodyGeo = SharedGeometries.body.flat;
    } else {
      bodyGeo = SharedGeometries.body.sphere;
    }

    this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    if (data.speed > 0.5) {
      this.bodyMesh.rotation.x = Math.PI / 2; // Point forward
    }
    this.mesh.add(this.bodyMesh);

    // Scale based on size
    const scale = 0.8 + data.size * 1.2;
    this.mesh.scale.set(scale, scale, scale);

    // Create feature groups
    this.eyesGroup = new THREE.Group();
    this.limbsGroup = new THREE.Group();
    this.finsGroup = new THREE.Group();
    this.jawsGroup = new THREE.Group();
    this.armorGroup = new THREE.Group();

    this.mesh.add(this.eyesGroup);
    this.mesh.add(this.limbsGroup);
    this.mesh.add(this.finsGroup);
    this.mesh.add(this.jawsGroup);
    this.mesh.add(this.armorGroup);

    // Build features
    this.buildEyes(data);
    this.buildLimbs(data, bodyColor);
    this.buildFins(data);
    this.buildJaws(data);
    this.buildArmor(data);
    this.buildSpecialFeatures(data);
  }

  getBodyColor(data) {
    // Priority-based coloring
    if (data.toxicity > 0.4) {
      return new THREE.Color(0xff3333); // Bright red = toxic warning
    }
    if (data.predatory > 0.4) {
      return new THREE.Color(0xdd6622); // Orange = predator
    }
    if (data.parasitic > 0.3) {
      return new THREE.Color(0x9944aa); // Purple = parasite
    }
    if (data.scavenging > 0.4) {
      return new THREE.Color(0x886644); // Brown = scavenger
    }
    if (data.coldResistance > 0.4) {
      return new THREE.Color(0x88aacc); // Blue-gray = cold adapted
    }
    if (data.heatResistance > 0.4) {
      return new THREE.Color(0xcc8844); // Tan = heat adapted
    }
    // Default - greenish based on how "herbivore-like"
    const greenness = 0.3 + (1 - data.predatory) * 0.4;
    return new THREE.Color().setHSL(greenness, 0.6, 0.45);
  }

  buildEyes(data) {
    if (data.sight < 0.15) return; // No visible eyes for blind creatures

    const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x111111 });

    // Eye size scales with sight
    const eyeScale = 0.8 + data.sight * 0.6;

    // Two eyes on the front of body
    const eyeSpacing = 0.25;
    const eyeForward = 0.85;
    const eyeHeight = 0.15;

    [-1, 1].forEach((side) => {
      // Eye white
      const eye = new THREE.Mesh(SharedGeometries.eye, eyeWhiteMat);
      eye.position.set(side * eyeSpacing, eyeHeight, eyeForward);
      eye.scale.setScalar(eyeScale);
      this.eyesGroup.add(eye);

      // Pupil
      const pupil = new THREE.Mesh(SharedGeometries.pupil, pupilMat);
      pupil.position.set(side * eyeSpacing, eyeHeight, eyeForward + 0.1 * eyeScale);
      pupil.scale.setScalar(eyeScale);
      pupil.userData.baseX = side * eyeSpacing;
      this.eyesGroup.add(pupil);
    });
  }

  buildLimbs(data, bodyColor) {
    if (data.limbs < 0.25) return;

    const limbMat = new THREE.MeshStandardMaterial({
      color: bodyColor.clone().multiplyScalar(0.75)
    });

    // Number of limbs: 2 for low, 4 for medium, 6 for high
    const limbCount = data.limbs > 0.6 ? 6 : (data.limbs > 0.4 ? 4 : 2);
    const limbLength = 0.5 + data.limbs * 0.4;

    // Create limb pairs symmetrically
    for (let i = 0; i < limbCount; i++) {
      const pairIndex = Math.floor(i / 2);
      const side = (i % 2 === 0) ? -1 : 1;
      const zPos = 0.3 - pairIndex * 0.35; // Front to back

      // Upper limb segment
      const limb = new THREE.Mesh(SharedGeometries.limb, limbMat);
      limb.scale.y = limbLength;
      limb.position.set(side * 0.6, -0.2, zPos);
      limb.rotation.z = side * 0.4; // Angle outward
      limb.rotation.x = 0.3;
      limb.userData.side = side;
      limb.userData.pairIndex = pairIndex;
      this.limbsGroup.add(limb);

      // Foot/paddle
      const foot = new THREE.Mesh(SharedGeometries.foot, limbMat);
      foot.position.set(
        side * (0.6 + limbLength * 0.3),
        -0.2 - limbLength * 0.5,
        zPos
      );
      foot.scale.set(1, 0.6, 1.3); // Flattened paddle shape
      foot.userData.isFootOf = this.limbsGroup.children.length - 1;
      this.limbsGroup.add(foot);
    }
  }

  buildFins(data) {
    if (data.speed < 0.25 || data.limbs > 0.5) return; // No fins if has limbs

    const finMat = new THREE.MeshStandardMaterial({
      color: 0x4488aa,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });

    // Dorsal fin (top)
    const dorsalFin = new THREE.Mesh(SharedGeometries.fin, finMat);
    dorsalFin.position.set(0, 0.7, 0);
    dorsalFin.scale.y = 0.5 + data.speed * 0.8;
    this.finsGroup.add(dorsalFin);

    // Tail fin
    const tailFin = new THREE.Mesh(SharedGeometries.tailFin, finMat);
    tailFin.position.set(0, 0, -1.0);
    tailFin.scale.set(1, 0.8 + data.speed * 0.5, 1);
    this.finsGroup.add(tailFin);

    // Side fins (pectoral)
    [-1, 1].forEach((side) => {
      const sideFin = new THREE.Mesh(SharedGeometries.fin, finMat);
      sideFin.position.set(side * 0.5, 0, 0.2);
      sideFin.rotation.z = side * 0.8;
      sideFin.rotation.y = side * 0.3;
      sideFin.scale.set(1, 0.6, 1.2);
      this.finsGroup.add(sideFin);
    });
  }

  buildJaws(data) {
    if (data.jaws < 0.2) return;

    const jawMat = new THREE.MeshStandardMaterial({ color: 0xaa2222 });
    const toothMat = new THREE.MeshStandardMaterial({ color: 0xffffee });

    const jawScale = 0.8 + data.jaws * 0.6;

    // Upper jaw
    const upperJaw = new THREE.Mesh(SharedGeometries.jaw, jawMat);
    upperJaw.position.set(0, 0.06, 1.0);
    upperJaw.scale.setScalar(jawScale);
    upperJaw.userData.restY = 0.06;
    this.jawsGroup.add(upperJaw);

    // Lower jaw
    const lowerJaw = new THREE.Mesh(SharedGeometries.jaw, jawMat);
    lowerJaw.position.set(0, -0.06, 1.0);
    lowerJaw.scale.setScalar(jawScale);
    lowerJaw.userData.restY = -0.06;
    this.jawsGroup.add(lowerJaw);

    // Teeth for predators with strong jaws
    if (data.jaws > 0.4 && data.predatory > 0.3) {
      const teethCount = Math.floor(2 + data.jaws * 3);
      for (let i = 0; i < teethCount; i++) {
        const xPos = (i - (teethCount - 1) / 2) * 0.08;

        // Upper teeth (point down)
        const upperTooth = new THREE.Mesh(SharedGeometries.tooth, toothMat);
        upperTooth.position.set(xPos, 0, 1.05);
        upperTooth.rotation.x = Math.PI;
        upperTooth.scale.setScalar(jawScale * 0.8);
        this.jawsGroup.add(upperTooth);

        // Lower teeth (point up)
        const lowerTooth = new THREE.Mesh(SharedGeometries.tooth, toothMat);
        lowerTooth.position.set(xPos, -0.1, 1.05);
        lowerTooth.scale.setScalar(jawScale * 0.8);
        this.jawsGroup.add(lowerTooth);
      }
    }
  }

  buildArmor(data) {
    if (data.armor < 0.3) return;

    const spikeMat = new THREE.MeshStandardMaterial({
      color: 0x555555,
      metalness: 0.4,
      roughness: 0.6
    });

    const spikeCount = Math.floor(3 + data.armor * 6);

    // Distribute spikes on upper body
    for (let i = 0; i < spikeCount; i++) {
      const spike = new THREE.Mesh(SharedGeometries.spike, spikeMat);

      // Place on upper hemisphere
      const theta = (i / spikeCount) * Math.PI * 2;
      const phi = 0.3 + Math.random() * 0.5;

      spike.position.set(
        Math.sin(phi) * Math.cos(theta) * 0.9,
        Math.cos(phi) * 0.9,
        Math.sin(phi) * Math.sin(theta) * 0.9
      );
      spike.scale.setScalar(0.8 + data.armor * 0.6);
      spike.lookAt(spike.position.clone().multiplyScalar(2));
      this.armorGroup.add(spike);
    }
  }

  buildSpecialFeatures(data) {
    // Cold resistance - fluffy outline
    if (data.coldResistance > 0.35) {
      const fluffMat = new THREE.MeshStandardMaterial({
        color: 0xddddee,
        transparent: true,
        opacity: 0.25 + data.coldResistance * 0.2
      });
      this.coldMesh = new THREE.Mesh(SharedGeometries.body.sphere, fluffMat);
      this.coldMesh.scale.setScalar(1.15 + data.coldResistance * 0.1);
      this.mesh.add(this.coldMesh);
    }

    // Parasitic probe
    if (data.parasitic > 0.3) {
      const probeMat = new THREE.MeshStandardMaterial({ color: 0x662266 });
      this.probeMesh = new THREE.Mesh(SharedGeometries.probe, probeMat);
      this.probeMesh.position.set(0, -0.15, 0.7);
      this.probeMesh.rotation.x = Math.PI / 3;
      this.mesh.add(this.probeMesh);
    }
  }

  updateFromData(data, dt = 0.016) {
    const prevData = this.data;
    this.data = data;
    this.animTime += dt;

    // Update position
    this.mesh.position.set(data.position.x, data.position.y, data.position.z);

    // Calculate movement speed
    const velLen = data.velocity ?
      Math.sqrt(data.velocity.x ** 2 + data.velocity.y ** 2 + data.velocity.z ** 2) : 0;

    // Face movement direction
    if (data.velocity && velLen > 0.01) {
      const vel = new THREE.Vector3(data.velocity.x, data.velocity.y, data.velocity.z);
      const m = new THREE.Matrix4().lookAt(vel, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
      const targetQuat = new THREE.Quaternion().setFromRotationMatrix(m);
      this.mesh.quaternion.slerp(targetQuat, 0.12);
    }

    // Detect eating (energy increased significantly)
    if (prevData && data.energy > prevData.energy + 0.5) {
      this.isEating = true;
      this.eatingTimer = 0.5; // Eat animation duration
    }
    if (this.eatingTimer > 0) {
      this.eatingTimer -= dt;
      if (this.eatingTimer <= 0) this.isEating = false;
    }

    // Animation speed based on movement
    const animSpeed = Math.min(velLen * 8, 4);

    // === SWIMMING ANIMATION (body wiggle + tail) ===
    if (velLen > 0.02) {
      const wiggle = Math.sin(this.animTime * animSpeed * 3) * 0.08 * Math.min(velLen, 0.5);
      this.bodyMesh.rotation.y = wiggle;

      // Tail fin wag
      if (this.finsGroup.children.length > 1) {
        const tail = this.finsGroup.children[1];
        tail.rotation.y = Math.sin(this.animTime * animSpeed * 4) * 0.5;
      }

      // Side fins flap
      for (let i = 2; i < this.finsGroup.children.length; i++) {
        const fin = this.finsGroup.children[i];
        const side = (i === 2) ? -1 : 1;
        fin.rotation.z = side * (0.8 + Math.sin(this.animTime * animSpeed * 2) * 0.2);
      }
    }

    // === WALKING/PADDLING ANIMATION (limbs) ===
    if (this.limbsGroup.children.length > 0 && velLen > 0.01) {
      const limbPhase = this.animTime * animSpeed * 2.5;

      this.limbsGroup.children.forEach((child) => {
        if (child.userData.side !== undefined) {
          // This is a limb (not a foot)
          const phase = limbPhase + child.userData.pairIndex * Math.PI + (child.userData.side > 0 ? Math.PI / 2 : 0);
          const swing = Math.sin(phase) * 0.4 * Math.min(velLen * 3, 1);
          child.rotation.x = 0.3 + swing;
        }
      });
    }

    // === EATING ANIMATION (jaw chomp) ===
    if (this.jawsGroup.children.length >= 2) {
      const upperJaw = this.jawsGroup.children[0];
      const lowerJaw = this.jawsGroup.children[1];

      if (this.isEating) {
        // Chomping
        const chomp = Math.sin(this.animTime * 20) * 0.5 + 0.5;
        upperJaw.position.y = upperJaw.userData.restY + chomp * 0.08;
        lowerJaw.position.y = lowerJaw.userData.restY - chomp * 0.08;
      } else {
        // Return to rest
        upperJaw.position.y += (upperJaw.userData.restY - upperJaw.position.y) * 0.2;
        lowerJaw.position.y += (lowerJaw.userData.restY - lowerJaw.position.y) * 0.2;
      }
    }

    // === IDLE ANIMATIONS ===
    // Subtle breathing
    const breathe = 1 + Math.sin(this.animTime * 1.5) * 0.015;
    const baseScale = 0.8 + data.size * 1.2;
    this.mesh.scale.setScalar(baseScale * breathe);

    // Eye pupil movement (looking around)
    if (this.eyesGroup.children.length > 0) {
      for (let i = 1; i < this.eyesGroup.children.length; i += 2) {
        const pupil = this.eyesGroup.children[i];
        if (pupil.userData.baseX !== undefined) {
          const lookX = Math.sin(this.animTime * 0.4) * 0.03;
          const lookY = Math.sin(this.animTime * 0.3 + 1) * 0.02;
          pupil.position.x = pupil.userData.baseX + lookX;
          pupil.position.y = 0.15 + lookY;
        }
      }
    }

    // Parasite probe animation
    if (this.probeMesh && data.parasitic > 0.3) {
      this.probeMesh.rotation.x = Math.PI / 3 + Math.sin(this.animTime * 2) * 0.15;
      this.probeMesh.position.z = 0.7 + Math.sin(this.animTime * 1.5) * 0.05;
    }
  }

  dispose() {
    this.mesh.traverse((child) => {
      // Don't dispose shared geometries
      if (child.material) child.material.dispose();
    });
  }
}

// Rendering-only plant
class PlantRenderer {
  constructor(data) {
    this.id = data.id;
    this.data = data;
    this.age = 0;

    const geometry = new THREE.TetrahedronGeometry(0.5);
    // Water plants are brighter/bioluminescent, land plants are normal green
    const isWater = !data.isOnLand;
    const material = new THREE.MeshStandardMaterial({
      color: isWater ? 0x00ffaa : 0x00ff00,  // Cyan-green for water, pure green for land
      emissive: isWater ? 0x00aa66 : 0x004400,  // Brighter glow underwater
      emissiveIntensity: isWater ? 0.5 : 0.2
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(data.position.x, data.position.y, data.position.z);
    this.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    this.isWater = isWater;
  }

  updateFromData(data, dt) {
    this.data = data;
    this.age += dt;

    this.mesh.position.set(data.position.x, data.position.y, data.position.z);

    // Scale based on energy (plants grow as they photosynthesize)
    const energyScale = 0.5 + (data.energy / 80) * 0.5;
    // Pulse effect
    const pulse = 1 + Math.sin(this.age * 2) * 0.1;
    this.mesh.scale.setScalar(energyScale * pulse);

    // Color intensity based on energy - water plants glow more
    const intensity = 0.3 + (data.energy / 80) * 0.7;
    if (this.isWater) {
      this.mesh.material.emissive.setRGB(0, intensity * 0.5, intensity * 0.3);
    } else {
      this.mesh.material.emissive.setRGB(0, intensity * 0.3, 0);
    }
  }

  dispose() {
    if (this.mesh.geometry) this.mesh.geometry.dispose();
    if (this.mesh.material) this.mesh.material.dispose();
  }
}

// Rendering-only corpse
class CorpseRenderer {
  constructor(data) {
    this.id = data.id;
    this.data = data;
    this.initialEnergy = data.energy || 100;

    // Corpses are darker, decaying versions of creatures
    // Use unit sphere, scale based on creature size
    const geometry = new THREE.SphereGeometry(1, 8, 8);
    const material = new THREE.MeshStandardMaterial({
      color: 0x4a3728,  // Brown/decaying color
      roughness: 0.9,
      metalness: 0.0
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(data.position.x, data.position.y, data.position.z);

    // Base scale from creature size (capped to reasonable range)
    this.baseScale = Math.min(2, 0.5 + (data.size || 0) * 1.5);
    this.mesh.scale.setScalar(this.baseScale);

    // Toxic corpses have a purple tint
    if (data.toxicity > 0.3) {
      material.color.setHex(0x6b3a6b);
    }
  }

  updateFromData(data) {
    this.data = data;
    this.mesh.position.set(data.position.x, data.position.y, data.position.z);

    // Shrink as energy is consumed/decays (relative to initial energy, capped)
    const energyRatio = Math.min(1, Math.max(0.2, data.energy / this.initialEnergy));
    this.mesh.scale.setScalar(this.baseScale * energyRatio);
  }

  dispose() {
    if (this.mesh.geometry) this.mesh.geometry.dispose();
    if (this.mesh.material) this.mesh.material.dispose();
  }
}

export class World {
  constructor(container) {
    this.container = container;
    this.creatureRenderers = new Map(); // id -> CreatureRenderer
    this.plantRenderers = new Map(); // id -> PlantRenderer
    this.corpseRenderers = new Map(); // id -> CorpseRenderer
    this.time = 0;
    this.noise2D = createNoise2D();

    this.ui = new UI();
    this.selectedCreature = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Worker for simulation
    this.worker = null;
    this.workerReady = false;
    this.pendingUpdate = false;
    this.lastWorkerData = null;

    this.initThree();
    this.initTerrain();
    this.initWorker();
  }

  initWorker() {
    // Create worker using Vite's worker syntax
    this.worker = new Worker(
      new URL('./SimulationWorker.js', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = (e) => {
      const { type, data } = e.data;

      switch (type) {
        case 'init':
          this.workerReady = true;
          this.handleWorkerInit(data);
          break;

        case 'update':
          this.pendingUpdate = false;
          this.handleWorkerUpdate(data);
          break;
      }
    };

    this.worker.onerror = (e) => {
      console.error('Worker error:', e);
    };

    // Initialize the worker
    this.worker.postMessage({ type: 'init' });
  }

  handleWorkerInit(data) {
    // Create initial creature renderers
    for (const creatureData of data.creatures) {
      const renderer = new CreatureRenderer(creatureData);
      this.creatureRenderers.set(creatureData.id, renderer);
      this.scene.add(renderer.mesh);
    }

    // Create initial plant renderers
    for (const plantData of data.plants) {
      const renderer = new PlantRenderer(plantData);
      this.plantRenderers.set(plantData.id, renderer);
      this.scene.add(renderer.mesh);
    }

    console.log(`Worker initialized: ${data.creatures.length} creatures, ${data.plants.length} plants`);
  }

  handleWorkerUpdate(data) {
    this.lastWorkerData = data;

    // Update existing creatures
    for (const creatureData of data.creatures) {
      let renderer = this.creatureRenderers.get(creatureData.id);

      if (!renderer) {
        // New creature (from reproduction)
        renderer = new CreatureRenderer(creatureData);
        this.creatureRenderers.set(creatureData.id, renderer);
        this.scene.add(renderer.mesh);
      } else {
        renderer.updateFromData(creatureData, 0.016); // ~60fps dt for animations
      }
    }

    // Remove dead creatures
    for (const deadId of data.deadCreatureIds) {
      const renderer = this.creatureRenderers.get(deadId);
      if (renderer) {
        this.scene.remove(renderer.mesh);
        renderer.dispose();
        this.creatureRenderers.delete(deadId);
      }
    }

    // Update existing plants
    for (const plantData of data.plants) {
      let renderer = this.plantRenderers.get(plantData.id);

      if (!renderer) {
        // New plant
        renderer = new PlantRenderer(plantData);
        this.plantRenderers.set(plantData.id, renderer);
        this.scene.add(renderer.mesh);
      } else {
        renderer.updateFromData(plantData, 0.016); // Approximate dt for animation
      }
    }

    // Remove dead/eaten plants
    for (const deadId of data.deadPlantIds) {
      const renderer = this.plantRenderers.get(deadId);
      if (renderer) {
        this.scene.remove(renderer.mesh);
        renderer.dispose();
        this.plantRenderers.delete(deadId);
      }
    }

    // Update existing corpses
    if (data.corpses) {
      for (const corpseData of data.corpses) {
        let renderer = this.corpseRenderers.get(corpseData.id);

        if (!renderer) {
          // New corpse
          renderer = new CorpseRenderer(corpseData);
          this.corpseRenderers.set(corpseData.id, renderer);
          this.scene.add(renderer.mesh);
        } else {
          renderer.updateFromData(corpseData);
        }
      }
    }

    // Remove decayed/eaten corpses
    if (data.deadCorpseIds) {
      for (const deadId of data.deadCorpseIds) {
        const renderer = this.corpseRenderers.get(deadId);
        if (renderer) {
          this.scene.remove(renderer.mesh);
          renderer.dispose();
          this.corpseRenderers.delete(deadId);
        }
      }
    }

    // Update UI with stats
    this.ui.updateStats({
      creatures: Array.from(this.creatureRenderers.values()).map(r => r.data),
      plants: Array.from(this.plantRenderers.values()).map(r => r.data),
      corpses: Array.from(this.corpseRenderers.values()).map(r => r.data),
      time: data.stats.time
    });
  }

  initThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87CEEB);
    this.scene.fog = new THREE.Fog(0x87CEEB, 200, 1000);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 2000);
    this.camera.position.set(0, 200, 400);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    // Keyboard controls
    this.keys = {
      ArrowUp: false,
      ArrowDown: false,
      ArrowLeft: false,
      ArrowRight: false
    };

    window.addEventListener('keydown', (e) => {
      if (this.keys.hasOwnProperty(e.key)) {
        this.keys[e.key] = true;
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (this.keys.hasOwnProperty(e.key)) {
        this.keys[e.key] = false;
        e.preventDefault();
      }
    });

    // Lights
    const ambientLight = new THREE.AmbientLight(0x404040);
    this.scene.add(ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xffffff, 1);
    this.sunLight.position.set(100, 200, 100);
    this.sunLight.castShadow = true;
    this.scene.add(this.sunLight);

    // Resize handler
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Click handling for creature selection
    this.renderer.domElement.addEventListener('click', (event) => {
      this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);

      const creatureMeshes = Array.from(this.creatureRenderers.values()).map(r => r.mesh);
      const intersects = this.raycaster.intersectObjects(creatureMeshes, true);

      if (intersects.length > 0) {
        const clickedMesh = intersects[0].object;
        const renderer = Array.from(this.creatureRenderers.values()).find(r =>
          r.mesh === clickedMesh || r.mesh.children.includes(clickedMesh) ||
          r.mesh.traverse && clickedMesh.parent === r.mesh
        );

        if (renderer) {
          this.selectedCreature = renderer.data;
          this.ui.showCreature(renderer.data);
        }
      } else {
        this.selectedCreature = null;
        this.ui.hideCreature();
      }
    });

    // Reset Camera Button
    const resetBtn = document.getElementById('reset-camera-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.camera.position.set(0, 200, 400);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
      });
    }
  }

  initTerrain() {
    const geometry = new THREE.PlaneGeometry(WORLD_SIZE.width, WORLD_SIZE.depth, 100, 100);
    geometry.rotateX(-Math.PI / 2);

    const vertices = geometry.attributes.position.array;
    const colors = [];

    for (let i = 0; i < vertices.length; i += 3) {
      const x = vertices[i];
      const z = vertices[i + 2];

      const y = this.getTerrainHeight(x, z);

      vertices[i + 1] = y;

      // Use Z-based biome for coloring
      const biome = this.getBiomeAt(z);
      const color = new THREE.Color(biome.color);

      colors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      metalness: 0.1
    });

    this.terrain = new THREE.Mesh(geometry, material);
    this.scene.add(this.terrain);

    // Water plane
    const waterGeo = new THREE.PlaneGeometry(WORLD_SIZE.width, WORLD_SIZE.depth);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0000ff,
      transparent: true,
      opacity: 0.4,
      roughness: 0.1,
      metalness: 0.5
    });
    this.water = new THREE.Mesh(waterGeo, waterMat);
    this.water.position.y = 0;
    this.scene.add(this.water);
  }

  getTerrainHeight(x, z) {
    // Small noise for natural variation
    const noise = this.noise2D(x * 0.02, z * 0.02) * 2;

    // Z determines the base terrain height (horizontal bands)
    let baseHeight;

    if (z < -300) {
      // Deep water
      baseHeight = -20;
    } else if (z < -100) {
      // Shoals - gradual slope from deep water to shore
      const t = (z + 300) / 200;
      baseHeight = -20 + t * 20;
    } else if (z < 0) {
      // Beach
      const t = (z + 100) / 100;
      baseHeight = t * 5;
    } else if (z < 200) {
      // Grassland
      const t = z / 200;
      baseHeight = 5 + t * 5;
    } else if (z < 350) {
      // Desert
      const t = (z - 200) / 150;
      baseHeight = 10 + t * 5;
    } else {
      // Tundra
      const t = Math.min(1, (z - 350) / 150);
      baseHeight = 15 + t * 5;
    }

    return baseHeight + noise;
  }

  getBiomeAt(z) {
    if (z < -300) return BIOMES.DEEP_WATER;
    if (z < -100) return BIOMES.SHOALS;
    if (z < 0) return BIOMES.BEACH;
    if (z < 200) return BIOMES.LAND;
    if (z < 350) return BIOMES.DESERT;
    return BIOMES.TUNDRA;
  }

  getBiome(y) {
    // Legacy - kept for compatibility
    if (y < BIOMES.DEEP_WATER.heightMax) return BIOMES.DEEP_WATER;
    if (y < BIOMES.SHOALS.heightMax) return BIOMES.SHOALS;
    if (y < BIOMES.BEACH.heightMax) return BIOMES.BEACH;
    if (y < BIOMES.LAND.heightMax) return BIOMES.LAND;
    if (y < BIOMES.DESERT.heightMax) return BIOMES.DESERT;
    return BIOMES.TUNDRA;
  }

  update(dt) {
    this.time += dt;

    // Camera keyboard controls
    const cameraSpeed = 50 * dt;
    if (this.keys.ArrowUp) {
      this.camera.position.z -= cameraSpeed;
      this.controls.target.z -= cameraSpeed;
    }
    if (this.keys.ArrowDown) {
      this.camera.position.z += cameraSpeed;
      this.controls.target.z += cameraSpeed;
    }
    if (this.keys.ArrowLeft) {
      this.camera.position.x -= cameraSpeed;
      this.controls.target.x -= cameraSpeed;
    }
    if (this.keys.ArrowRight) {
      this.camera.position.x += cameraSpeed;
      this.controls.target.x += cameraSpeed;
    }

    this.controls.update();

    // Send update to worker if ready and not waiting for response
    if (this.workerReady && !this.pendingUpdate) {
      this.pendingUpdate = true;
      this.worker.postMessage({ type: 'update', data: { dt } });
    }

    // Render
    this.renderer.render(this.scene, this.camera);
  }
}
