// Web Worker for simulation physics and logic
// This runs all the heavy computation off the main thread

import { createNoise2D } from 'simplex-noise';
import { WORLD_SIZE, SIMULATION_CONFIG, BIOMES, GENE_DEFINITIONS } from './Constants.js';

// Worker state
let creatures = [];
let plants = [];
let corpses = [];  // Dead creatures become food sources
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
// Terrain is organized in horizontal bands based on Z position:
// z < -300: Deep water (y = -20)
// z -300 to -100: Shoals (y = -20 to 0, gradual slope)
// z -100 to 0: Beach (y = 0 to 5)
// z 0 to 200: Grassland (y = 5 to 10)
// z 200 to 350: Desert (y = 10 to 15)
// z > 350: Tundra (y = 15 to 20)
function getTerrainHeight(x, z) {
  // Small noise for natural variation
  const noise = noise2D(x * 0.02, z * 0.02) * 2;

  // Z determines the base terrain height (horizontal bands)
  let baseHeight;

  if (z < -300) {
    // Deep water
    baseHeight = -20;
  } else if (z < -100) {
    // Shoals - gradual slope from deep water to shore
    const t = (z + 300) / 200; // 0 to 1
    baseHeight = -20 + t * 20; // -20 to 0
  } else if (z < 0) {
    // Beach
    const t = (z + 100) / 100; // 0 to 1
    baseHeight = t * 5; // 0 to 5
  } else if (z < 200) {
    // Grassland
    const t = z / 200; // 0 to 1
    baseHeight = 5 + t * 5; // 5 to 10
  } else if (z < 350) {
    // Desert
    const t = (z - 200) / 150; // 0 to 1
    baseHeight = 10 + t * 5; // 10 to 15
  } else {
    // Tundra
    const t = Math.min(1, (z - 350) / 150); // 0 to 1
    baseHeight = 15 + t * 5; // 15 to 20
  }

  return baseHeight + noise;
}

// Get biome at position (now based on Z, not height)
function getBiomeAt(x, z) {
  if (z < -300) return BIOMES.DEEP_WATER;
  if (z < -100) return BIOMES.SHOALS;
  if (z < 0) return BIOMES.BEACH;
  if (z < 200) return BIOMES.LAND;
  if (z < 350) return BIOMES.DESERT;
  return BIOMES.TUNDRA;
}

// Legacy function for compatibility
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
    this.mature = false;  // Whether creature has finished developing
    this.developmentProgress = 0;  // 0-1 progress to maturity

    this.updateFromGenes();

    // Calculate max age based on genetics (trade-off: bigger/more complex = shorter lived)
    // Base lifespan 60-120 seconds, modified by size and complexity
    const complexity = (this.armor + this.toxicity + this.coldResistance +
                       this.heatResistance + this.limbs + this.jaws) / 6;
    this.maxAge = 60 + Math.random() * 60;
    this.maxAge *= (1 - this.size * 0.3);  // Bigger = shorter life
    this.maxAge *= (1 - complexity * 0.2);  // More complex = shorter life
    this.maxAge *= (1 + this.metabolicEfficiency * 0.5);  // Efficiency = longer life
    this.maxAge = Math.max(30, this.maxAge);  // Minimum 30 seconds
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

    // Much slower speeds - creatures should mostly drift with currents
    this.maxSpeed = 0.1 + (this.speed * 0.3);  // Max speed 0.1 to 0.4
    this.maxForce = 0.01 + (this.maneuverability * 0.02);  // Very weak self-propulsion
    this.mass = 1 + (this.size * 5) + (this.armor * 2);
  }

  update(dt, biome) {
    if (this.dead) return null;

    this.age += dt;

    // Check for death by old age
    if (this.age >= this.maxAge) {
      this.dead = true;
      this.causeOfDeath = 'old_age';
      return null;
    }

    // Feature Development Costs (creatures must spend energy to develop their features)
    // This happens during the first part of life
    if (!this.mature) {
      const maturityTime = 10;  // Seconds to fully mature
      this.developmentProgress = Math.min(1, this.age / maturityTime);

      // Calculate total development cost based on genetic complexity
      const featureCosts = {
        size: this.size * 30,
        armor: this.armor * 25,
        toxicity: this.toxicity * 20,
        coldResistance: this.coldResistance * 15,
        heatResistance: this.heatResistance * 15,
        limbs: this.limbs * 25,
        jaws: this.jaws * 30,
        senseRadius: this.senseRadius * 10,
        speed: this.speed * 15
      };

      const totalDevCost = Object.values(featureCosts).reduce((a, b) => a + b, 0);
      const devCostPerSecond = totalDevCost / maturityTime;

      if (this.developmentProgress < 1) {
        this.energy -= devCostPerSecond * dt;
      } else {
        this.mature = true;
      }
    }

    // Metabolic Cost - ongoing maintenance
    let basalCost = 0.08 * (1 + this.size * 2);  // Bigger = more expensive
    basalCost *= (1 - this.metabolicEfficiency * 0.5);
    basalCost *= (1 + this.predatory * 0.3);  // Predatory lifestyle costs energy
    basalCost *= (1 + this.jaws * 0.2);  // Jaws maintenance

    // Feature maintenance costs (ongoing cost to maintain developed features)
    const maintenanceCost = (
      this.armor * 0.02 +
      this.toxicity * 0.03 +
      this.coldResistance * 0.01 +
      this.heatResistance * 0.01 +
      this.limbs * 0.02 +
      this.camouflage * 0.01
    );

    const temp = biome ? biome.temp : 20;
    let tempCost = 0;

    if (temp < 10) {
      tempCost = (10 - temp) * 0.03 * (1 - this.coldResistance);
    } else if (temp > 30) {
      tempCost = (temp - 30) * 0.03 * (1 - this.heatResistance);
    }

    const speed = Math.sqrt(this.velocity.x ** 2 + this.velocity.y ** 2 + this.velocity.z ** 2);
    let moveCost = speed * speed * 0.08;
    moveCost *= (1 + this.speed * 1.5);

    if (this.position.y < 0) {
      moveCost *= (1 + this.limbs * 0.5);  // Limbs create drag in water
    } else {
      moveCost *= (1 - this.limbs * 0.3);  // Limbs help on land
    }

    const brainCost = this.senseRadius * 0.03;
    const totalCost = (basalCost + moveCost + brainCost + tempCost + maintenanceCost) * dt;
    this.energy -= totalCost;

    // Filter Feeding - passive energy gain in water for non-predatory creatures
    if (this.position.y < 0 && speed < 0.3 && this.predatory < 0.5) {
      const filterGain = 0.15 * dt * (1 + this.senseRadius * 0.3) * (1 - this.predatory);
      this.energy += filterGain;
    }

    // Death by starvation
    if (this.energy <= 0) {
      this.dead = true;
      this.causeOfDeath = 'starvation';
      return null;
    }

    // Movement
    this.velocity.x += this.acceleration.x;
    this.velocity.y += this.acceleration.y;
    this.velocity.z += this.acceleration.z;

    // Clamp velocity (immature creatures move slower)
    let effectiveMaxSpeed = this.maxSpeed;
    if (!this.mature) {
      effectiveMaxSpeed *= 0.5 + this.developmentProgress * 0.5;
    }

    const velLen = Math.sqrt(this.velocity.x ** 2 + this.velocity.y ** 2 + this.velocity.z ** 2);
    if (velLen > effectiveMaxSpeed) {
      const scale = effectiveMaxSpeed / velLen;
      this.velocity.x *= scale;
      this.velocity.y *= scale;
      this.velocity.z *= scale;
    }

    // Calculate new position
    const newX = this.position.x + this.velocity.x;
    const newY = this.position.y + this.velocity.y;
    const newZ = this.position.z + this.velocity.z;

    // Get terrain at new position
    const newTerrainHeight = getTerrainHeight(newX, newZ);
    const newMinY = newTerrainHeight + this.size;

    // Simple terrain collision - creature cannot go below terrain
    if (newY < newMinY) {
      // Would hit terrain floor - slide along it
      this.position.x = newX;
      this.position.z = newZ;
      this.position.y = newMinY;
      if (this.velocity.y < 0) this.velocity.y = 0;
    } else {
      // Free movement
      this.position.x = newX;
      this.position.y = newY;
      this.position.z = newZ;
    }

    this.acceleration = { x: 0, y: 0, z: 0 };

    // Reproduction - only mature creatures can reproduce
    if (this.mature && this.energy > 80) {
      const threshold = 80 + 40 * (1 - this.reproductionUrgency);
      if (this.energy > threshold) {
        return this.reproduce();
      }
    }
    return null;
  }

  // Try to attack another creature
  attack(target) {
    if (!this.mature || this.predatory < 0.3 || this.jaws < 0.2) {
      return false;  // Can't hunt without predatory instinct and jaws
    }

    // Attack power based on size, jaws, and predatory instinct
    const attackPower = (this.size * 20 + this.jaws * 30 + this.predatory * 20);

    // Defense power based on size and armor
    const defensePower = (target.size * 15 + target.armor * 40);

    // Toxicity acts as defense
    if (target.toxicity > 0.3) {
      // Attacker takes damage from toxicity
      const toxicDamage = target.toxicity * 30;
      this.energy -= toxicDamage;
    }

    // Success chance based on attack vs defense
    const successChance = attackPower / (attackPower + defensePower);

    if (Math.random() < successChance) {
      // Successful attack
      const damage = attackPower * (0.5 + Math.random() * 0.5);
      target.energy -= damage;

      // Predator gains some energy from the attack (meat)
      const energyGain = damage * 0.5 * (1 + this.jaws * 0.5);
      this.energy += energyGain;

      // Hunting costs energy
      this.energy -= 5;

      if (target.energy <= 0) {
        target.dead = true;
        target.causeOfDeath = 'predation';
        return true;  // Kill confirmed
      }
    } else {
      // Failed attack still costs energy
      this.energy -= 3;
    }

    return false;
  }

  // Eat from a corpse (scavenging)
  scavenge(corpse) {
    // Scavenging efficiency determines how much energy gained
    const baseGain = Math.min(corpse.energy, 20);
    let efficiency = 0.3 + this.scavenging * 0.7;  // 30-100% efficiency

    // Toxic corpses hurt non-resistant creatures
    if (corpse.toxicity > 0.3 && this.toxicity < corpse.toxicity) {
      const toxicDamage = (corpse.toxicity - this.toxicity) * 15;
      this.energy -= toxicDamage;
    }

    const energyGained = baseGain * efficiency;
    this.energy += energyGained;
    corpse.energy -= baseGain;

    return baseGain;
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
      maxAge: this.maxAge,
      dead: this.dead,
      causeOfDeath: this.causeOfDeath,
      generation: this.generation,
      mature: this.mature,
      developmentProgress: this.developmentProgress,
      size: this.size,
      armor: this.armor,
      toxicity: this.toxicity,
      maneuverability: this.maneuverability,
      coldResistance: this.coldResistance,
      limbs: this.limbs,
      jaws: this.jaws,
      predatory: this.predatory,
      scavenging: this.scavenging,
      lungCapacity: this.lungCapacity,
      dna: this.dna.toData()
    };
  }
}

// Plant class for worker
class WorkerPlant {
  constructor(position, id, isOnLand = false) {
    this.id = id;
    this.position = { x: position?.x || 0, y: position?.y || 0, z: position?.z || 0 };
    this.energy = 10;  // Start with minimal energy, will grow via photosynthesis
    this.maxEnergy = 50 + Math.random() * 30;  // Max energy capacity
    this.age = 0;
    this.maxAge = 40 + Math.random() * 40;  // 40-80 seconds lifespan
    this.dead = false;
    this.isOnLand = isOnLand;
    this.mature = false;  // Plants need to mature before reproducing
    this.reproductionCooldown = 0;
  }

  update(dt, biome) {
    this.age += dt;

    // Maturity at 25% of lifespan
    if (!this.mature && this.age > this.maxAge * 0.25) {
      this.mature = true;
    }

    // Death by old age
    if (this.age > this.maxAge) {
      this.dead = true;
      return null;
    }

    // Reproduction cooldown
    if (this.reproductionCooldown > 0) {
      this.reproductionCooldown -= dt;
    }

    // Photosynthesis - plants gain energy from sun/thermal sources
    // Land plants get more sun, water plants get thermal energy from vents
    let energyGain = 0;

    if (this.isOnLand || this.position.y > -2) {
      // Surface/land plants - photosynthesis from sunlight
      energyGain = 1.5 * dt;  // Good sunlight
    } else if (this.position.y > -10) {
      // Shallow water - some light penetration
      energyGain = 1.0 * dt;
    } else {
      // Deep water - thermal vent energy (less efficient)
      energyGain = 0.5 * dt;
    }

    // Temperature affects growth rate
    if (biome) {
      if (biome.temp < 0) {
        energyGain *= 0.3;  // Cold slows growth
      } else if (biome.temp > 30) {
        energyGain *= 1.2;  // Warm speeds growth
      }
    }

    this.energy = Math.min(this.maxEnergy, this.energy + energyGain);

    // Reproduction - mature plants with enough energy can spawn offspring
    if (this.mature && this.energy > this.maxEnergy * 0.7 && this.reproductionCooldown <= 0) {
      this.reproductionCooldown = 10 + Math.random() * 10;  // 10-20 second cooldown
      return this.reproduce();
    }

    return null;
  }

  reproduce() {
    // Spread seeds in random direction
    const angle = Math.random() * Math.PI * 2;
    const distance = 5 + Math.random() * 20;  // 5-25 units away

    const newX = this.position.x + Math.cos(angle) * distance;
    const newZ = this.position.z + Math.sin(angle) * distance;

    // Cost energy to reproduce
    this.energy *= 0.7;

    return {
      x: newX,
      z: newZ,
      parentIsOnLand: this.isOnLand
    };
  }

  toData() {
    return {
      id: this.id,
      position: this.position,
      energy: this.energy,
      dead: this.dead,
      isOnLand: this.isOnLand,
      mature: this.mature
    };
  }
}

// Corpse class - dead creatures become food
class WorkerCorpse {
  constructor(creature, id) {
    this.id = id;
    this.position = { ...creature.position };
    // Energy from corpse depends on creature's size and remaining energy
    this.energy = Math.max(20, creature.energy * 0.5 + creature.size * 50);
    this.initialEnergy = this.energy;
    this.age = 0;
    this.maxAge = 30 + creature.size * 20;  // Bigger creatures decay slower
    this.dead = false;
    this.size = creature.size;
    this.toxicity = creature.toxicity;  // Toxic creatures = toxic corpses
  }

  update(dt, biome) {
    this.age += dt;

    // Decay rate affected by temperature
    let decayRate = 1.0;
    if (biome) {
      if (biome.temp < 5) {
        decayRate = 0.3;  // Cold preserves
      } else if (biome.temp > 25) {
        decayRate = 2.0;  // Heat accelerates decay
      }
    }

    // Gradual energy loss from decay
    this.energy -= 0.5 * decayRate * dt;

    if (this.age > this.maxAge || this.energy <= 0) {
      this.dead = true;
    }
  }

  toData() {
    return {
      id: this.id,
      position: this.position,
      energy: this.energy,
      dead: this.dead,
      size: this.size,
      toxicity: this.toxicity,
      isCorpse: true
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
let nextCorpseId = 0;
let spatialGrid = null;
let creatureSpatialGrid = null;  // For hunting/collision between creatures
let corpseSpatialGrid = null;    // For scavenging

// Initialize population
function initPopulation() {
  creatures = [];
  plants = [];
  corpses = [];

  // Spawn initial plants across all biomes
  for (let i = 0; i < 500; i++) {
    const x = (Math.random() - 0.5) * WORLD_SIZE.width;
    const z = (Math.random() - 0.5) * WORLD_SIZE.depth;
    const terrainH = getTerrainHeight(x, z);

    // Water zone is z < -100
    const isInWaterZone = z < -100;
    const isOnLand = !isInWaterZone;

    let y;
    if (isOnLand) {
      // Land plants sit on the terrain surface
      y = terrainH + 0.5;
    } else {
      // Water plants float between terrain and water surface
      const waterDepth = Math.abs(terrainH);
      y = terrainH + 0.5 + Math.random() * Math.max(0, waterDepth - 1);
    }

    const plant = new WorkerPlant({ x, y, z }, nextPlantId++, isOnLand);
    plant.energy = plant.maxEnergy * 0.5;
    plants.push(plant);
  }

  // Spawn creatures in deep water (z < -200)
  for (let i = 0; i < SIMULATION_CONFIG.initialPopulation; i++) {
    const x = (Math.random() - 0.5) * WORLD_SIZE.width * 0.8;
    const z = -200 - Math.random() * 250;  // Deep water zone
    const terrainHeight = getTerrainHeight(x, z);
    const y = terrainHeight + 2 + Math.random() * 10;  // Above terrain, in water

    // Start with simple, low-cost creatures for better survival
    const dna = new DNA();
    dna.genes.size.value = 0.2 + Math.random() * 0.2;  // Small
    dna.genes.speed.value = 0.2 + Math.random() * 0.2;  // Slow
    dna.genes.armor.value = 0.1 + Math.random() * 0.2;  // Light armor
    dna.genes.metabolicEfficiency.value = 0.5 + Math.random() * 0.3;  // Efficient
    dna.genes.senseRadius.value = 0.3 + Math.random() * 0.2;
    dna.genes.predatory.value = Math.random() * 0.3;  // Mostly non-predatory
    dna.genes.scavenging.value = Math.random() * 0.5;

    const creature = new WorkerCreature(dna, { x, y, z }, nextCreatureId++);
    creature.energy = 150;  // Start with extra energy
    creatures.push(creature);
  }
}

// Main simulation update
function update(dt) {
  time += dt;
  currentTime += dt;

  const newCreatures = [];
  const deadCreatureIds = [];
  const newCorpses = [];
  const deadCorpseIds = [];

  // Build creature spatial grid for hunting
  creatureSpatialGrid.clear();
  for (const c of creatures) {
    if (!c.dead) {
      creatureSpatialGrid.insert(c);
    }
  }

  // Build corpse spatial grid for scavenging
  corpseSpatialGrid.clear();
  for (const corpse of corpses) {
    if (!corpse.dead) {
      corpseSpatialGrid.insert(corpse);
    }
  }

  // Update creatures
  for (let i = creatures.length - 1; i >= 0; i--) {
    const c = creatures[i];

    const terrainHeight = getTerrainHeight(c.position.x, c.position.z);
    const currentBiome = getBiomeAt(c.position.x, c.position.z);

    // Bounds check - keep creatures within world and clamp position
    const halfWidth = WORLD_SIZE.width / 2 - 10;
    const halfDepth = WORLD_SIZE.depth / 2 - 10;
    const maxHeight = 100; // Ceiling to prevent flying out

    if (c.position.x > halfWidth) {
      c.position.x = halfWidth;
      c.velocity.x = -Math.abs(c.velocity.x) * 0.5;
    } else if (c.position.x < -halfWidth) {
      c.position.x = -halfWidth;
      c.velocity.x = Math.abs(c.velocity.x) * 0.5;
    }

    if (c.position.z > halfDepth) {
      c.position.z = halfDepth;
      c.velocity.z = -Math.abs(c.velocity.z) * 0.5;
    } else if (c.position.z < -halfDepth) {
      c.position.z = -halfDepth;
      c.velocity.z = Math.abs(c.velocity.z) * 0.5;
    }

    // Height ceiling
    if (c.position.y > maxHeight) {
      c.position.y = maxHeight;
      c.velocity.y = -Math.abs(c.velocity.y) * 0.5;
    }

    // Enforce terrain collision - creatures cannot go below terrain
    const minHeight = terrainHeight + c.size;
    if (c.position.y < minHeight) {
      c.position.y = minHeight;
      if (c.velocity.y < 0) c.velocity.y = 0;
    }

    // Water exists only where z < -100 (shoals and deep water)
    // Simpler check based on Z position
    const isInWaterZone = c.position.z < -100;
    const isInWater = isInWaterZone && c.position.y < 0;
    const isOnLand = !isInWater;

    // Land survival requires lung capacity - creatures without lungs take damage on land
    if (isOnLand && c.lungCapacity < 0.3) {
      // Suffocation damage - creatures can't breathe on land without lungs
      const suffocationDamage = (0.3 - c.lungCapacity) * 2 * dt;
      c.energy -= suffocationDamage;
    }

    if (isInWater) {
      // WATER PHYSICS
      // Neutral buoyancy - stay in the middle of the water column
      const waterDepth = Math.abs(terrainHeight);  // How deep the water is here
      const midWaterY = terrainHeight + waterDepth / 2;  // Middle of water column
      const targetY = Math.max(terrainHeight + c.size + 1, Math.min(-1, midWaterY));
      const depthError = targetY - c.position.y;

      c.velocity.y += depthError * 0.02;
      c.velocity.y *= 0.9;

      // Resist breaking the surface
      if (c.position.y > -1 && c.velocity.y > 0) {
        c.velocity.y *= 0.5;
      }

      // Water drag - high drag makes creatures slow down quickly
      c.velocity.x *= 0.95;
      c.velocity.y *= 0.95;
      c.velocity.z *= 0.95;

      // Current - this is the dominant movement force for most creatures
      // Creatures drift with current unless they have high speed/maneuverability
      const current = getCurrentAt(c.position.x, c.position.z, terrainHeight);
      const currentResistance = c.speed * 0.5; // Higher speed = resist current more
      const currentInfluence = 1.0 - currentResistance;
      c.velocity.x += current.x * 0.5 * currentInfluence;  // Current pushes creatures
      c.velocity.z += current.z * 0.5 * currentInfluence;

      // Creatures with high lung capacity and limbs can climb onto beach (z > -100)
      if (c.lungCapacity > 0.5 && c.limbs > 0.4 && c.position.z > -200) {
        // Near shore - try to move towards land (positive Z direction)
        if (c.energy > 50 && Math.random() < 0.02 * c.limbs) {
          c.velocity.z += 0.1;  // Push towards beach
          c.velocity.y += 0.05;  // Push upward to climb
        }
      }
    } else {
      // LAND/AIR PHYSICS
      // Gravity (gentler)
      c.velocity.y -= 0.1;

      // Air drag (less than water)
      c.velocity.x *= 0.95;
      c.velocity.z *= 0.95;

      // Land movement with limbs
      if (c.limbs > 0.3) {
        // Creatures with limbs can walk/run on land (slowly)
        const landSpeed = c.maxForce * c.limbs * 0.1;
        // Random wandering on land
        if (Math.random() < 0.05) {
          c.velocity.x += (Math.random() - 0.5) * landSpeed;
          c.velocity.z += (Math.random() - 0.5) * landSpeed;
        }
      } else {
        // Creatures without limbs flounder on land
        c.velocity.x *= 0.9;
        c.velocity.z *= 0.9;
      }

      // Ground collision (already enforced above, but handle friction and sliding)
      if (c.position.y <= minHeight + 0.1) {
        // On ground - apply friction and slope effects
        // Slope sliding (gentler)
        const sampleDist = 10;
        const hX1 = getTerrainHeight(c.position.x + sampleDist, c.position.z);
        const hX2 = getTerrainHeight(c.position.x - sampleDist, c.position.z);
        const hZ1 = getTerrainHeight(c.position.x, c.position.z + sampleDist);
        const hZ2 = getTerrainHeight(c.position.x, c.position.z - sampleDist);

        // Slide down slopes (creatures without limbs slide more)
        const slideForce = 0.02 * (1 - c.limbs * 0.5);
        c.velocity.x += (hX2 - hX1) * slideForce;
        c.velocity.z += (hZ2 - hZ1) * slideForce;

        // Ground friction
        c.velocity.x *= 0.9;
        c.velocity.z *= 0.9;
      }
    }

    // Hunting behavior - predatory creatures seek prey
    if (c.mature && c.predatory > 0.3 && c.jaws > 0.2 && c.energy < 100) {
      const senseRange = Math.ceil((c.senseRadius * 3));
      const nearbyCreatures = creatureSpatialGrid.getNearby(c.position.x, c.position.z, senseRange);

      let bestPrey = null;
      let bestScore = -Infinity;

      for (const target of nearbyCreatures) {
        if (target === c || target.dead) continue;

        const dx = target.position.x - c.position.x;
        const dy = target.position.y - c.position.y;
        const dz = target.position.z - c.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Check if within sense range
        const actualSenseRange = 10 + c.senseRadius * 40;
        if (dist > actualSenseRange) continue;

        // Camouflage reduces detection chance
        if (Math.random() < target.camouflage * 0.7) continue;

        // Score prey: prefer smaller, weaker targets nearby
        const sizeDiff = c.size - target.size;
        const armorPenalty = target.armor * 30;
        const toxicPenalty = target.toxicity * 50;
        const distPenalty = dist * 0.5;
        const score = sizeDiff * 20 - armorPenalty - toxicPenalty - distPenalty + target.energy * 0.1;

        if (score > bestScore) {
          bestScore = score;
          bestPrey = target;
        }
      }

      if (bestPrey) {
        // Move towards prey (slowly)
        const dx = bestPrey.position.x - c.position.x;
        const dy = bestPrey.position.y - c.position.y;
        const dz = bestPrey.position.z - c.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist > 0) {
          const huntSpeed = c.maxForce * (0.5 + c.predatory * 0.5);
          c.acceleration.x += (dx / dist) * huntSpeed;
          c.acceleration.y += (dy / dist) * huntSpeed * 0.3;
          c.acceleration.z += (dz / dist) * huntSpeed;
        }

        // Attack if close enough
        if (dist < 3 + c.size + bestPrey.size) {
          const killed = c.attack(bestPrey);
          if (killed) {
            // Create corpse from killed prey
            const corpse = new WorkerCorpse(bestPrey, nextCorpseId++);
            corpses.push(corpse);
            newCorpses.push(corpse.toData());
          }
        }
      }
    }

    // Scavenging behavior - creatures with scavenging trait seek corpses
    if (c.scavenging > 0.2) {
      const nearbyCorpses = corpseSpatialGrid.getNearby(c.position.x, c.position.z, 2);

      for (const corpse of nearbyCorpses) {
        if (corpse.dead) continue;

        const dx = corpse.position.x - c.position.x;
        const dy = corpse.position.y - c.position.y;
        const dz = corpse.position.z - c.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Move towards corpse if hungry (slowly)
        if (c.energy < 80 && dist > 3) {
          const scavSpeed = c.maxForce * c.scavenging * 0.5;
          c.acceleration.x += (dx / dist) * scavSpeed;
          c.acceleration.z += (dz / dist) * scavSpeed;
        }

        // Eat from corpse if close
        if (dist < 3 + c.size + corpse.size) {
          c.scavenge(corpse);
          if (corpse.energy <= 0) {
            corpse.dead = true;
          }
        }
      }
    }

    // Update creature logic
    const offspring = c.update(dt, currentBiome);

    // Re-enforce terrain collision after update
    const finalTerrainHeight = getTerrainHeight(c.position.x, c.position.z);
    const finalMinHeight = finalTerrainHeight + c.size;
    if (c.position.y < finalMinHeight) {
      c.position.y = finalMinHeight;
      if (c.velocity.y < 0) c.velocity.y = 0;
    }

    if (offspring) {
      if (creatures.length < SIMULATION_CONFIG.maxCreatures) {
        newCreatures.push(offspring);
      } else {
        // Find weakest (natural selection pressure)
        let weakestIdx = 0;
        let lowestFitness = Infinity;
        for (let k = 0; k < creatures.length; k++) {
          // Fitness = energy + youth bonus
          const ageRatio = creatures[k].age / creatures[k].maxAge;
          const fitness = creatures[k].energy * (1 - ageRatio * 0.5);
          if (fitness < lowestFitness) {
            lowestFitness = fitness;
            weakestIdx = k;
          }
        }
        const weakest = creatures[weakestIdx];
        deadCreatureIds.push(weakest.id);
        // Create corpse from culled creature
        const corpse = new WorkerCorpse(weakest, nextCorpseId++);
        corpses.push(corpse);
        newCorpses.push(corpse.toData());
        creatures.splice(weakestIdx, 1);
        newCreatures.push(offspring);
      }
    }

    if (c.dead) {
      deadCreatureIds.push(c.id);
      // Create corpse from dead creature
      const corpse = new WorkerCorpse(c, nextCorpseId++);
      corpses.push(corpse);
      newCorpses.push(corpse.toData());
      creatures.splice(i, 1);
    }
  }

  // Add new creatures
  creatures.push(...newCreatures);

  // Update corpses
  for (let j = corpses.length - 1; j >= 0; j--) {
    const corpse = corpses[j];
    const terrainHeight = getTerrainHeight(corpse.position.x, corpse.position.z);
    const biome = getBiome(terrainHeight);

    corpse.update(dt, biome);

    // Corpses sink/settle
    if (corpse.position.y < 0) {
      corpse.position.y -= 0.5 * dt;
      if (corpse.position.y < terrainHeight + 0.5) {
        corpse.position.y = terrainHeight + 0.5;
      }
    }

    if (corpse.dead) {
      deadCorpseIds.push(corpse.id);
      corpses.splice(j, 1);
    }
  }

  // Update plants with biome info for photosynthesis
  const deadPlantIds = [];
  const newPlants = [];  // Track new plants for this frame
  const plantOffspring = [];  // Seeds from reproducing plants
  const plantHalfWidth = WORLD_SIZE.width / 2 - 5;
  const plantHalfDepth = WORLD_SIZE.depth / 2 - 5;

  for (let j = plants.length - 1; j >= 0; j--) {
    const p = plants[j];
    const terrainHeight = getTerrainHeight(p.position.x, p.position.z);
    const biome = getBiomeAt(p.position.x, p.position.z);

    // Update plant and check for reproduction
    const seedInfo = p.update(dt, biome);
    if (seedInfo && plants.length < SIMULATION_CONFIG.maxPlants) {
      plantOffspring.push(seedInfo);
    }

    if (p.isOnLand) {
      // Land plants stay fixed on the terrain
      p.position.y = terrainHeight + 0.5;
    } else {
      // Water plants drift gently with current
      const current = getCurrentAt(p.position.x, p.position.z, terrainHeight);
      const newX = p.position.x + current.x * dt * 3;  // Slower drift
      const newZ = p.position.z + current.z * dt * 3;

      // Check bounds before moving
      if (Math.abs(newX) < plantHalfWidth && Math.abs(newZ) < plantHalfDepth) {
        // Check if new position would be on land (z >= -100)
        if (newZ < -100) {
          // Safe to move - still in water zone
          p.position.x = newX;
          p.position.z = newZ;
        }
      }

      // Keep above terrain (underwater floor)
      const currentTerrainH = getTerrainHeight(p.position.x, p.position.z);
      if (p.position.y < currentTerrainH + 0.5) {
        p.position.y = currentTerrainH + 0.5;
      }
      // Keep below water surface
      if (p.position.y > -0.5) {
        p.position.y = -0.5;
      }
    }

    // Hard boundary clamp (no wrapping)
    p.position.x = Math.max(-plantHalfWidth, Math.min(plantHalfWidth, p.position.x));
    p.position.z = Math.max(-plantHalfDepth, Math.min(plantHalfDepth, p.position.z));

    if (p.dead) {
      deadPlantIds.push(p.id);
      plants.splice(j, 1);
    }
  }

  // Create new plants from seeds
  for (const seedInfo of plantOffspring) {
    // Clamp seed position to bounds
    const seedX = Math.max(-plantHalfWidth, Math.min(plantHalfWidth, seedInfo.x));
    const seedZ = Math.max(-plantHalfDepth, Math.min(plantHalfDepth, seedInfo.z));

    const terrainH = getTerrainHeight(seedX, seedZ);

    // Determine if seed lands on land or water based on Z position
    const isInWaterZone = seedZ < -100;
    const isOnLand = !isInWaterZone;

    let y;
    if (isOnLand) {
      y = terrainH + 0.5;
    } else {
      // Water plants float
      const waterDepth = Math.abs(terrainH);
      y = terrainH + 0.5 + Math.random() * Math.max(0, waterDepth - 1);
    }

    const newPlant = new WorkerPlant({ x: seedX, y, z: seedZ }, nextPlantId++, isOnLand);
    newPlant.energy = 15;  // Seeds start with some energy
    plants.push(newPlant);
    newPlants.push(newPlant.toData());
  }

  // Rebuild plant spatial grid and check eating collisions
  spatialGrid.clear();
  for (const p of plants) {
    spatialGrid.insert(p);
  }

  const eatenPlantIds = [];
  for (const c of creatures) {
    // Non-predatory or hungry creatures eat plants
    if (c.predatory > 0.7 && c.energy > 50) continue;  // Pure predators don't eat plants unless starving

    const nearbyPlants = spatialGrid.getNearby(c.position.x, c.position.z, 1);

    for (const p of nearbyPlants) {
      if (p.dead) continue;

      const dx = c.position.x - p.position.x;
      const dy = c.position.y - p.position.y;
      const dz = c.position.z - p.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < 2 + c.size) {
        // Herbivore efficiency - non-predatory creatures digest plants better
        const herbivoreBonus = 1 + (1 - c.predatory) * 0.5;
        c.eat(p.energy * herbivoreBonus);
        p.dead = true;
        eatenPlantIds.push(p.id);

        const idx = plants.indexOf(p);
        if (idx > -1) plants.splice(idx, 1);
        break;  // One plant per frame per creature
      }
    }
  }

  // Random spawn plants - lower rate since plants now reproduce
  const plantSpawnChance = SIMULATION_CONFIG.foodSpawnRate * 0.3 * (1 - plants.length / SIMULATION_CONFIG.maxPlants);

  if (Math.random() < plantSpawnChance && plants.length < SIMULATION_CONFIG.maxPlants) {
    const x = (Math.random() - 0.5) * WORLD_SIZE.width * 0.95;  // Stay within bounds
    const z = (Math.random() - 0.5) * WORLD_SIZE.depth * 0.95;
    const terrainH = getTerrainHeight(x, z);

    // Water zone is z < -100
    const isInWaterZone = z < -100;
    const isOnLand = !isInWaterZone;

    let y;
    if (isOnLand) {
      // Land plants sit on the terrain surface
      y = terrainH + 0.5;
    } else {
      // Water plants float between terrain and water surface
      const waterDepth = Math.abs(terrainH);
      y = terrainH + 0.5 + Math.random() * Math.max(0, waterDepth - 1);
    }

    const plant = new WorkerPlant({ x, y, z }, nextPlantId++, isOnLand);
    plants.push(plant);
    newPlants.push(plant.toData());
  }

  return {
    creatures: creatures.map(c => c.toData()),
    plants: plants.map(p => p.toData()),
    corpses: corpses.map(c => c.toData()),
    newPlants,
    newCorpses,
    deadCreatureIds,
    deadPlantIds: [...deadPlantIds, ...eatenPlantIds],
    deadCorpseIds,
    newCreatures: newCreatures.map(c => c.toData()),
    stats: {
      creatureCount: creatures.length,
      plantCount: plants.length,
      corpseCount: corpses.length,
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
      creatureSpatialGrid = new WorkerSpatialGrid(WORLD_SIZE.width, WORLD_SIZE.depth, 50);
      corpseSpatialGrid = new WorkerSpatialGrid(WORLD_SIZE.width, WORLD_SIZE.depth, 50);
      initPopulation();

      // Send initial state
      self.postMessage({
        type: 'init',
        data: {
          creatures: creatures.map(c => c.toData()),
          plants: plants.map(p => p.toData()),
          corpses: []
        }
      });
      break;

    case 'update':
      const result = update(data.dt);
      self.postMessage({ type: 'update', data: result });
      break;
  }
};
