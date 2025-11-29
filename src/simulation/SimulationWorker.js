// Web Worker for simulation physics and logic
// This runs all the heavy computation off the main thread

import { createNoise2D } from 'simplex-noise';
import { WORLD_SIZE, SIMULATION_CONFIG, BIOMES, GENE_DEFINITIONS, DEFAULT_GENE_WEIGHTS, WEIGHT_MUTATION } from './Constants.js';

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

// Helper: Gaussian random number
function gaussianRandom() {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Deep clone an object
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const cloned = {};
  for (const key in obj) {
    cloned[key] = deepClone(obj[key]);
  }
  return cloned;
}

// DNA class - carries both gene values and weight matrices
class DNA {
  constructor(genes = null, weights = null) {
    // Gene values (0-1 range)
    this.genes = {};
    Object.keys(GENE_DEFINITIONS).forEach(key => {
      if (genes && genes[key] !== undefined) {
        // Accept either {value: x} or just x
        const val = typeof genes[key] === 'object' ? genes[key].value : genes[key];
        this.genes[key] = Math.max(0, Math.min(1, val));
      } else {
        this.genes[key] = 0; // Start at 0 - blind filter feeders
      }
    });

    // Weight matrix - each creature carries its own copy
    this.weights = weights ? deepClone(weights) : deepClone(DEFAULT_GENE_WEIGHTS);
  }

  // Mutate gene values
  mutateGenes() {
    if (Math.random() < SIMULATION_CONFIG.mutationRate) {
      const geneKeys = Object.keys(this.genes);
      const numMutations = Math.floor(Math.random() * SIMULATION_CONFIG.mutationAmount) + 1;
      for (let i = 0; i < numMutations; i++) {
        const randomKey = geneKeys[Math.floor(Math.random() * geneKeys.length)];
        const currentVal = this.genes[randomKey];

        // Use absolute mutation amount (not relative to current value)
        // This allows genes at 0 to increase
        let mutation = gaussianRandom() * 0.1;

        // Slight bias toward increasing when value is very low
        // This helps evolution get started from zero
        if (currentVal < 0.1 && Math.random() < 0.3) {
          mutation = Math.abs(mutation);
        }

        this.genes[randomKey] = Math.max(0, Math.min(1, currentVal + mutation));
      }
      return true;
    }
    return false;
  }

  // Mutate weight matrix values
  mutateWeights() {
    if (Math.random() < WEIGHT_MUTATION.chance) {
      // Pick a random weight category and key to mutate
      const categories = Object.keys(this.weights);
      const category = categories[Math.floor(Math.random() * categories.length)];
      const weightObj = this.weights[category];

      if (typeof weightObj === 'object') {
        const keys = Object.keys(weightObj);
        const key = keys[Math.floor(Math.random() * keys.length)];
        const subObj = weightObj[key];

        if (typeof subObj === 'object') {
          // Nested object (like senseRanges.sight.land)
          const subKeys = Object.keys(subObj);
          const subKey = subKeys[Math.floor(Math.random() * subKeys.length)];
          const current = subObj[subKey];
          const defaultVal = DEFAULT_GENE_WEIGHTS[category][key][subKey];
          const mutation = gaussianRandom() * WEIGHT_MUTATION.amount * defaultVal;
          subObj[subKey] = Math.max(
            WEIGHT_MUTATION.minValue,
            Math.min(defaultVal * WEIGHT_MUTATION.maxValue, current + mutation)
          );
        } else if (typeof subObj === 'number') {
          // Direct number (like energyCosts.size)
          const defaultVal = DEFAULT_GENE_WEIGHTS[category][key];
          const mutation = gaussianRandom() * WEIGHT_MUTATION.amount * defaultVal;
          weightObj[key] = Math.max(
            WEIGHT_MUTATION.minValue,
            Math.min(defaultVal * WEIGHT_MUTATION.maxValue, subObj + mutation)
          );
        }
      }
      return true;
    }
    return false;
  }

  mutate() {
    const genesMutated = this.mutateGenes();
    const weightsMutated = this.mutateWeights();
    return genesMutated || weightsMutated;
  }

  clone() {
    return new DNA(deepClone(this.genes), deepClone(this.weights));
  }

  getGene(key) {
    return this.genes[key] !== undefined ? this.genes[key] : 0;
  }

  getWeight(path) {
    // path like "energyCosts.size" or "senseRanges.sight.land"
    const parts = path.split('.');
    let val = this.weights;
    for (const part of parts) {
      if (val && val[part] !== undefined) {
        val = val[part];
      } else {
        return 0;
      }
    }
    return val;
  }

  // Serialize for transfer
  toData() {
    return {
      genes: deepClone(this.genes),
      weights: deepClone(this.weights)
    };
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
    this.mature = false;
    this.developmentProgress = 0;

    this.cacheGeneValues();
    this.calculateMaxAge();
  }

  // Cache gene values for quick access
  cacheGeneValues() {
    const g = this.dna.genes;
    this.size = g.size || 0;
    this.speed = g.speed || 0;
    this.sight = g.sight || 0;
    this.smell = g.smell || 0;
    this.hearing = g.hearing || 0;
    this.camouflage = g.camouflage || 0;
    this.armor = g.armor || 0;
    this.metabolicEfficiency = g.metabolicEfficiency || 0;
    this.toxicity = g.toxicity || 0;
    this.coldResistance = g.coldResistance || 0;
    this.heatResistance = g.heatResistance || 0;
    this.lungCapacity = g.lungCapacity || 0;
    this.scavenging = g.scavenging || 0;
    this.parasitic = g.parasitic || 0;
    this.reproductionUrgency = g.reproductionUrgency || 0;
    this.maneuverability = g.maneuverability || 0;
    this.predatory = g.predatory || 0;
    this.limbs = g.limbs || 0;
    this.jaws = g.jaws || 0;
    this.filterFeeding = g.filterFeeding || 0;

    // Calculate derived stats using weights
    const w = this.dna.weights.movement;
    this.maxSpeed = w.maxSpeedBase + (this.speed * w.maxSpeedFromSpeed);
    this.maxForce = w.maxForceBase + (this.maneuverability * w.maxForceFromManeuver);
    this.mass = 1 + (this.size * 5) + (this.armor * 2);
  }

  calculateMaxAge() {
    const w = this.dna.weights.lifespan;
    const complexity = (this.armor + this.toxicity + this.coldResistance +
                       this.heatResistance + this.limbs + this.jaws) / 6;
    this.maxAge = w.base + Math.random() * w.random;
    this.maxAge *= (1 - this.size * w.sizePenalty);
    this.maxAge *= (1 - complexity * w.complexityPenalty);
    this.maxAge *= (1 + this.metabolicEfficiency * w.efficiencyBonus);
    this.maxAge = Math.max(30, this.maxAge);
  }

  // Calculate sense range using weight matrix
  getSenseRange(isInWater, waterDepth) {
    let range = 5;  // Base range
    const sr = this.dna.weights.senseRanges;

    // Sight - varies by environment
    if (isInWater) {
      if (waterDepth < 5) {
        range += this.sight * sr.sight.shallowWater;
      } else if (waterDepth < 15) {
        range += this.sight * sr.sight.mediumWater;
      } else {
        range += this.sight * sr.sight.deepWater;
      }
    } else {
      range += this.sight * sr.sight.land;
    }

    // Smell - works everywhere
    range += this.smell * sr.smell.base;

    // Hearing - best in water
    if (isInWater) {
      range += this.hearing * sr.hearing.water;
    } else {
      range += this.hearing * sr.hearing.land;
    }

    return range;
  }

  // Detection with camouflage consideration
  canDetect(target, distance, isInWater, waterDepth) {
    const senseRange = this.getSenseRange(isInWater, waterDepth);
    if (distance > senseRange) return false;

    // Calculate sense contributions
    const sightContribution = isInWater ?
      (waterDepth < 10 ? this.sight * 0.5 : this.sight * 0.1) :
      this.sight * 0.6;
    const smellContribution = this.smell * 0.3;
    const hearingContribution = isInWater ? this.hearing * 0.4 : this.hearing * 0.1;
    const totalSense = sightContribution + smellContribution + hearingContribution;

    let detectionChance = 1.0;
    if (totalSense > 0) {
      const camoEffect = target.camouflage * (sightContribution / totalSense);
      detectionChance = 1.0 - (camoEffect * 0.7);
    }
    detectionChance *= (1.0 - (distance / senseRange) * 0.5);

    return Math.random() < detectionChance;
  }

  update(dt, biome) {
    if (this.dead) return null;

    this.age += dt;

    if (this.age >= this.maxAge) {
      this.dead = true;
      this.causeOfDeath = 'old_age';
      return null;
    }

    const w = this.dna.weights;

    // Development costs
    if (!this.mature) {
      const maturityTime = 10;
      this.developmentProgress = Math.min(1, this.age / maturityTime);

      let totalDevCost = 0;
      const devCosts = w.developmentCosts;
      for (const gene in devCosts) {
        const geneVal = this.dna.genes[gene] || 0;
        totalDevCost += geneVal * devCosts[gene];
      }
      const devCostPerSecond = totalDevCost / maturityTime;

      if (this.developmentProgress < 1) {
        this.energy -= devCostPerSecond * dt;
      } else {
        this.mature = true;
      }
    }

    // Metabolic costs using weight matrix
    let basalCost = 0.05 * (1 + this.size * 1.5);
    basalCost *= (1 - this.metabolicEfficiency * 0.5);

    // Feature maintenance using weights
    let maintenanceCost = 0;
    const ec = w.energyCosts;
    for (const gene in ec) {
      const geneVal = this.dna.genes[gene] || 0;
      maintenanceCost += geneVal * ec[gene];
    }

    // Temperature cost
    const temp = biome ? biome.temp : 20;
    let tempCost = 0;
    if (temp < 10) {
      tempCost = (10 - temp) * 0.03 * (1 - this.coldResistance);
    } else if (temp > 30) {
      tempCost = (temp - 30) * 0.03 * (1 - this.heatResistance);
    }

    // Movement cost
    const speed = Math.sqrt(this.velocity.x ** 2 + this.velocity.y ** 2 + this.velocity.z ** 2);
    let moveCost = speed * speed * 0.08;
    moveCost *= (1 + this.speed * 1.5);

    if (this.position.y < 0) {
      moveCost *= (1 + this.limbs * w.movement.limbsWaterDrag);
    } else {
      moveCost *= (1 - this.limbs * w.movement.limbsLandBonus);
    }

    const totalCost = (basalCost + moveCost + tempCost + maintenanceCost) * dt;
    this.energy -= totalCost;

    // Filter Feeding - primary food source for primitive creatures
    const ff = w.filterFeeding;
    if (this.position.y < 0 && speed < ff.maxSpeed) {
      const filterGain = ff.baseGain * dt *
        (1 + this.filterFeeding * ff.filterFeedingMultiplier) *
        (1 + this.smell * ff.smellBonus) *
        (1 - this.predatory * 0.5);
      this.energy += filterGain;
    }

    if (this.energy <= 0) {
      this.dead = true;
      this.causeOfDeath = 'starvation';
      return null;
    }

    // Movement physics
    this.velocity.x += this.acceleration.x;
    this.velocity.y += this.acceleration.y;
    this.velocity.z += this.acceleration.z;

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

    const newX = this.position.x + this.velocity.x;
    const newY = this.position.y + this.velocity.y;
    const newZ = this.position.z + this.velocity.z;

    const newTerrainHeight = getTerrainHeight(newX, newZ);
    const newMinY = newTerrainHeight + this.size;

    if (newY < newMinY) {
      this.position.x = newX;
      this.position.z = newZ;
      this.position.y = newMinY;
      if (this.velocity.y < 0) this.velocity.y = 0;
    } else {
      this.position.x = newX;
      this.position.y = newY;
      this.position.z = newZ;
    }

    this.acceleration = { x: 0, y: 0, z: 0 };

    // Reproduction using weights
    const rep = w.reproduction;
    if (this.mature && this.energy > rep.energyThresholdBase) {
      const threshold = rep.energyThresholdBase + rep.energyThresholdRange * (1 - this.reproductionUrgency);
      if (this.energy > threshold) {
        return this.reproduce();
      }
    }
    return null;
  }

  // Combat using weight matrix
  attack(target) {
    if (!this.mature || this.predatory < 0.3 || this.jaws < 0.2) {
      return false;
    }

    const cw = this.dna.weights.combat;
    const attackPower = (
      this.size * cw.attackPower.size +
      this.jaws * cw.attackPower.jaws +
      this.predatory * cw.attackPower.predatory
    );
    const defensePower = (
      target.size * cw.defensePower.size +
      target.armor * cw.defensePower.armor
    );

    // Toxicity defense
    if (target.toxicity > 0.3) {
      const toxicDamage = target.toxicity * cw.toxicDamage;
      this.energy -= toxicDamage;
    }

    const successChance = attackPower / (attackPower + defensePower);

    if (Math.random() < successChance) {
      const damage = attackPower * (0.5 + Math.random() * 0.5);
      target.energy -= damage;
      const energyGain = damage * 0.5 * (1 + this.jaws * 0.5);
      this.energy += energyGain;
      this.energy -= 5;

      if (target.energy <= 0) {
        target.dead = true;
        target.causeOfDeath = 'predation';
        return true;
      }
    } else {
      this.energy -= 3;
    }

    return false;
  }

  scavenge(corpse) {
    const baseGain = Math.min(corpse.energy, 20);
    let efficiency = 0.3 + this.scavenging * 0.7;

    if (corpse.toxicity > 0.3 && this.toxicity < corpse.toxicity) {
      const toxicDamage = (corpse.toxicity - this.toxicity) * this.dna.weights.combat.toxicDamage * 0.5;
      this.energy -= toxicDamage;
    }

    const energyGained = baseGain * efficiency;
    this.energy += energyGained;
    corpse.energy -= baseGain;
    return baseGain;
  }

  reproduce() {
    const rep = this.dna.weights.reproduction;
    this.energy *= rep.offspringEnergyRatio;
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
      sight: this.sight,
      smell: this.smell,
      hearing: this.hearing,
      filterFeeding: this.filterFeeding,
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

  // Spawn initial plants - heavily biased toward water where creatures start
  // 80% in water (z < -100), 20% on land
  for (let i = 0; i < 2000; i++) {
    const x = (Math.random() - 0.5) * WORLD_SIZE.width;

    // Bias toward water zones where creatures live
    let z;
    if (Math.random() < 0.8) {
      // Water zone: z from -100 to -500 (deep water where creatures spawn)
      z = -100 - Math.random() * 400;
    } else {
      // Land zone: z from -100 to +500
      z = -100 + Math.random() * 600;
    }

    const terrainH = getTerrainHeight(x, z);

    // Water zone is z < -100
    const isInWaterZone = z < -100;
    const isOnLand = !isInWaterZone;

    let y;
    if (isOnLand) {
      // Land plants sit on the terrain surface
      y = terrainH + 0.5;
    } else {
      // Water plants float at various depths - spread throughout water column
      const waterDepth = Math.abs(terrainH);
      // Plants grow throughout water column where creatures swim
      y = terrainH + 1 + Math.random() * Math.max(waterDepth * 0.6, 8);
    }

    const plant = new WorkerPlant({ x, y, z }, nextPlantId++, isOnLand);
    plant.energy = plant.maxEnergy * 0.5;
    plants.push(plant);
  }

  // Spawn creatures in deep water (z < -200)
  // Start as blind, simple filter feeders - like early life forms
  for (let i = 0; i < SIMULATION_CONFIG.initialPopulation; i++) {
    const x = (Math.random() - 0.5) * WORLD_SIZE.width * 0.8;
    const z = -200 - Math.random() * 250;  // Deep water zone
    const terrainHeight = getTerrainHeight(x, z);
    const y = terrainHeight + 2 + Math.random() * 10;  // Above terrain, in water

    // Create blind filter feeders - all genes start near zero
    // They will evolve everything from scratch
    const initialGenes = {
      // Tiny size, no speed - just float with currents
      size: 0.05 + Math.random() * 0.1,
      speed: Math.random() * 0.05,

      // Blind - no sight, minimal smell (chemical detection), no hearing
      sight: 0,
      smell: 0.1 + Math.random() * 0.1,  // Basic chemical sensing for plankton
      hearing: 0,

      // No defenses
      camouflage: 0,
      armor: 0,
      toxicity: 0,

      // Efficient metabolism (they need to survive on filter feeding)
      metabolicEfficiency: 0.4 + Math.random() * 0.3,

      // Temperature neutral
      coldResistance: 0.1,
      heatResistance: 0.1,

      // Water-only - no lungs or limbs
      lungCapacity: 0,
      limbs: 0,

      // No complex behaviors
      jaws: 0,
      predatory: 0,
      scavenging: 0.2 + Math.random() * 0.2,  // Can eat nearby corpses
      parasitic: 0,

      // Moderate reproduction
      reproductionUrgency: 0.3 + Math.random() * 0.3,
      maneuverability: Math.random() * 0.1,

      // Primary food source - filter feeding!
      filterFeeding: 0.5 + Math.random() * 0.3
    };

    const dna = new DNA(initialGenes);
    const creature = new WorkerCreature(dna, { x, y, z }, nextCreatureId++);
    creature.energy = 150;  // Modest starting energy
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
      // Creatures should stay near the bottom/mid where plants are
      const waterDepth = Math.abs(terrainHeight);  // How deep the water is here
      // Target lower in water column where plants grow (bottom third)
      const targetY = terrainHeight + Math.min(waterDepth * 0.4, 5) + c.size;
      const depthError = targetY - c.position.y;

      // Gentle buoyancy adjustment
      c.velocity.y += depthError * 0.03;
      c.velocity.y *= 0.85;

      // Keep below water surface
      if (c.position.y > -1) {
        c.velocity.y -= 0.05;
      }

      // Water drag - high drag makes creatures slow down quickly
      c.velocity.x *= 0.95;
      c.velocity.y *= 0.95;
      c.velocity.z *= 0.95;

      // Current - directly moves creatures (same as plants for consistency)
      // Creatures drift with current unless they have high speed to resist
      const current = getCurrentAt(c.position.x, c.position.z, terrainHeight);
      const currentResistance = c.speed * 0.5; // Higher speed = resist current more
      const currentInfluence = 1.0 - currentResistance;
      // Apply current directly to position (like plants) scaled by dt
      c.position.x += current.x * dt * 3 * currentInfluence;
      c.position.z += current.z * dt * 3 * currentInfluence;

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
      // Calculate water depth for sense effectiveness
      const waterDepth = isInWater ? Math.abs(terrainHeight) : 0;
      const effectiveSenseRange = c.getSenseRange(isInWater, waterDepth);
      const gridRange = Math.ceil(effectiveSenseRange / 50) + 1;
      const nearbyCreatures = creatureSpatialGrid.getNearby(c.position.x, c.position.z, gridRange);

      // Collect valid prey targets with their scores
      const validPrey = [];

      for (const target of nearbyCreatures) {
        if (target === c || target.dead) continue;

        const dx = target.position.x - c.position.x;
        const dy = target.position.y - c.position.y;
        const dz = target.position.z - c.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Use the new sense-based detection system
        if (!c.canDetect(target, dist, isInWater, waterDepth)) continue;

        // Score prey: prefer smaller, weaker targets nearby
        const sizeDiff = c.size - target.size;
        const armorPenalty = target.armor * 30;
        const toxicPenalty = target.toxicity * 50;
        const distPenalty = dist * 0.5;
        const score = sizeDiff * 20 - armorPenalty - toxicPenalty - distPenalty + target.energy * 0.1;

        if (score > -20) {  // Only consider viable prey
          validPrey.push({ target, dist, score });
        }
      }

      // Pick from top prey candidates (not always the absolute best)
      let targetPrey = null;
      let targetDist = 0;

      if (validPrey.length > 0) {
        // Sort by score, pick randomly from top 3
        validPrey.sort((a, b) => b.score - a.score);
        const pickFrom = Math.min(3, validPrey.length);
        const picked = validPrey[Math.floor(Math.random() * pickFrom)];
        targetPrey = picked.target;
        targetDist = picked.dist;
      }

      if (targetPrey) {
        // Move towards prey (slowly)
        const dx = targetPrey.position.x - c.position.x;
        const dy = targetPrey.position.y - c.position.y;
        const dz = targetPrey.position.z - c.position.z;

        if (targetDist > 0) {
          const huntSpeed = c.maxForce * (0.5 + c.predatory * 0.5);
          c.acceleration.x += (dx / targetDist) * huntSpeed;
          c.acceleration.y += (dy / targetDist) * huntSpeed * 0.3;
          c.acceleration.z += (dz / targetDist) * huntSpeed;
        }

        // Attack if close enough
        if (targetDist < 3 + c.size + targetPrey.size) {
          const killed = c.attack(targetPrey);
          if (killed) {
            // Create corpse from killed prey
            const corpse = new WorkerCorpse(targetPrey, nextCorpseId++);
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

    // Separation behavior - creatures avoid crowding each other
    const separationRange = 5 + c.size * 3;
    const nearbyForSeparation = creatureSpatialGrid.getNearby(c.position.x, c.position.z, 1);
    let separationX = 0;
    let separationZ = 0;
    let separationCount = 0;

    for (const other of nearbyForSeparation) {
      if (other === c || other.dead) continue;

      const dx = c.position.x - other.position.x;
      const dy = c.position.y - other.position.y;
      const dz = c.position.z - other.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < separationRange && dist > 0.1) {
        // Push away from nearby creatures, stronger when closer
        const strength = (separationRange - dist) / separationRange;
        separationX += (dx / dist) * strength;
        separationZ += (dz / dist) * strength;
        separationCount++;
      }
    }

    if (separationCount > 0) {
      // Apply separation force
      const sepForce = 0.02;
      c.acceleration.x += separationX * sepForce;
      c.acceleration.z += separationZ * sepForce;
    }

    // Foraging behavior - hungry creatures actively seek plants
    if (c.energy < 120 && c.predatory < 0.7) {
      // Use senses to find food
      const waterDepth = isInWater ? Math.abs(terrainHeight) : 0;
      const foodSenseRange = c.getSenseRange(isInWater, waterDepth) * 0.7; // Shorter range for food
      const gridRange = Math.ceil(foodSenseRange / 50) + 1;
      const nearbyPlants = spatialGrid.getNearby(c.position.x, c.position.z, gridRange);

      // Collect valid plant targets instead of just finding closest
      const validPlants = [];

      for (const plant of nearbyPlants) {
        if (plant.dead) continue;

        const dx = plant.position.x - c.position.x;
        const dy = plant.position.y - c.position.y;
        const dz = plant.position.z - c.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Check if within sense range (smell works well for finding plants)
        const plantDetectRange = 5 + c.smell * 30 + c.sight * (isInWater ? 10 : 20);
        if (dist < plantDetectRange) {
          validPlants.push({ plant, dist });
        }
      }

      // Pick a random plant from the top candidates (not always the absolute closest)
      let targetPlant = null;
      let targetDist = 0;

      if (validPlants.length > 0) {
        // Sort by distance, then pick randomly from the top 3
        validPlants.sort((a, b) => a.dist - b.dist);
        const pickFrom = Math.min(3, validPlants.length);
        const picked = validPlants[Math.floor(Math.random() * pickFrom)];
        targetPlant = picked.plant;
        targetDist = picked.dist;
      }

      // Move towards selected plant
      if (targetPlant && targetDist > 3) {
        const dx = targetPlant.position.x - c.position.x;
        const dy = targetPlant.position.y - c.position.y;
        const dz = targetPlant.position.z - c.position.z;
        const dist = targetDist;

        // Hunger increases foraging speed
        const hungerFactor = Math.max(0.5, (120 - c.energy) / 60);
        const forageSpeed = c.maxForce * hungerFactor;

        c.acceleration.x += (dx / dist) * forageSpeed;
        c.acceleration.y += (dy / dist) * forageSpeed * 0.2;
        c.acceleration.z += (dz / dist) * forageSpeed;
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

      // Keep plants in the lower water column where creatures swim
      const currentTerrainH = getTerrainHeight(p.position.x, p.position.z);
      const currentWaterDepth = Math.abs(currentTerrainH);
      const maxPlantY = currentTerrainH + Math.min(currentWaterDepth * 0.4, 5) + 1;

      if (p.position.y < currentTerrainH + 0.5) {
        p.position.y = currentTerrainH + 0.5;
      }
      // Keep in lower portion of water column
      if (p.position.y > maxPlantY) {
        p.position.y = maxPlantY;
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
      // Water plants stay in the lower portion where creatures swim
      const waterDepth = Math.abs(terrainH);
      y = terrainH + 0.5 + Math.random() * Math.min(waterDepth * 0.4, 5);
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

  // Random spawn plants - biased toward water where creatures need food
  const plantSpawnChance = SIMULATION_CONFIG.foodSpawnRate * 0.5 * (1 - plants.length / SIMULATION_CONFIG.maxPlants);

  if (Math.random() < plantSpawnChance && plants.length < SIMULATION_CONFIG.maxPlants) {
    const x = (Math.random() - 0.5) * WORLD_SIZE.width * 0.95;  // Stay within bounds

    // Bias toward water zones (70% water, 30% land)
    let z;
    if (Math.random() < 0.7) {
      // Water zone
      z = -100 - Math.random() * 400;
    } else {
      // Land zone
      z = -100 + Math.random() * 600;
    }

    const terrainH = getTerrainHeight(x, z);

    // Water zone is z < -100
    const isInWaterZone = z < -100;
    const isOnLand = !isInWaterZone;

    let y;
    if (isOnLand) {
      // Land plants sit on the terrain surface
      y = terrainH + 0.5;
    } else {
      // Water plants float throughout water column
      const waterDepth = Math.abs(terrainH);
      y = terrainH + 1 + Math.random() * Math.max(waterDepth * 0.6, 8);
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
