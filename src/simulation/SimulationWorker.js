// Web Worker for simulation physics and logic
// This runs all the heavy computation off the main thread

import { createNoise2D } from 'simplex-noise';
import { WORLD_SIZE, SIMULATION_CONFIG, BIOMES, GENE_DEFINITIONS } from './Constants.js';

// Worker state
let creatures = [];
let plants = [];
let time = 0;
let currentTime = 0;
let noise2D = null;
let currentNoise = null;

// Initialize noise functions
function init() {
  noise2D = createNoise2D();
  currentNoise = createNoise2D();
}

// Get terrain height at position
function getTerrainHeight(x, z) {
  let y = noise2D(x * 0.005, z * 0.005) * 50;
  y += noise2D(x * 0.01, z * 0.01) * 20;
  if (y < -20) y = -20;
  return y;
}

// Get biome at height
function getBiome(y) {
  if (y < BIOMES.DEEP_WATER.heightMax) return BIOMES.DEEP_WATER;
  if (y < BIOMES.SHOALS.heightMax) return BIOMES.SHOALS;
  if (y < BIOMES.BEACH.heightMax) return BIOMES.BEACH;
  if (y < BIOMES.LAND.heightMax) return BIOMES.LAND;
  return BIOMES.TUNDRA;
}

// Get current/wave force at position
function getCurrentAt(x, z, terrainHeight) {
  const t = currentTime;
  const scale = 0.005;

  const eps = 1;
  const n1 = currentNoise(x * scale, z * scale + t * 0.1);
  const n2 = currentNoise(x * scale + eps, z * scale + t * 0.1);
  const n3 = currentNoise(x * scale, z * scale + eps + t * 0.1);

  let currentX = (n3 - n1) / eps;
  let currentZ = -(n2 - n1) / eps;

  const waveFreq = 0.02;
  const waveSpeed = 2;
  const waveX = Math.cos(t * waveSpeed + x * waveFreq) * 0.3;
  const waveZ = Math.sin(t * waveSpeed * 0.7 + z * waveFreq) * 0.3;

  currentX += waveX;
  currentZ += waveZ;

  let strength = 1.0;
  if (terrainHeight > -5) {
    strength = Math.max(0, (-terrainHeight) / 5);
  }

  if (terrainHeight > -3 && strength > 0) {
    const sampleDist = 5;
    const hX1 = getTerrainHeight(x + sampleDist, z);
    const hX2 = getTerrainHeight(x - sampleDist, z);
    const hZ1 = getTerrainHeight(x, z + sampleDist);
    const hZ2 = getTerrainHeight(x, z - sampleDist);

    const gradX = hX1 - hX2;
    const gradZ = hZ1 - hZ2;
    const gradMag = Math.sqrt(gradX * gradX + gradZ * gradZ);

    if (gradMag > 0.1) {
      const currentMag = Math.sqrt(currentX * currentX + currentZ * currentZ);
      currentX = -gradZ / gradMag * currentMag;
      currentZ = gradX / gradMag * currentMag;
    }
  }

  return { x: currentX * strength, z: currentZ * strength };
}

// Gene class (simplified for worker)
class Gene {
  constructor(name, value = Math.random()) {
    this.name = name;
    this.value = Math.max(0, Math.min(1, value));
  }

  mutate() {
    const u = 1 - Math.random();
    const v = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    const mutationAmount = z * 0.1;
    this.value = Math.max(0, Math.min(1, this.value + mutationAmount));
  }

  clone() {
    return new Gene(this.name, this.value);
  }
}

// DNA class for worker
class DNA {
  constructor(genes = {}) {
    this.genes = {};
    Object.keys(GENE_DEFINITIONS).forEach(key => {
      if (genes[key]) {
        this.genes[key] = new Gene(key, genes[key].value);
      } else {
        this.genes[key] = new Gene(key);
      }
    });
  }

  mutate() {
    if (Math.random() < SIMULATION_CONFIG.mutationRate) {
      const geneKeys = Object.keys(this.genes);
      const numMutations = Math.floor(Math.random() * SIMULATION_CONFIG.mutationAmount) + 1;
      for (let i = 0; i < numMutations; i++) {
        const randomKey = geneKeys[Math.floor(Math.random() * geneKeys.length)];
        this.genes[randomKey].mutate();
      }
      return true;
    }
    return false;
  }

  clone() {
    const newGenes = {};
    Object.keys(this.genes).forEach(key => {
      newGenes[key] = this.genes[key].clone();
    });
    return new DNA(newGenes);
  }

  getGene(key) {
    return this.genes[key] ? this.genes[key].value : 0;
  }

  // Serialize for transfer
  toData() {
    const data = {};
    Object.keys(this.genes).forEach(key => {
      data[key] = this.genes[key].value;
    });
    return data;
  }
}

// Creature class for worker (no THREE.js)
class WorkerCreature {
  constructor(dna, position, id) {
    this.id = id;
    this.dna = dna || new DNA();
    this.position = { x: position?.x || 0, y: position?.y || 0, z: position?.z || 0 };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.acceleration = { x: 0, y: 0, z: 0 };

    this.energy = 100;
    this.age = 0;
    this.dead = false;
    this.generation = 0;

    this.updateFromGenes();
  }

  updateFromGenes() {
    this.size = this.dna.getGene('size');
    this.speed = this.dna.getGene('speed');
    this.senseRadius = this.dna.getGene('senseRadius');
    this.camouflage = this.dna.getGene('camouflage');
    this.armor = this.dna.getGene('armor');
    this.metabolicEfficiency = this.dna.getGene('metabolicEfficiency');
    this.toxicity = this.dna.getGene('toxicity');
    this.coldResistance = this.dna.getGene('coldResistance');
    this.heatResistance = this.dna.getGene('heatResistance');
    this.lungCapacity = this.dna.getGene('lungCapacity');
    this.scavenging = this.dna.getGene('scavenging');
    this.parasitic = this.dna.getGene('parasitic');
    this.reproductionUrgency = this.dna.getGene('reproductionUrgency');
    this.maneuverability = this.dna.getGene('maneuverability');
    this.predatory = this.dna.getGene('predatory');
    this.limbs = this.dna.getGene('limbs');
    this.jaws = this.dna.getGene('jaws');

    this.maxSpeed = 0.5 + (this.speed * 2);
    this.maxForce = 0.05 + (this.maneuverability * 0.1);
    this.mass = 1 + (this.size * 5) + (this.armor * 2);
  }

  update(dt, biome) {
    if (this.dead) return null;

    this.age += dt;

    // Metabolic Cost
    let basalCost = 0.05 * (1 + this.size);
    basalCost *= (1 - this.metabolicEfficiency * 0.5);
    basalCost *= (1 + this.predatory * 0.5);
    basalCost *= (1 + this.jaws * 0.3);

    const temp = biome ? biome.temp : 20;
    let tempCost = 0;

    if (temp < 10) {
      tempCost = (10 - temp) * 0.05 * (1 - this.coldResistance);
    } else if (temp > 30) {
      tempCost = (temp - 30) * 0.05 * (1 - this.heatResistance);
    }

    const speed = Math.sqrt(this.velocity.x ** 2 + this.velocity.y ** 2 + this.velocity.z ** 2);
    let moveCost = speed * speed * 0.1;
    moveCost *= (1 + this.speed * 2);

    if (this.position.y < 0) {
      moveCost *= (1 + this.limbs * 0.5);
    } else {
      moveCost *= (1 - this.limbs * 0.5);
    }

    const brainCost = this.senseRadius * 0.05;
    const totalCost = (basalCost + moveCost + brainCost + tempCost) * dt;
    this.energy -= totalCost;

    // Filter Feeding
    if (this.position.y < 0 && speed < 0.3) {
      const filterGain = 0.1 * dt * (1 + this.senseRadius * 0.2);
      this.energy += filterGain;
    }

    if (this.energy <= 0) {
      this.dead = true;
      return null;
    }

    // Movement
    this.velocity.x += this.acceleration.x;
    this.velocity.y += this.acceleration.y;
    this.velocity.z += this.acceleration.z;

    // Clamp velocity
    const velLen = Math.sqrt(this.velocity.x ** 2 + this.velocity.y ** 2 + this.velocity.z ** 2);
    if (velLen > this.maxSpeed) {
      const scale = this.maxSpeed / velLen;
      this.velocity.x *= scale;
      this.velocity.y *= scale;
      this.velocity.z *= scale;
    }

    this.position.x += this.velocity.x;
    this.position.y += this.velocity.y;
    this.position.z += this.velocity.z;

    this.acceleration = { x: 0, y: 0, z: 0 };

    // Reproduction
    if (this.energy > 120) {
      const threshold = 120 * (1 - this.reproductionUrgency * 0.5);
      if (this.energy > threshold) {
        return this.reproduce();
      }
    }
    return null;
  }

  reproduce() {
    this.energy /= 2;
    const offspringDNA = this.dna.clone();
    offspringDNA.mutate();

    const angle = Math.random() * Math.PI * 2;
    const offset = {
      x: Math.cos(angle) * 2,
      y: 0,
      z: Math.sin(angle) * 2
    };

    const offspring = new WorkerCreature(
      offspringDNA,
      {
        x: this.position.x + offset.x,
        y: this.position.y,
        z: this.position.z + offset.z
      },
      nextCreatureId++
    );
    offspring.energy = this.energy;
    offspring.generation = this.generation + 1;
    return offspring;
  }

  eat(amount) {
    this.energy += amount;
  }

  // Serialize for transfer to main thread
  toData() {
    return {
      id: this.id,
      position: this.position,
      velocity: this.velocity,
      energy: this.energy,
      age: this.age,
      dead: this.dead,
      generation: this.generation,
      size: this.size,
      armor: this.armor,
      toxicity: this.toxicity,
      maneuverability: this.maneuverability,
      coldResistance: this.coldResistance,
      limbs: this.limbs,
      jaws: this.jaws,
      predatory: this.predatory,
      dna: this.dna.toData()
    };
  }
}

// Plant class for worker
class WorkerPlant {
  constructor(position, id) {
    this.id = id;
    this.position = { x: position?.x || 0, y: position?.y || 0, z: position?.z || 0 };
    this.energy = 30 + Math.random() * 20;
    this.age = 0;
    this.maxAge = 20 + Math.random() * 20;
    this.dead = false;
  }

  update(dt) {
    this.age += dt;
    if (this.age > this.maxAge) {
      this.dead = true;
    }
  }

  toData() {
    return {
      id: this.id,
      position: this.position,
      energy: this.energy,
      dead: this.dead
    };
  }
}

// Spatial grid for collision optimization
class WorkerSpatialGrid {
  constructor(worldWidth, worldDepth, cellSize = 50) {
    this.worldWidth = worldWidth;
    this.worldDepth = worldDepth;
    this.cellSize = cellSize;
    this.cols = Math.ceil(worldWidth / cellSize);
    this.rows = Math.ceil(worldDepth / cellSize);
    this.offsetX = worldWidth / 2;
    this.offsetZ = worldDepth / 2;
    this.clear();
  }

  clear() {
    this.grid = Array(this.rows).fill(null).map(() =>
      Array(this.cols).fill(null).map(() => [])
    );
  }

  getCellIndices(x, z) {
    const col = Math.floor((x + this.offsetX) / this.cellSize);
    const row = Math.floor((z + this.offsetZ) / this.cellSize);
    return {
      row: Math.max(0, Math.min(this.rows - 1, row)),
      col: Math.max(0, Math.min(this.cols - 1, col))
    };
  }

  insert(entity) {
    const { row, col } = this.getCellIndices(entity.position.x, entity.position.z);
    this.grid[row][col].push(entity);
  }

  getNearby(x, z, range = 1) {
    const { row, col } = this.getCellIndices(x, z);
    const nearby = [];
    for (let r = Math.max(0, row - range); r <= Math.min(this.rows - 1, row + range); r++) {
      for (let c = Math.max(0, col - range); c <= Math.min(this.cols - 1, col + range); c++) {
        nearby.push(...this.grid[r][c]);
      }
    }
    return nearby;
  }
}

let nextCreatureId = 0;
let nextPlantId = 0;
let spatialGrid = null;

// Initialize population
function initPopulation() {
  creatures = [];
  plants = [];

  let spawned = 0;
  const maxAttempts = SIMULATION_CONFIG.initialPopulation * 10;
  let attempts = 0;

  while (spawned < SIMULATION_CONFIG.initialPopulation && attempts < maxAttempts) {
    attempts++;

    const x = (Math.random() - 0.5) * WORLD_SIZE.width * 0.8;
    const z = (Math.random() - 0.5) * WORLD_SIZE.depth * 0.8;
    const terrainHeight = getTerrainHeight(x, z);

    if (terrainHeight < -5) {
      const y = terrainHeight + Math.random() * (0 - terrainHeight);

      const dna = new DNA();
      dna.genes.speed.value = 0.1 + Math.random() * 0.1;
      dna.genes.armor.value = 0.8 + Math.random() * 0.2;

      const creature = new WorkerCreature(dna, { x, y, z }, nextCreatureId++);
      creatures.push(creature);
      spawned++;
    }
  }
}

// Main simulation update
function update(dt) {
  time += dt;
  currentTime += dt;

  const newCreatures = [];
  const deadCreatureIds = [];

  // Update creatures
  for (let i = creatures.length - 1; i >= 0; i--) {
    const c = creatures[i];

    const terrainHeightAtCreature = getTerrainHeight(c.position.x, c.position.z);
    const currentBiome = getBiome(terrainHeightAtCreature);

    // Physics first
    const terrainHeight = getTerrainHeight(c.position.x, c.position.z);

    // Bounds check
    if (Math.abs(c.position.x) > WORLD_SIZE.width / 2) c.velocity.x *= -1;
    if (Math.abs(c.position.z) > WORLD_SIZE.depth / 2) c.velocity.z *= -1;

    // Keep underwater
    if (c.position.y > -1) {
      c.position.y = -1;
      c.velocity.y = Math.min(c.velocity.y, -0.1);
    }

    if (c.position.y < 0) {
      // Neutral buoyancy
      const midPoint = (terrainHeight + 0) / 2;
      const targetY = Math.min(-2, midPoint);
      const depthError = targetY - c.position.y;

      c.velocity.y += depthError * 0.02;
      c.velocity.y *= 0.9;

      if (c.position.y > -3 && c.velocity.y > 0) {
        c.velocity.y *= 0.5;
      }

      // Drag
      c.velocity.x *= 0.98;
      c.velocity.y *= 0.98;
      c.velocity.z *= 0.98;

      // Current
      const current = getCurrentAt(c.position.x, c.position.z, terrainHeight);
      c.velocity.x += current.x * 3;
      c.velocity.z += current.z * 3;
    } else {
      c.velocity.y -= 0.3;
    }

    // Terrain collision
    if (c.position.y < terrainHeight + c.size) {
      if (terrainHeight > -1) {
        const sampleDist = 10;
        const hX1 = getTerrainHeight(c.position.x + sampleDist, c.position.z);
        const hX2 = getTerrainHeight(c.position.x - sampleDist, c.position.z);
        const hZ1 = getTerrainHeight(c.position.x, c.position.z + sampleDist);
        const hZ2 = getTerrainHeight(c.position.x, c.position.z - sampleDist);

        c.velocity.x += (hX2 - hX1) * 0.1;
        c.velocity.z += (hZ2 - hZ1) * 0.1;
      }

      c.position.y = terrainHeight + c.size;
      if (c.velocity.y < 0) c.velocity.y = 0;

      c.velocity.x *= 0.95;
      c.velocity.z *= 0.95;
    }

    // Update creature logic
    const offspring = c.update(dt, currentBiome);

    if (offspring) {
      if (creatures.length < SIMULATION_CONFIG.maxCreatures) {
        newCreatures.push(offspring);
      } else {
        // Find weakest
        let weakestIdx = 0;
        let lowestEnergy = creatures[0].energy;
        for (let k = 1; k < creatures.length; k++) {
          if (creatures[k].energy < lowestEnergy) {
            lowestEnergy = creatures[k].energy;
            weakestIdx = k;
          }
        }
        deadCreatureIds.push(creatures[weakestIdx].id);
        creatures.splice(weakestIdx, 1);
        newCreatures.push(offspring);
      }
    }

    if (c.dead) {
      deadCreatureIds.push(c.id);
      creatures.splice(i, 1);
    }
  }

  // Add new creatures
  creatures.push(...newCreatures);

  // Update plants
  const deadPlantIds = [];

  for (let j = plants.length - 1; j >= 0; j--) {
    const p = plants[j];
    p.update(dt);

    if (p.position.y < 0) {
      const terrainHeight = getTerrainHeight(p.position.x, p.position.z);
      const current = getCurrentAt(p.position.x, p.position.z, terrainHeight);

      p.position.x += current.x * dt * 20;
      p.position.z += current.z * dt * 20;

      if (p.position.y < terrainHeight + 0.5) {
        p.position.y = terrainHeight + 0.5;
      }
    }

    // Boundary wrap
    if (Math.abs(p.position.x) > WORLD_SIZE.width / 2) p.position.x *= -1;
    if (Math.abs(p.position.z) > WORLD_SIZE.depth / 2) p.position.z *= -1;

    if (p.dead) {
      deadPlantIds.push(p.id);
      plants.splice(j, 1);
    }
  }

  // Rebuild spatial grid and check collisions
  spatialGrid.clear();
  for (const p of plants) {
    spatialGrid.insert(p);
  }

  const eatenPlantIds = [];
  for (const c of creatures) {
    const nearbyPlants = spatialGrid.getNearby(c.position.x, c.position.z, 1);

    for (const p of nearbyPlants) {
      if (p.dead) continue;

      const dx = c.position.x - p.position.x;
      const dy = c.position.y - p.position.y;
      const dz = c.position.z - p.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < 2 + c.size) {
        c.eat(p.energy);
        p.dead = true;
        eatenPlantIds.push(p.id);

        const idx = plants.indexOf(p);
        if (idx > -1) plants.splice(idx, 1);
      }
    }
  }

  // Spawn plants
  const newPlants = [];
  if (Math.random() < SIMULATION_CONFIG.foodSpawnRate && plants.length < SIMULATION_CONFIG.maxPlants) {
    const x = (Math.random() - 0.5) * WORLD_SIZE.width;
    const z = (Math.random() - 0.5) * WORLD_SIZE.depth;
    const terrainH = getTerrainHeight(x, z);
    let y = terrainH + 1;
    if (y < 0) {
      y = terrainH + Math.random() * (0 - terrainH);
    }

    const plant = new WorkerPlant({ x, y, z }, nextPlantId++);
    plants.push(plant);
    newPlants.push(plant.toData());
  }

  return {
    creatures: creatures.map(c => c.toData()),
    plants: plants.map(p => p.toData()),
    newPlants,
    deadCreatureIds,
    deadPlantIds: [...deadPlantIds, ...eatenPlantIds],
    newCreatures: newCreatures.map(c => c.toData()),
    stats: {
      creatureCount: creatures.length,
      plantCount: plants.length,
      time
    }
  };
}

// Message handler
self.onmessage = function(e) {
  const { type, data } = e.data;

  switch (type) {
    case 'init':
      init();
      spatialGrid = new WorkerSpatialGrid(WORLD_SIZE.width, WORLD_SIZE.depth, 50);
      initPopulation();

      // Send initial state
      self.postMessage({
        type: 'init',
        data: {
          creatures: creatures.map(c => c.toData()),
          plants: plants.map(p => p.toData())
        }
      });
      break;

    case 'update':
      const result = update(data.dt);
      self.postMessage({ type: 'update', data: result });
      break;
  }
};
