import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createNoise2D } from 'simplex-noise';
import { Creature } from './Creature.js';
import { Plant } from './Plant.js';
import { DNA } from './DNA.js';
import { UI } from './UI.js';
import { SpatialGrid } from './SpatialGrid.js';
import { WORLD_SIZE, SIMULATION_CONFIG, BIOMES } from './Constants.js';

export class World {
  constructor(container) {
    this.container = container;
    this.creatures = [];
    this.plants = [];
    this.corpses = [];
    this.time = 0;
    this.season = 0; // 0 to 2PI
    this.noise2D = createNoise2D();
    this.currentNoise = createNoise2D(); // Separate noise for currents
    this.waveNoise = createNoise2D(); // Noise for wave patterns
    this.currentTime = 0; // Separate time for current animation
    
    this.ui = new UI();
    this.selectedCreature = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    
    // Spatial partitioning for collision optimization
    this.spatialGrid = new SpatialGrid(WORLD_SIZE.width, WORLD_SIZE.depth, 50);
    
    this.initThree();
    this.initTerrain();
    this.initPopulation();
  }

  initThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87CEEB); // Sky blue
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
      // Calculate mouse position in normalized device coordinates
      this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
      
      // Update the raycaster
      this.raycaster.setFromCamera(this.mouse, this.camera);
      
      // Check for intersections with creature meshes
      const creatureMeshes = this.creatures.map(c => c.mesh);
      const intersects = this.raycaster.intersectObjects(creatureMeshes, true);
      
      if (intersects.length > 0) {
        // Find which creature was clicked
        const clickedMesh = intersects[0].object;
        this.selectedCreature = this.creatures.find(c => 
          c.mesh === clickedMesh || c.mesh.children.includes(clickedMesh)
        );
        
        if (this.selectedCreature) {
          this.ui.showCreature(this.selectedCreature);
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
      
      const biome = this.getBiome(y);
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

  initPopulation() {
    let spawned = 0;
    const maxAttempts = SIMULATION_CONFIG.initialPopulation * 10; // Prevent infinite loop
    let attempts = 0;
    
    while (spawned < SIMULATION_CONFIG.initialPopulation && attempts < maxAttempts) {
      attempts++;
      
      // Spawn in deep water
      const x = (Math.random() - 0.5) * WORLD_SIZE.width * 0.8;
      const z = (Math.random() - 0.5) * WORLD_SIZE.depth * 0.8;
      
      // Check if this location is underwater
      const terrainHeight = this.getTerrainHeight(x, z);
      
      // Only spawn if terrain is below water level (< 0)
      if (terrainHeight < -5) { // Deep water areas
        // Spawn creature between terrain and surface
        const y = terrainHeight + Math.random() * (0 - terrainHeight);
        
        const dna = new DNA();
        // "Creatures start with low Speed and high Armor/Shell"
        dna.genes.speed.value = 0.1 + Math.random() * 0.1;
        dna.genes.armor.value = 0.8 + Math.random() * 0.2;
        
        const creature = new Creature(dna, new THREE.Vector3(x, y, z));
        this.creatures.push(creature);
        this.scene.add(creature.mesh);
        spawned++;
      }
    }
    
    console.log(`Spawned ${spawned} creatures in water`);
  }

  getTerrainHeight(x, z) {
    let y = this.noise2D(x * 0.005, z * 0.005) * 50; // Base terrain
    y += this.noise2D(x * 0.01, z * 0.01) * 20; // Detail
    
    // Flatten deep water or clamp
    if (y < -20) y = -20;
    return y;
  }

  getBiome(y) {
    if (y < BIOMES.DEEP_WATER.heightMax) return BIOMES.DEEP_WATER;
    if (y < BIOMES.SHOALS.heightMax) return BIOMES.SHOALS;
    if (y < BIOMES.BEACH.heightMax) return BIOMES.BEACH;
    if (y < BIOMES.LAND.heightMax) return BIOMES.LAND;
    return BIOMES.TUNDRA;
  }

  // Get current/wave force at a specific position
  // Uses noise for realistic, spatially-varying currents
  getCurrentAt(x, z, terrainHeight) {
    const t = this.currentTime;
    const scale = 0.005; // Spatial scale of current patterns

    // Base current from noise - creates swirling patterns
    // Use curl noise for divergence-free flow (more realistic water)
    const eps = 1;
    const n1 = this.currentNoise(x * scale, z * scale + t * 0.1);
    const n2 = this.currentNoise(x * scale + eps, z * scale + t * 0.1);
    const n3 = this.currentNoise(x * scale, z * scale + eps + t * 0.1);

    // Curl of noise field gives us divergence-free flow
    let currentX = (n3 - n1) / eps;
    let currentZ = -(n2 - n1) / eps;

    // Add wave oscillation
    const waveFreq = 0.02;
    const waveSpeed = 2;
    const waveX = Math.cos(t * waveSpeed + x * waveFreq) * 0.3;
    const waveZ = Math.sin(t * waveSpeed * 0.7 + z * waveFreq) * 0.3;

    currentX += waveX;
    currentZ += waveZ;

    // Currents are weaker in shallow water, zero on land
    let strength = 1.0;
    if (terrainHeight > -5) {
      strength = Math.max(0, (-terrainHeight) / 5);
    }

    // Deflect current away from shallow terrain
    if (terrainHeight > -3 && strength > 0) {
      const sampleDist = 5;
      const hX1 = this.getTerrainHeight(x + sampleDist, z);
      const hX2 = this.getTerrainHeight(x - sampleDist, z);
      const hZ1 = this.getTerrainHeight(x, z + sampleDist);
      const hZ2 = this.getTerrainHeight(x, z - sampleDist);

      const gradX = hX1 - hX2;
      const gradZ = hZ1 - hZ2;
      const gradMag = Math.sqrt(gradX * gradX + gradZ * gradZ);

      if (gradMag > 0.1) {
        // Flow perpendicular to slope (along the coast)
        const currentMag = Math.sqrt(currentX * currentX + currentZ * currentZ);
        currentX = -gradZ / gradMag * currentMag;
        currentZ = gradX / gradMag * currentMag;
      }
    }

    return { x: currentX * strength, z: currentZ * strength };
  }

  update(dt) {
    this.time += dt;
    this.season = Math.sin(this.time * 0.0001); // Very slow cycle
    
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
    
    // Update current time for wave/current animation
    this.currentTime += dt;
    
    // Update creatures
    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      
      // Get biome for creature based on terrain height at their location (not creature's Y position)
      const terrainHeightAtCreature = this.getTerrainHeight(c.position.x, c.position.z);
      const currentBiome = this.getBiome(terrainHeightAtCreature);
      
      // Update creature (handles internal logic)
      const offspring = c.update(dt, this, currentBiome);
      
      // Handle reproduction
      if (offspring) {
        // Check population cap
        if (this.creatures.length < SIMULATION_CONFIG.maxCreatures) {
          this.creatures.push(offspring);
          this.scene.add(offspring.mesh);
        } else {
          // At capacity - cull the oldest/weakest creature
          let weakestIdx = 0;
          let lowestEnergy = this.creatures[0].energy;
          for (let k = 1; k < this.creatures.length; k++) {
            if (this.creatures[k].energy < lowestEnergy) {
              lowestEnergy = this.creatures[k].energy;
              weakestIdx = k;
            }
          }
          // Remove weakest and add offspring
          this.scene.remove(this.creatures[weakestIdx].mesh);
          this.creatures.splice(weakestIdx, 1);
          this.creatures.push(offspring);
          this.scene.add(offspring.mesh);
        }
      }
      
      if (c.dead) {
        this.scene.remove(c.mesh);
        this.creatures.splice(i, 1);
        // Add corpse logic here
      } else {
        // Simple bounds check
        if (Math.abs(c.position.x) > WORLD_SIZE.width / 2) c.velocity.x *= -1;
        if (Math.abs(c.position.z) > WORLD_SIZE.depth / 2) c.velocity.z *= -1;

        // Physics: Gravity / Buoyancy
        const terrainHeight = this.getTerrainHeight(c.position.x, c.position.z);

        // Keep creatures underwater - if they pop above surface, push them back
        if (c.position.y > -1) {
          c.position.y = -1;
          c.velocity.y = Math.min(c.velocity.y, -0.1);
        }

        if (c.position.y < 0) {
          // Underwater physics

          // Neutral buoyancy - creatures hover at mid-depth
          // In deep water: halfway between floor and surface
          // In shallow water: stay at least 2 units below surface
          const midPoint = (terrainHeight + 0) / 2;
          const targetY = Math.min(-2, midPoint);
          const depthError = targetY - c.position.y;

          // Gentle force toward target depth
          c.velocity.y += depthError * 0.02;

          // Dampen vertical movement to prevent oscillation
          c.velocity.y *= 0.9;

          // Hard limit on upward velocity near surface
          if (c.position.y > -3 && c.velocity.y > 0) {
            c.velocity.y *= 0.5;
          }

          // Apply drag
          c.velocity.multiplyScalar(0.98);

          // Get current at creature's position (includes terrain deflection)
          const current = this.getCurrentAt(c.position.x, c.position.z, terrainHeight);
          c.velocity.x += current.x * 3;
          c.velocity.z += current.z * 3;
        } else {
          // Above water - strong gravity to get back in
          c.velocity.y -= 0.3;
        }

        // Terrain Collision
        if (c.position.y < terrainHeight + c.size) {
          // If terrain is above water, creature shouldn't be here
          if (terrainHeight > -1) {
            // Push back into deeper water
            const sampleDist = 10;
            const hX1 = this.getTerrainHeight(c.position.x + sampleDist, c.position.z);
            const hX2 = this.getTerrainHeight(c.position.x - sampleDist, c.position.z);
            const hZ1 = this.getTerrainHeight(c.position.x, c.position.z + sampleDist);
            const hZ2 = this.getTerrainHeight(c.position.x, c.position.z - sampleDist);

            // Push toward deeper water
            c.velocity.x += (hX2 - hX1) * 0.1;
            c.velocity.z += (hZ2 - hZ1) * 0.1;
          }

          c.position.y = terrainHeight + c.size;
          if (c.velocity.y < 0) c.velocity.y = 0;

          c.velocity.x *= 0.95;
          c.velocity.z *= 0.95;
        }
      }
    }
    
    // Update Plants separate loop
    for (let j = this.plants.length - 1; j >= 0; j--) {
      const p = this.plants[j];

      p.update(dt);

      // Apply current drift to plants
      if (p.position.y < 0) {
        const terrainHeight = this.getTerrainHeight(p.position.x, p.position.z);

        // Get current at plant's position (includes terrain deflection)
        const current = this.getCurrentAt(p.position.x, p.position.z, terrainHeight);
        p.position.x += current.x * dt * 20;
        p.position.z += current.z * dt * 20;

        // Keep plant above seafloor
        if (p.position.y < terrainHeight + 0.5) {
          p.position.y = terrainHeight + 0.5;
        }

        p.mesh.position.copy(p.position);
      }

      // Boundary wrap for plants
      if (Math.abs(p.position.x) > WORLD_SIZE.width / 2) p.position.x *= -1;
      if (Math.abs(p.position.z) > WORLD_SIZE.depth / 2) p.position.z *= -1;

      if (p.dead) {
        this.scene.remove(p.mesh);
        this.plants.splice(j, 1);
      }
    }
    
    // Rebuild spatial grid each frame
    this.spatialGrid.clear();
    
    // Insert all plants into grid
    for (const p of this.plants) {
      this.spatialGrid.insert(p);
    }
    
    // Check collisions using spatial grid (Creature vs Plant)
    // This is now O(n) instead of O(n*m) thanks to spatial partitioning
    for (const c of this.creatures) {
       // Only check plants in nearby cells
       const nearbyPlants = this.spatialGrid.getNearby(c.position.x, c.position.z, 1);
       
       for (let j = nearbyPlants.length - 1; j >= 0; j--) {
          const p = nearbyPlants[j];
          if (p.dead) continue;
          
          const dist = c.position.distanceTo(p.position);
          if (dist < 2 + c.size) { // Eat range
            c.eat(p.energy);
            
            // Visual feedback - flash the creature green
            if (c.bodyMesh && c.bodyMesh.material) {
              const originalColor = c.bodyMesh.material.color.getHex();
              c.bodyMesh.material.color.setHex(0x00ff00);
              setTimeout(() => {
                if (c.bodyMesh && c.bodyMesh.material) {
                  c.bodyMesh.material.color.setHex(originalColor);
                }
              }, 100);
            }
            
            p.dead = true;
            this.scene.remove(p.mesh);
            
            // Remove from plants array
            const idx = this.plants.indexOf(p);
            if (idx > -1) this.plants.splice(idx, 1);
          }
       }
    }
    
    // Spawn Plants
    if (Math.random() < SIMULATION_CONFIG.foodSpawnRate && this.plants.length < SIMULATION_CONFIG.maxPlants) {
      const x = (Math.random() - 0.5) * WORLD_SIZE.width;
      const z = (Math.random() - 0.5) * WORLD_SIZE.depth;
      // Random height for now, ideally raycast to terrain
      // We'll just spawn them at a fixed height or random
      const terrainH = this.getTerrainHeight(x, z);
      let y = terrainH + 1; // On ground
      if (y < 0) {
        // If underwater, spawn anywhere between bottom and surface
        y = terrainH + Math.random() * (0 - terrainH);
      }
      
      const plant = new Plant(new THREE.Vector3(x, y, z));
      this.plants.push(plant);
      this.scene.add(plant.mesh);
    }
    
    // Update UI
    this.ui.updateStats(this);
    
    this.renderer.render(this.scene, this.camera);
  }
}
