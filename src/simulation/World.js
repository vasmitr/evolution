import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createNoise2D } from 'simplex-noise';
import { UI } from './UI.js';
import { WORLD_SIZE, BIOMES } from './Constants.js';

// Rendering-only creature (mesh wrapper)
class CreatureRenderer {
  constructor(data) {
    this.id = data.id;
    this.data = data;

    this.mesh = new THREE.Group();
    this.bodyMesh = null;
    this.armorGroup = null;
    this.coldMesh = null;
    this.limbsGroup = null;
    this.jawsGroup = null;

    this.createMesh(data);
    this.updateFromData(data);
  }

  createMesh(data) {
    let geometry;
    if (data.maneuverability > 0.7) {
      geometry = new THREE.ConeGeometry(0.8, 2, 16);
      geometry.rotateX(Math.PI / 2);
    } else if (data.maneuverability < 0.3) {
      geometry = new THREE.BoxGeometry(1.5, 1, 1);
    } else {
      geometry = new THREE.SphereGeometry(1, 16, 16);
    }

    const material = new THREE.MeshStandardMaterial({
      color: 0x00ff00,
      roughness: 0.7,
      metalness: 0.1
    });

    this.bodyMesh = new THREE.Mesh(geometry, material);
    this.mesh.add(this.bodyMesh);

    // Armor/Shell
    this.armorGroup = new THREE.Group();
    this.mesh.add(this.armorGroup);

    // Cold Resistance
    this.coldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.05, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0 })
    );
    this.mesh.add(this.coldMesh);

    // Limbs Group
    this.limbsGroup = new THREE.Group();
    this.mesh.add(this.limbsGroup);

    // Jaws Group
    this.jawsGroup = new THREE.Group();
    this.mesh.add(this.jawsGroup);

    this.updateVisuals(data);
  }

  updateVisuals(data) {
    // Color based on toxicity
    if (this.bodyMesh) {
      if (data.toxicity > 0.5) {
        this.bodyMesh.material.color.setHSL(0, 1, 0.5);
      } else {
        this.bodyMesh.material.color.setHSL(0.3, 0.5, 0.5);
      }
    }

    // Scale based on size
    const scale = 0.5 + (data.size * 1.5);
    this.mesh.scale.set(scale, scale, scale);

    // Armor Spikes
    if (data.armor > 0.3 && this.armorGroup.children.length === 0) {
      const spikeGeo = new THREE.ConeGeometry(0.1, 0.5, 4);
      const spikeMat = new THREE.MeshStandardMaterial({ color: 0x333333 });

      for (let i = 0; i < 8; i++) {
        const spike = new THREE.Mesh(spikeGeo, spikeMat);
        spike.position.set(
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 2
        ).normalize().multiplyScalar(1.1);
        spike.lookAt(0, 0, 0);
        this.armorGroup.add(spike);
      }
    }

    // Cold Resistance
    if (data.coldResistance > 0.5) {
      this.coldMesh.material.opacity = 0.3 + (data.coldResistance - 0.5);
      this.coldMesh.scale.setScalar(1 + data.coldResistance * 0.2);
    } else {
      this.coldMesh.material.opacity = 0;
    }

    // Limbs
    if (data.limbs > 0.3 && this.limbsGroup.children.length === 0) {
      const limbGeo = new THREE.CylinderGeometry(0.1, 0.1, 1);
      const limbMat = new THREE.MeshStandardMaterial({ color: 0x00aa00 });

      const positions = [
        [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5],
        [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5]
      ];

      positions.forEach(pos => {
        const limb = new THREE.Mesh(limbGeo, limbMat);
        limb.position.set(...pos);
        limb.rotation.x = Math.PI / 2;
        this.limbsGroup.add(limb);
      });
    }

    // Jaws
    if (data.jaws > 0.3 && this.jawsGroup.children.length === 0) {
      const jawGeo = new THREE.BoxGeometry(0.5, 0.2, 0.5);
      const jawMat = new THREE.MeshStandardMaterial({ color: 0xaa0000 });
      const jaw = new THREE.Mesh(jawGeo, jawMat);
      jaw.position.set(0, 0, 1);
      this.jawsGroup.add(jaw);

      if (data.jaws > 0.7) {
        const toothGeo = new THREE.ConeGeometry(0.05, 0.2, 4);
        const toothMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
        const tooth = new THREE.Mesh(toothGeo, toothMat);
        tooth.position.set(0, 0.2, 1.2);
        tooth.rotation.x = -Math.PI / 4;
        this.jawsGroup.add(tooth);
      }
    }
  }

  updateFromData(data) {
    this.data = data;

    // Update position
    this.mesh.position.set(data.position.x, data.position.y, data.position.z);

    // Rotate to face velocity
    if (data.velocity) {
      const velLen = Math.sqrt(data.velocity.x ** 2 + data.velocity.y ** 2 + data.velocity.z ** 2);
      if (velLen > 0.001) {
        const targetQuaternion = new THREE.Quaternion();
        const m = new THREE.Matrix4();
        const vel = new THREE.Vector3(data.velocity.x, data.velocity.y, data.velocity.z);
        m.lookAt(vel, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
        targetQuaternion.setFromRotationMatrix(m);
        this.mesh.quaternion.slerp(targetQuaternion, 0.1);
      }
    }
  }

  dispose() {
    this.mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
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
    const material = new THREE.MeshStandardMaterial({
      color: 0x00ff00,
      emissive: 0x004400
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(data.position.x, data.position.y, data.position.z);
    this.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
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

    // Color intensity based on energy
    const intensity = 0.3 + (data.energy / 80) * 0.7;
    this.mesh.material.emissive.setRGB(0, intensity * 0.3, 0);
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
        renderer.updateFromData(creatureData);
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
