// Web Worker for simulation physics and logic
// This runs all the heavy computation off the main thread

import { createNoise2D } from 'simplex-noise';
import { WORLD_SIZE, SIMULATION_CONFIG, BIOMES, GENE_DEFINITIONS, DEFAULT_GENE_WEIGHTS, WEIGHT_MUTATION } from './Constants.js';
import {
  attachSharedBuffer,
  writeCreature,
  writePlant,
  writeCorpse,
  HEADER,
  MAX_CREATURES,
  MAX_PLANTS,
  MAX_CORPSES
} from './SharedBuffer.js';

// Worker state
let creatures = [];
let plants = [];
let corpses = [];  // Dead creatures become food sources
let time = 0;
let currentTime = 0;
let noise2D = null;
let currentNoise = null;

// Shared buffer for zero-copy data transfer
let sharedBuffer = null;
let useSharedBuffer = false;

// Terrain height cache - cleared each frame
// Key: quantized (x,z) -> height value
// Using 1-unit grid for cache (positions rounded to nearest integer)
const terrainCache = new Map();

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
  // Check cache first (quantize to 2-unit grid for good cache hit rate)
  const qx = Math.round(x * 0.5);
  const qz = Math.round(z * 0.5);
  const key = qx * 100000 + qz;  // Simple hash for integer coords

  const cached = terrainCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

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

  const height = baseHeight + noise;
  terrainCache.set(key, height);
  return height;
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

// Calculate how well a creature's color matches the environment (0-1)
// Returns higher values when creature color matches biome colors
function getEnvironmentCamoMatch(colorHue, biome) {
  if (!biome) return 0.5; // Neutral if no biome

  // Define ideal hue ranges for each biome (0-1 scale)
  // Hue: 0=red, 0.08=orange, 0.17=yellow, 0.33=green, 0.5=cyan, 0.67=blue, 0.83=purple
  const biomeHues = {
    'Deep Water': { center: 0.6, range: 0.15 },     // Deep blue
    'Shoals': { center: 0.55, range: 0.2 },         // Blue-green
    'Beach': { center: 0.12, range: 0.15 },         // Tan/sandy
    'Grassland': { center: 0.33, range: 0.15 },     // Green
    'Desert': { center: 0.1, range: 0.12 },         // Orange/tan
    'Tundra': { center: 0.0, range: 0.5 },          // White/gray (any desaturated works)
  };

  const hueInfo = biomeHues[biome.name];
  if (!hueInfo) return 0.5;

  // Calculate hue distance (wrapping around 0-1)
  let hueDiff = Math.abs(colorHue - hueInfo.center);
  if (hueDiff > 0.5) hueDiff = 1 - hueDiff; // Wrap around

  // Score: 1.0 if perfect match, decreasing as hue differs
  // Within range = good camouflage, outside range = poor
  if (hueDiff <= hueInfo.range) {
    return 1.0 - (hueDiff / hueInfo.range) * 0.3; // 0.7-1.0 within range
  } else {
    const excess = hueDiff - hueInfo.range;
    return Math.max(0.1, 0.7 - excess * 2); // Drops quickly outside range
  }
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
  
  // Multi-layered noise for chaotic flow
  // Layer 1: Large slow swirls
  const scale1 = 0.002;
  const n1 = currentNoise(x * scale1, z * scale1 + t * 0.05);
  const angle1 = n1 * Math.PI * 4;
  
  // Layer 2: Smaller faster eddies
  const scale2 = 0.01;
  const n2 = currentNoise(x * scale2 - t * 0.1, z * scale2);
  const angle2 = n2 * Math.PI * 2;
  
  // Combine flows
  let currentX = Math.cos(angle1) * 1.5 + Math.cos(angle2) * 0.5;
  let currentZ = Math.sin(angle1) * 1.5 + Math.sin(angle2) * 0.5;
  
  // Vertical mixing (upwelling/downwelling)
  // Use a third noise layer for vertical flow
  const scale3 = 0.015;
  const n3 = currentNoise(x * scale3 + 100, z * scale3 + t * 0.1);
  let currentY = n3 * 0.5;

  // Boundary/Terrain interaction
  // Flow should generally follow terrain contours or be deflected
  if (terrainHeight > -20) {
     // Near shore/shallow: Push away or along shore
     // Simple repulsion from shallow areas
     const depthFactor = Math.max(0, (-terrainHeight) / 20); // 0 at surface, 1 at -20
     currentX *= depthFactor;
     currentZ *= depthFactor;
     
     // Add some wave action pushing to shore then pulling back
     const wave = Math.sin(t * 1.0 + x * 0.05);
     currentX += wave * 0.5 * (1 - depthFactor);
  }
  
  return { x: currentX, y: currentY, z: currentZ };
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

// Possible emergent features from gene interactions
const EMERGENT_FEATURES = ['wings', 'bioluminescence', 'spikes', 'tail', 'horn', 'shell'];

// DNA class - carries both gene values and weight matrices
class DNA {
  constructor(genes = null, weights = null, variativeness = null, interactions = null) {
    // Gene values (0-1 range)
    this.genes = {};
    // Gene variativeness (0-1 range) - controls physical form/type of features
    this.variativeness = {};

    const geneKeys = Object.keys(GENE_DEFINITIONS);

    geneKeys.forEach(key => {
      if (genes && genes[key] !== undefined) {
        // Accept either {value: x, variativeness: y} or just x
        const val = typeof genes[key] === 'object' ? genes[key].value : genes[key];
        this.genes[key] = Math.max(0, Math.min(1, val));
      } else {
        this.genes[key] = 0; // Start at 0 - blind filter feeders
      }

      // Initialize variativeness
      if (variativeness && variativeness[key] !== undefined) {
        this.variativeness[key] = Math.max(0, Math.min(1, variativeness[key]));
      } else {
        // Random initial variativeness for diversity
        this.variativeness[key] = Math.random();
      }
    });

    // Gene interactions - randomly generated coefficients that determine
    // how gene combinations produce emergent features
    // Each interaction maps a gene pair to a feature with a weight
    if (interactions) {
      this.interactions = deepClone(interactions);
    } else {
      this.interactions = this.generateRandomInteractions(geneKeys);
    }

    // Weight matrix - each creature carries its own copy
    this.weights = weights ? deepClone(weights) : deepClone(DEFAULT_GENE_WEIGHTS);
  }

  // Generate random gene interaction coefficients
  generateRandomInteractions(geneKeys) {
    const interactions = {};

    // Each emergent feature gets random gene pair interactions
    EMERGENT_FEATURES.forEach(feature => {
      interactions[feature] = {
        // Pick 2-4 random gene pairs that contribute to this feature
        pairs: [],
        threshold: 0.5 + Math.random() * 0.5, // 0.5 to 1.0 threshold to activate
      };

      const numPairs = 2 + Math.floor(Math.random() * 3); // 2-4 pairs
      const usedPairs = new Set();

      for (let i = 0; i < numPairs; i++) {
        // Pick two different genes
        const gene1 = geneKeys[Math.floor(Math.random() * geneKeys.length)];
        let gene2 = geneKeys[Math.floor(Math.random() * geneKeys.length)];
        while (gene2 === gene1) {
          gene2 = geneKeys[Math.floor(Math.random() * geneKeys.length)];
        }

        const pairKey = [gene1, gene2].sort().join('+');
        if (usedPairs.has(pairKey)) continue;
        usedPairs.add(pairKey);

        interactions[feature].pairs.push({
          gene1,
          gene2,
          weight: (Math.random() - 0.3) * 2, // -0.6 to 1.4 (bias toward positive)
          useVariativeness: Math.random() > 0.7, // 30% chance to use variativeness instead
        });
      }
    });

    return interactions;
  }

  // Calculate emergent feature values based on gene interactions
  getEmergentFeatures() {
    const features = {};

    EMERGENT_FEATURES.forEach(feature => {
      const interaction = this.interactions[feature];
      if (!interaction || !interaction.pairs.length) {
        features[feature] = 0;
        return;
      }

      // Sum up contributions from all gene pairs
      let total = 0;
      interaction.pairs.forEach(pair => {
        const val1 = pair.useVariativeness
          ? this.variativeness[pair.gene1] || 0
          : this.genes[pair.gene1] || 0;
        const val2 = pair.useVariativeness
          ? this.variativeness[pair.gene2] || 0
          : this.genes[pair.gene2] || 0;

        // Multiplicative interaction - both genes need to be present
        total += val1 * val2 * pair.weight;
      });

      // Normalize and apply threshold
      const normalized = total / interaction.pairs.length;
      features[feature] = normalized > interaction.threshold
        ? (normalized - interaction.threshold) / (1 - interaction.threshold)
        : 0;
      features[feature] = Math.max(0, Math.min(1, features[feature]));
    });

    return features;
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

        // Bonus mutation: small chance to get a significant boost (unlocking abilities)
        if (Math.random() < 0.05) {
           mutation += (Math.random() * 0.2 + 0.1); // Add 0.1 to 0.3
        }

        this.genes[randomKey] = Math.max(0, Math.min(1, currentVal + mutation));

        // Also mutate variativeness sometimes (affects limb type, etc.)
        if (Math.random() < 0.3) {
          const varMutation = gaussianRandom() * 0.15;
          this.variativeness[randomKey] = Math.max(0, Math.min(1,
            this.variativeness[randomKey] + varMutation));
        }
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

  // Mutate gene interaction weights
  mutateInteractions() {
    if (Math.random() < 0.1) { // 10% chance to mutate interactions
      const features = Object.keys(this.interactions);
      const feature = features[Math.floor(Math.random() * features.length)];
      const interaction = this.interactions[feature];

      if (interaction.pairs.length > 0) {
        const pairIdx = Math.floor(Math.random() * interaction.pairs.length);
        const pair = interaction.pairs[pairIdx];

        // Mutate weight or threshold
        if (Math.random() < 0.7) {
          // Mutate pair weight
          pair.weight += gaussianRandom() * 0.3;
          pair.weight = Math.max(-1.5, Math.min(2.0, pair.weight));
        } else {
          // Mutate threshold
          interaction.threshold += gaussianRandom() * 0.1;
          interaction.threshold = Math.max(0.2, Math.min(1.0, interaction.threshold));
        }
      }
      return true;
    }
    return false;
  }

  mutate() {
    const genesMutated = this.mutateGenes();
    const weightsMutated = this.mutateWeights();
    const interactionsMutated = this.mutateInteractions();
    return genesMutated || weightsMutated || interactionsMutated;
  }

  clone() {
    return new DNA(
      deepClone(this.genes),
      deepClone(this.weights),
      deepClone(this.variativeness),
      deepClone(this.interactions)
    );
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
      weights: deepClone(this.weights),
      variativeness: deepClone(this.variativeness),
      interactions: deepClone(this.interactions)
    };
  }
}

// Frame counter for staggered updates
let globalFrameCount = 0;

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

    // Stagger expensive updates across frames (each creature has different offset)
    this.updateOffset = id % 8;  // 0-7, determines which frame group this creature is in

    this.cacheGeneValues();
    this.calculateMaxAge();
  }

  // Check if this creature should do expensive operations this frame
  shouldDoExpensiveUpdate() {
    return (globalFrameCount % 8) === this.updateOffset;
  }

  // Cache gene values for quick access
  cacheGeneValues() {
    const g = this.dna.genes;
    this.size = g.size || 0;
    this.speed = g.speed || 0;
    this.sight = g.sight || 0;
    this.smell = g.smell || 0;
    this.hearing = g.hearing || 0;
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
    this.colorHue = g.colorHue || 0.33; // Default to green
    this.colorSaturation = g.colorSaturation || 0.5;

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

  // Detection based on color matching environment
  // Creatures with colors matching their biome are harder to spot (but never invisible)
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
    if (totalSense > 0 && sightContribution > 0) {
      // Get target's current biome and calculate color match
      const targetBiome = getBiomeAt(target.position.x, target.position.z);
      const targetColorHue = target.colorHue !== undefined ? target.colorHue : 0.33;
      const colorMatch = getEnvironmentCamoMatch(targetColorHue, targetBiome);

      // Color matching reduces detection, but only for sight-based detection
      // Max 40% reduction when perfectly matched (creatures always remain somewhat visible)
      const camoEffect = colorMatch * 0.4 * (sightContribution / totalSense);
      detectionChance = 1.0 - camoEffect;
    }
    // Distance also affects detection
    detectionChance *= (1.0 - (distance / senseRange) * 0.5);

    // Minimum 30% detection chance - creatures are never invisible
    detectionChance = Math.max(0.3, detectionChance);

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
      const maturityTime = w.reproduction.maturityAge || 15;
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
    
    // Armor is significantly more expensive to maintain
    if (this.armor > 0.3) {
      const armorPenalty = this.armor * 0.15; // Up to 15% extra cost at max armor
      maintenanceCost *= (1 + armorPenalty);
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
      let threshold = rep.energyThresholdBase + rep.energyThresholdRange * (1 - this.reproductionUrgency);
      // Predators can reproduce at lower threshold (meat is calorie-dense)
      if (this.predatory > 0.5) {
        threshold *= 0.6; // Predators need 40% less energy to reproduce
      }
      if (this.energy > threshold) {
        return this.reproduce();
      }
    }
    return null;
  }

  // Combat using weight matrix
  attack(target) {
    if (this.predatory < 0.3 || this.jaws < 0.2) {
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
      // High energy gain from successful attacks (meat is nutritious)
      const energyGain = damage * 0.9 * (1 + this.jaws * 0.5);
      this.energy += energyGain;
      this.energy -= 2; // Low attack cost

      if (target.energy <= 0) {
        target.dead = true;
        target.causeOfDeath = 'predation';
        return true;
      }
    } else {
      this.energy -= 2; // Low cost for failed attack
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

  // Serialize for transfer to main thread - FULL data (for new creatures only)
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
      parasitic: this.parasitic,
      lungCapacity: this.lungCapacity,
      sight: this.sight,
      smell: this.smell,
      hearing: this.hearing,
      filterFeeding: this.filterFeeding,
      colorHue: this.colorHue,
      colorSaturation: this.colorSaturation,
      // Pass variativeness for visual limb type (fins/legs/claws)
      limbsVariativeness: this.dna.variativeness.limbs,
      jawsVariativeness: this.dna.variativeness.jaws,
      speed: this.speed,
      // Emergent features from gene interactions
      emergentFeatures: this.dna.getEmergentFeatures(),
      dna: this.dna.toData()
    };
  }

  // Serialize minimal data for per-frame updates (existing creatures)
  toUpdateData() {
    return {
      id: this.id,
      position: this.position,
      velocity: this.velocity,
      energy: this.energy,
      age: this.age,
      dead: this.dead,
      mature: this.mature,
      developmentProgress: this.developmentProgress
    };
  }
}

// Plant class for worker
class WorkerPlant {
  constructor(position, id, isOnLand = false) {
    this.id = id;
    this.position = { x: position?.x || 0, y: position?.y || 0, z: position?.z || 0 };
    this.energy = 20;  // Start with more energy
    this.maxEnergy = 50 + Math.random() * 30;  // Max energy capacity
    this.age = 0;
    this.maxAge = 80 + Math.random() * 80;  // 80-160 seconds lifespan (longer lived)
    this.dead = false;
    this.isOnLand = isOnLand;
    this.mature = false;  // Plants need to mature before reproducing
    this.reproductionCooldown = 0;
  }

  update(dt, biome) {
    this.age += dt;

    // Maturity at 20% of lifespan
    if (!this.mature && this.age > this.maxAge * 0.2) {
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
    // Water plants (isOnLand=false) use chemosynthesis from thermal vents
    // Land plants use photosynthesis
    let energyGain = 0;

    if (this.isOnLand) {
      // Land plants - photosynthesis from sunlight
      energyGain = 1.5 * dt;
    } else {
      // Water plants - chemosynthesis from thermal vents and nutrients
      // All water plants get decent energy regardless of depth
      energyGain = 1.2 * dt;  // Good energy from chemosynthesis
    }

    // Temperature affects growth rate
    if (biome) {
      if (biome.temp < 0) {
        energyGain *= 0.5;  // Cold slows growth
      } else if (biome.temp > 30) {
        energyGain *= 1.2;  // Warm speeds growth
      }
    }

    this.energy = Math.min(this.maxEnergy, this.energy + energyGain);

    // Reproduction - mature plants with enough energy can spawn offspring
    if (this.mature && this.energy > this.maxEnergy * 0.6 && this.reproductionCooldown <= 0) {
      this.reproductionCooldown = 8 + Math.random() * 8;  // 8-16 second cooldown (faster reproduction)
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

    // Corpses no longer decay over time - they persist until eaten
    // This makes scavenging a reliable food source
    
    // Only mark as dead when completely consumed
    if (this.energy <= 0) {
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
      armor: 0,
      toxicity: 0,

      // Random color (blue-ish for water creatures)
      colorHue: 0.5 + Math.random() * 0.2, // Blue-cyan range
      colorSaturation: 0.3 + Math.random() * 0.3,

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

// Performance tracking
let perfLastLog = 0;
let perfUpdateCount = 0;
let perfTotalSimTime = 0;
let perfTotalSerializeTime = 0;
let perfTotalGridTime = 0;
let perfTotalCreatureLoop = 0;
let perfTotalPlantLoop = 0;
// Granular creature loop timing
let perfCreatureUpdate = 0;
let perfCreaturePhysics = 0;
let perfCreatureInteractions = 0;
let perfCreaturePlantEating = 0;

// Main simulation update
function update(dt, cameraX = 0, cameraY = 0, cameraZ = 0, cullDistance = 300) {
  const t0 = performance.now();

  // Cap terrain cache size to prevent unbounded memory growth
  // Since terrain is static, we keep the cache across frames for better performance
  if (terrainCache.size > 50000) {
    terrainCache.clear();
  }

  globalFrameCount++;
  time += dt;
  currentTime += dt;

  const newCreatures = [];
  const deadCreatureIds = [];
  const newCorpses = [];
  const deadCorpseIds = [];

  // Track energy sources for statistics
  const energyStats = {
    plants: 0,
    meat: 0,
    filter: 0
  };

  // Track creature stats (calculated during creature loop - no extra iteration needed)
  let maxGeneration = 0;
  let matureCount = 0;
  let totalAge = 0;
  let predatorCount = 0;
  let parasiteCount = 0;
  let scavengerCount = 0;
  let herbivoreCount = 0;
  const geneAverages = {
    size: 0, speed: 0, sight: 0, smell: 0, hearing: 0,
    armor: 0, metabolicEfficiency: 0, toxicity: 0, coldResistance: 0,
    heatResistance: 0, lungCapacity: 0, scavenging: 0, parasitic: 0,
    reproductionUrgency: 0, maneuverability: 0, predatory: 0,
    limbs: 0, jaws: 0, filterFeeding: 0, colorHue: 0, colorSaturation: 0
  };

  // Build creature spatial grid for hunting
  const tGrid0 = performance.now();
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
  const tGrid1 = performance.now();
  perfTotalGridTime += tGrid1 - tGrid0;

  // Update creatures
  const tCreature0 = performance.now();
  let tPhysicsAccum = 0, tInteractionsAccum = 0, tUpdateAccum = 0;
  for (let i = creatures.length - 1; i >= 0; i--) {
    const c = creatures[i];
    const tLoopStart = performance.now();

    // Collect stats while iterating (no separate loop needed)
    if (c.generation > maxGeneration) maxGeneration = c.generation;
    if (c.mature) matureCount++;
    totalAge += c.age;

    // Population breakdown
    if (c.predatory > 0.4) predatorCount++;
    else if (c.parasitic > 0.4) parasiteCount++;
    else if (c.scavenging > 0.4) scavengerCount++;
    else herbivoreCount++;

    // Gene averages (using cached values on creature)
    geneAverages.size += c.size;
    geneAverages.speed += c.speed;
    geneAverages.sight += c.sight;
    geneAverages.smell += c.smell;
    geneAverages.hearing += c.hearing;
    geneAverages.armor += c.armor;
    geneAverages.metabolicEfficiency += c.metabolicEfficiency;
    geneAverages.toxicity += c.toxicity;
    geneAverages.coldResistance += c.coldResistance;
    geneAverages.heatResistance += c.heatResistance;
    geneAverages.lungCapacity += c.lungCapacity;
    geneAverages.scavenging += c.scavenging;
    geneAverages.parasitic += c.parasitic;
    geneAverages.reproductionUrgency += c.reproductionUrgency;
    geneAverages.maneuverability += c.maneuverability;
    geneAverages.predatory += c.predatory;
    geneAverages.limbs += c.limbs;
    geneAverages.jaws += c.jaws;
    geneAverages.filterFeeding += c.filterFeeding;
    geneAverages.colorHue += c.colorHue;
    geneAverages.colorSaturation += c.colorSaturation;

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
      // Current - directly moves creatures (same as plants for consistency)
      // Creatures drift with current unless they have high speed to resist
      const current = getCurrentAt(c.position.x, c.position.z, terrainHeight);
      const currentResistance = c.speed * 0.5; // Higher speed = resist current more
      const currentInfluence = 1.0 - currentResistance;
      // Apply current directly to position (like plants) scaled by dt
      c.position.x += current.x * dt * 3 * currentInfluence;
      c.position.y += current.y * dt * 3 * currentInfluence; // Vertical mixing
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

    // Active swimming/movement behavior - creatures with speed actively move
    // This gives evolved speed genes a purpose even when not hunting/foraging
    // Active swimming/movement behavior - creatures with speed actively move
    // This gives evolved speed genes a purpose even when not hunting/foraging
    if (c.speed > 0.1 || c.maneuverability > 0.1) {
      // Significantly increased base force so movement is visible
      // Was 0.3 base, now 0.8
      const swimForce = c.maxForce * (0.8 + c.speed * 1.5 + c.maneuverability * 0.5);

      if (isInWater) {
        // Swimming - random exploration with momentum
        if (Math.random() < 0.03 * (1 + c.maneuverability)) {
          // Change direction occasionally (more often with high maneuverability)
          const angle = Math.random() * Math.PI * 2;
          c.acceleration.x += Math.cos(angle) * swimForce;
          c.acceleration.z += Math.sin(angle) * swimForce;
          // Slight vertical movement for 3D swimming
          c.acceleration.y += (Math.random() - 0.5) * swimForce * 0.5;
        } else if (Math.random() < 0.1) {
          // Continue in roughly same direction with small adjustments
          const vLen = Math.sqrt(c.velocity.x ** 2 + c.velocity.z ** 2);
          if (vLen > 0.01) {
            // Boost in current direction
            c.acceleration.x += (c.velocity.x / vLen) * swimForce * 0.5;
            c.acceleration.z += (c.velocity.z / vLen) * swimForce * 0.5;
          }
        }

        // Limbs can aid swimming when creature learns to use them
        if (c.limbs > 0.2) {
          const limbSwimBonus = c.limbs * c.dna.weights.movement.limbsSwimBonus;
          c.acceleration.x *= (1 + limbSwimBonus);
          c.acceleration.z *= (1 + limbSwimBonus);
        }
      } else if (c.limbs > 0.3) {
        // Land movement - requires limbs
        if (Math.random() < 0.05 * c.limbs) {
          const angle = Math.random() * Math.PI * 2;
          const landForce = swimForce * c.limbs;
          c.acceleration.x += Math.cos(angle) * landForce;
          c.acceleration.z += Math.sin(angle) * landForce;
        }
      }
    }

    const tPhysicsEnd = performance.now();
    tPhysicsAccum += tPhysicsEnd - tLoopStart;

    // === UNIFIED CREATURE INTERACTIONS ===
    // Do ONE spatial query and handle all behaviors (hunting, scavenging, parasitism)
    // Only on staggered frames to reduce CPU load
    if (c.shouldDoExpensiveUpdate()) {
      const waterDepth = isInWater ? Math.abs(terrainHeight) : 0;
      const effectiveSenseRange = Math.min(c.getSenseRange(isInWater, waterDepth), 60); // Cap for performance
      const gridRange = Math.ceil(effectiveSenseRange / 50); // Removed +1, was too aggressive

      // Single query for all creature interactions
      const nearbyCreatures = creatureSpatialGrid.getNearby(c.position.x, c.position.z, gridRange);
      // Single query for corpse interactions
      const nearbyCorpses = (c.scavenging > 0.2 || c.predatory > 0.5) ?
        corpseSpatialGrid.getNearby(c.position.x, c.position.z, gridRange) : [];

      // Track best targets for each behavior
      let bestPrey = null, bestPreyScore = -Infinity, bestPreyDist = 0;
      let bestHost = null, bestHostScore = -Infinity, bestHostDist = 0;
      let bestCorpse = null, bestCorpseDist = Infinity;

      // Process all nearby creatures in ONE loop
      // Limit iterations for performance - check at most 50 neighbors
      let checked = 0;
      const maxToCheck = 50;
      for (const target of nearbyCreatures) {
        if (target === c || target.dead) continue;

        const dx = target.position.x - c.position.x;
        const dy = target.position.y - c.position.y;
        const dz = target.position.z - c.position.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        // Skip if too far (use squared distance to avoid sqrt)
        if (distSq > effectiveSenseRange * effectiveSenseRange) continue;

        const dist = Math.sqrt(distSq);
        checked++;

        // Skip canDetect for very close creatures (< 15 units) - they're obviously detected
        // Only do expensive detection check for distant targets
        if (dist > 15 && !c.canDetect(target, dist, isInWater, waterDepth)) continue;

        // HUNTING: Check if this is valid prey
        if (c.predatory > 0.3 && c.jaws > 0.2) {
          const canHuntPredator = (c.size > target.size * 1.3) || (target.predatory > 0.5 && c.predatory > 0.5);
          if (!(target.predatory > 0.5 && !canHuntPredator)) {
            const sizeDiff = c.size - target.size;
            const score = sizeDiff * 20 - target.armor * 30 - target.toxicity * 50 - dist * 0.5 + target.energy * 0.1;
            if (score > bestPreyScore && score > -20) {
              bestPrey = target;
              bestPreyScore = score;
              bestPreyDist = dist;
            }
          }
        }

        // PARASITISM: Check if this is valid host
        if (c.parasitic > 0.3) {
          if (target.size > c.size * 0.8 && target.energy > 30) {
            const hostScore = target.size * 10 + target.energy * 0.2 - dist - (target.toxicity * 30) - (target.armor * 20);
            if (hostScore > bestHostScore) {
              bestHost = target;
              bestHostScore = hostScore;
              bestHostDist = dist;
            }
          }
        }

        // Early exit if we've checked enough and found good targets
        if (checked >= maxToCheck && (bestPrey || bestHost)) break;
      }

      // Process corpses in ONE loop
      for (const corpse of nearbyCorpses) {
        if (corpse.dead || corpse.energy < 5) continue;
        const dx = corpse.position.x - c.position.x;
        const dy = corpse.position.y - c.position.y;
        const dz = corpse.position.z - c.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const scavBonus = c.scavenging * 20;
        const detectRange = 10 + c.smell * 40 + c.sight * 15 + scavBonus;
        if (dist < detectRange && dist < bestCorpseDist) {
          bestCorpse = corpse;
          bestCorpseDist = dist;
        }
      }

      // === EXECUTE BEST ACTIONS ===

      // Hunting action
      if (bestPrey) {
        const dx = bestPrey.position.x - c.position.x;
        const dy = bestPrey.position.y - c.position.y;
        const dz = bestPrey.position.z - c.position.z;
        if (bestPreyDist > 0) {
          const huntSpeed = c.maxForce * (0.5 + c.predatory * 0.5);
          c.acceleration.x += (dx / bestPreyDist) * huntSpeed;
          c.acceleration.y += (dy / bestPreyDist) * huntSpeed * 0.3;
          c.acceleration.z += (dz / bestPreyDist) * huntSpeed;
        }
        if (bestPreyDist < 3 + c.size + bestPrey.size) {
          const killed = c.attack(bestPrey);
          if (killed) {
            const killBonus = 40 + bestPrey.size * 30 + bestPrey.energy * 0.3;
            c.energy += killBonus;
            const corpse = new WorkerCorpse(bestPrey, nextCorpseId++);
            corpses.push(corpse);
            newCorpses.push(corpse.toData());
            energyStats.meat += killBonus + 20;
          }
        }
      }

      // Scavenging action
      if (bestCorpse && !bestPrey) {  // Only scavenge if not hunting
        const dx = bestCorpse.position.x - c.position.x;
        const dy = bestCorpse.position.y - c.position.y;
        const dz = bestCorpse.position.z - c.position.z;
        if (bestCorpseDist > 3) {
          const scavSpeed = c.maxForce * (0.5 + c.scavenging * 0.5);
          c.acceleration.x += (dx / bestCorpseDist) * scavSpeed;
          c.acceleration.y += (dy / bestCorpseDist) * scavSpeed * 0.2;
          c.acceleration.z += (dz / bestCorpseDist) * scavSpeed;
        }
        if (bestCorpseDist < 3 + c.size + bestCorpse.size) {
          const gained = c.scavenge(bestCorpse);
          energyStats.meat += gained * (0.3 + c.scavenging * 0.7);
          if (bestCorpse.energy <= 0) bestCorpse.dead = true;
        }
      }

      // Parasitism action
      if (bestHost && !bestPrey && !bestCorpse) {  // Only parasite if not doing other things
        const dx = bestHost.position.x - c.position.x;
        const dy = bestHost.position.y - c.position.y;
        const dz = bestHost.position.z - c.position.z;
        if (bestHostDist > 2) {
          const parasiteSpeed = c.maxForce * (0.3 + c.parasitic * 0.5);
          c.acceleration.x += (dx / bestHostDist) * parasiteSpeed;
          c.acceleration.y += (dy / bestHostDist) * parasiteSpeed * 0.2;
          c.acceleration.z += (dz / bestHostDist) * parasiteSpeed;
        }
        if (bestHostDist < 2 + c.size + bestHost.size) {
          const drainRate = 3 + c.parasitic * 10;
          const drained = Math.min(bestHost.energy * 0.1, drainRate * dt * 10);
          const damageReduction = 1 - bestHost.armor * 0.5;
          const actualDrain = drained * damageReduction;
          bestHost.energy -= actualDrain;
          c.energy += actualDrain * 0.7;
          if (actualDrain > 0.5) energyStats.meat += actualDrain * 0.5;
        }
      }
    }
    // === END UNIFIED CREATURE INTERACTIONS ===

    // Separation/flee - only check on staggered frames (not critical to do every frame)
    if (c.shouldDoExpensiveUpdate()) {
      const separationRange = 5 + c.size * 3;
      const nearbyForSeparation = creatureSpatialGrid.getNearby(c.position.x, c.position.z, 1);
      let separationX = 0, separationZ = 0, separationCount = 0;
      let fleeX = 0, fleeZ = 0, fleeCount = 0;

      for (const other of nearbyForSeparation) {
        if (other === c || other.dead) continue;
        const dx = c.position.x - other.position.x;
        const dz = c.position.z - other.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < 0.01) continue;
        const dist = Math.sqrt(distSq);

        // Flee from predators
        if (other.predatory > 0.4 && c.predatory < 0.3 && dist < 15 + c.sight * 20) {
          const fleeStrength = (1 + c.speed * 2 + c.maneuverability) * 2;
          fleeX += (dx / dist) * fleeStrength;
          fleeZ += (dz / dist) * fleeStrength;
          fleeCount++;
        }

        if (dist < separationRange) {
          const strength = (separationRange - dist) / separationRange;
          separationX += (dx / dist) * strength;
          separationZ += (dz / dist) * strength;
          separationCount++;
        }
      }

      // Store for next frames (persist acceleration)
      if (fleeCount > 0) {
        c.acceleration.x += fleeX * 0.08;
        c.acceleration.z += fleeZ * 0.08;
      }
      if (separationCount > 0) {
        c.acceleration.x += separationX * 0.02;
        c.acceleration.z += separationZ * 0.02;
      }
    }

    // Foraging behavior - hungry creatures actively seek plants (staggered)
    if (c.predatory < 0.7 && c.shouldDoExpensiveUpdate()) {
      const waterDepth = isInWater ? Math.abs(terrainHeight) : 0;
      const foodSenseRange = c.getSenseRange(isInWater, waterDepth) * 0.7;
      const gridRange = Math.ceil(foodSenseRange / 50) + 1;
      const nearbyPlants = spatialGrid.getNearby(c.position.x, c.position.z, gridRange);

      // Collect valid plant targets instead of just finding closest
      const validPlants = [];
      
      // Check if creature is in water and lacks amphibious capabilities
      // Use -110 instead of -100 to create a buffer zone at the shoreline
      const creatureInWater = c.position.z < -110;
      const canGoOnLand = c.lungCapacity >= 0.5 && c.limbs >= 0.5;

      for (const plant of nearbyPlants) {
        if (plant.dead) continue;
        
        // Filter out land plants BEFORE distance calculation for water creatures
        // Plants at z > -100 are on land
        const plantOnLand = plant.position.z > -100;
        if (plantOnLand && creatureInWater && !canGoOnLand) {
          continue; // Don't even consider land plants if can't reach them
        }

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

    const tInteractionsEnd = performance.now();
    tInteractionsAccum += tInteractionsEnd - tPhysicsEnd;

    // Update creature logic
    const offspring = c.update(dt, currentBiome);

    const tUpdateEnd = performance.now();
    tUpdateAccum += tUpdateEnd - tInteractionsEnd;

    // Re-enforce terrain collision after update
    // Ensure they stay ON the surface if they are close to it
    const finalTerrainHeight = getTerrainHeight(c.position.x, c.position.z);
    const finalMinHeight = finalTerrainHeight + c.size;
    
    // Snap to surface if slightly below or very close (prevent jitter)
    if (c.position.y < finalMinHeight) {
      c.position.y = finalMinHeight;
      if (c.velocity.y < 0) c.velocity.y = 0;
    }

    if (offspring) {
      if (creatures.length < SIMULATION_CONFIG.maxCreatures) {
        newCreatures.push(offspring);
      } else {
        // At max capacity - just skip this birth (natural population pressure)
        // The old approach of finding weakest was O(n) per birth = O(n²) total
        // Instead, population will naturally stabilize through starvation/predation
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
  const tCreature1 = performance.now();
  perfTotalCreatureLoop += tCreature1 - tCreature0;
  // Store granular breakdown for logging
  perfCreatureUpdate += tUpdateAccum;
  perfCreaturePhysics += tPhysicsAccum;
  perfCreatureInteractions += tInteractionsAccum;

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
  const tPlant0 = performance.now();
  const deadPlantIds = [];
  const newPlants = [];  // Track new plants for this frame
  const plantOffspring = [];  // Seeds from reproducing plants
  const plantHalfWidth = WORLD_SIZE.width / 2 - 15; // Increased from 5 to 15 to match creature bounds
  const plantHalfDepth = WORLD_SIZE.depth / 2 - 15; // Increased from 5 to 15

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
      p.position.y += current.y * dt * 3; // Vertical drift

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

  // 1. Background Plant Spawning (Prevent Extinction)
  // If plant count is low, or just periodically, spawn new plants
  // This simulates algae blooms or seeds drifting in from outside
  // 1. Background Plant Spawning (Robust System)
  // Ensure there's always enough food relative to the creature population
  // Base spawn rate from config
  let spawnCount = SIMULATION_CONFIG.foodSpawnRate * dt;
  
  // Dynamic adjustment: if plant/creature ratio is low, spawn MORE
  if (creatures.length > 0) {
    const ratio = plants.length / creatures.length;
    if (ratio < 2.0) {
      // Crisis mode: not enough food! Boost spawning significantly
      spawnCount *= 5;
    } else if (ratio < 4.0) {
      // Warning mode: getting low
      spawnCount *= 2;
    }
  }
  
  // Accumulate fractional spawns (probabilistic)
  const countToSpawn = Math.floor(spawnCount) + (Math.random() < (spawnCount % 1) ? 1 : 0);
  
  if (plants.length < SIMULATION_CONFIG.maxPlants && countToSpawn > 0) {
    for (let k = 0; k < countToSpawn; k++) {
       const x = (Math.random() - 0.5) * WORLD_SIZE.width;
       
       // Smart Spawning: Target areas with fewer plants? 
       // For now, just bias heavily toward water (80%) since that's where the crisis is
       let z;
       if (Math.random() < 0.8) {
         z = -100 - Math.random() * 400; // Deep water zone
       } else {
         z = -100 + Math.random() * 600; // Land/Beach
       }
       
       const terrainH = getTerrainHeight(x, z);
       const isInWaterZone = z < -100;
       const isOnLand = !isInWaterZone;
       
       let y;
       if (isOnLand) {
         y = terrainH + 0.5;
       } else {
         const waterDepth = Math.abs(terrainH);
         // Spawn at random depths to fill the volume
         y = terrainH + 1 + Math.random() * Math.max(waterDepth * 0.9, 10);
       }
       
       const newPlant = new WorkerPlant({ x, y, z }, nextPlantId++, isOnLand);
       // Give new plants a boost so they are worth eating immediately
       newPlant.energy = 25; 
       plants.push(newPlant);
       newPlants.push(newPlant.toData());
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
      // Water plants float throughout the water column where creatures swim
      const waterDepth = Math.abs(terrainH);
      y = terrainH + 1 + Math.random() * Math.max(waterDepth * 0.6, 10);
    }

    const newPlant = new WorkerPlant({ x: seedX, y, z: seedZ }, nextPlantId++, isOnLand);
    newPlant.energy = 20;  // Seeds start with decent energy
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
    // Filter feeding tracking
    if (c.filterFeeding > 0 && c.position.y < 0) {
       // We need to know how much energy was gained from filter feeding this frame
       // This logic is duplicated from Creature.update, but we can approximate or refactor
       // For now, let's just use the gene value as a proxy for "potential" filter feeding
       // Actually, let's track it properly.
       // The creature update function handles the energy addition. 
       // We can't easily hook into it without changing the return value of update.
       // Let's modify the Creature.update to return stats? Or just estimate here.
       // Estimation is easier for now.
       const speed = Math.sqrt(c.velocity.x**2 + c.velocity.y**2 + c.velocity.z**2);
       const ff = c.dna.weights.filterFeeding;
       if (speed < ff.maxSpeed) {
         const gain = ff.baseGain * dt * (1 + c.filterFeeding * ff.filterFeedingMultiplier);
         energyStats.filter += gain;
       }
    }

    // Predators are obligate carnivores - they cannot digest plants
    if (c.predatory > 0.5) continue; // Predators can't eat plants

    // Stagger plant collision checks - only check every 4 frames per creature
    if (!c.shouldDoExpensiveUpdate()) continue;

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
        // Jaws allow taking bigger bites from plants
        const jawsBonus = 1 + c.jaws * 0.5;
        // Size affects how much can be consumed
        const sizeBonus = 1 + c.size * 0.3;
        const totalEfficiency = herbivoreBonus * jawsBonus * sizeBonus;

        // Without jaws, can only nibble - with jaws, can consume whole plant
        const consumeAmount = c.jaws > 0.2 ? p.energy : Math.min(p.energy, 10 + c.size * 5);
        const energyGained = consumeAmount * totalEfficiency;
        
        c.eat(energyGained);
        p.energy -= consumeAmount;
        
        energyStats.plants += energyGained;

        if (p.energy <= 0) {
          p.dead = true;
          eatenPlantIds.push(p.id);
          const idx = plants.indexOf(p);
          if (idx > -1) plants.splice(idx, 1);
        }
        break;  // One plant per frame per creature
      }
    }
  }
  
  // Track meat consumption (from hunting and scavenging)
  // We need to hook into where these happen.
  // Since we can't easily pass the stats object into the creature methods without changing signature,
  // we'll do it by checking energy changes or just moving the logic out?
  // Actually, the hunting/scavenging logic is IN this function (update), so we can just add to stats there!
  // Wait, the hunting logic is inside the creature loop above (lines 1153+).
  // I need to find that block and add stats tracking there.
  
  // But I can't edit multiple non-contiguous blocks with replace_file_content.
  // I will use multi_replace_file_content for that.
  
  // For this block, I'll just handle the plant eating and return data.

  // Density-based plant spawning - spawn in areas where plants have been eaten
  // Use a coarse grid to find low-density regions
  const DENSITY_CELL_SIZE = 100;  // Check plant density in 100x100 cells
  const waterZCells = 4;  // -100 to -500 = 400 units = 4 cells
  const xCells = Math.ceil(WORLD_SIZE.width / DENSITY_CELL_SIZE);

  // Count plants per cell (water zone only - that's where the problem is)
  const plantDensity = {};
  for (const p of plants) {
    if (p.position.z >= -100) continue;  // Skip land plants
    const cellX = Math.floor((p.position.x + WORLD_SIZE.width / 2) / DENSITY_CELL_SIZE);
    const cellZ = Math.floor((-100 - p.position.z) / DENSITY_CELL_SIZE);  // 0 = near shore, 3 = deep
    const key = `${cellX},${cellZ}`;
    plantDensity[key] = (plantDensity[key] || 0) + 1;
  }

  // Find cells with low plant density (depleted areas)
  const depletedCells = [];
  const targetDensityPerCell = 30;  // Aim for ~30 plants per 100x100 cell

  for (let cx = 0; cx < xCells; cx++) {
    for (let cz = 0; cz < waterZCells; cz++) {
      const key = `${cx},${cz}`;
      const count = plantDensity[key] || 0;
      if (count < targetDensityPerCell) {
        // This cell needs more plants - weight by how depleted it is
        const deficit = targetDensityPerCell - count;
        depletedCells.push({ cx, cz, deficit, count });
      }
    }
  }

  // Spawn plants - prioritize depleted areas
  const populationRatio = plants.length / SIMULATION_CONFIG.maxPlants;
  const plantsToSpawn = populationRatio < 0.5 ? 5 : (populationRatio < 0.8 ? 3 : 2);

  for (let spawnIdx = 0; spawnIdx < plantsToSpawn && plants.length < SIMULATION_CONFIG.maxPlants; spawnIdx++) {
    const spawnChance = SIMULATION_CONFIG.foodSpawnRate * (1 - populationRatio);
    if (Math.random() > spawnChance) continue;

    let x, z;

    // 70% chance to spawn in a depleted area, 30% random
    if (depletedCells.length > 0 && Math.random() < 0.7) {
      // Pick a depleted cell weighted by deficit
      const totalDeficit = depletedCells.reduce((sum, c) => sum + c.deficit, 0);
      let pick = Math.random() * totalDeficit;
      let selectedCell = depletedCells[0];

      for (const cell of depletedCells) {
        pick -= cell.deficit;
        if (pick <= 0) {
          selectedCell = cell;
          break;
        }
      }

      // Spawn within this cell
      x = (selectedCell.cx * DENSITY_CELL_SIZE) - (WORLD_SIZE.width / 2) + Math.random() * DENSITY_CELL_SIZE;
      z = -100 - (selectedCell.cz * DENSITY_CELL_SIZE) - Math.random() * DENSITY_CELL_SIZE;
    } else {
      // Random spawn (80% water, 20% land)
      x = (Math.random() - 0.5) * WORLD_SIZE.width * 0.95;
      if (Math.random() < 0.8) {
        z = -100 - Math.random() * 400;
      } else {
        z = -100 + Math.random() * 600;
      }
    }

    // Clamp to bounds
    x = Math.max(-WORLD_SIZE.width / 2 + 5, Math.min(WORLD_SIZE.width / 2 - 5, x));
    z = Math.max(-WORLD_SIZE.depth / 2 + 5, Math.min(WORLD_SIZE.depth / 2 - 5, z));

    const terrainH = getTerrainHeight(x, z);
    const isInWaterZone = z < -100;
    const isOnLand = !isInWaterZone;

    let y;
    if (isOnLand) {
      y = terrainH + 0.5;
    } else {
      const waterDepth = Math.abs(terrainH);
      y = terrainH + 1 + Math.random() * Math.max(waterDepth * 0.6, 8);
    }

    const plant = new WorkerPlant({ x, y, z }, nextPlantId++, isOnLand);
    plants.push(plant);
    newPlants.push(plant.toData());
  }

  const tPlant1 = performance.now();
  perfTotalPlantLoop += tPlant1 - tPlant0;

  // Measure simulation time (before serialization)
  const tSimEnd = performance.now();
  const simTime = tSimEnd - t0;

  // Serialize all entities
  const tSerializeStart = performance.now();
  const creatureData = creatures.map(c => c.toUpdateData());
  const plantData = plants.map(p => p.toData());
  const corpseData = corpses.map(c => c.toData());
  const tSerializeEnd = performance.now();
  const serializeTime = tSerializeEnd - tSerializeStart;

  // Performance logging every 2 seconds
  perfUpdateCount++;
  perfTotalSimTime += simTime;
  perfTotalSerializeTime += serializeTime;

  if (tSerializeEnd - perfLastLog > 2000) {
    const n = perfUpdateCount;
    console.log(`[Worker Perf] Updates: ${n}, Total sim: ${(perfTotalSimTime / n).toFixed(1)}ms, Serialize: ${(perfTotalSerializeTime / n).toFixed(1)}ms`);
    console.log(`[Worker Perf] Breakdown - Grid: ${(perfTotalGridTime / n).toFixed(1)}ms, Creatures: ${(perfTotalCreatureLoop / n).toFixed(1)}ms, Plants: ${(perfTotalPlantLoop / n).toFixed(1)}ms`);
    console.log(`[Worker Perf] Creature detail - Physics: ${(perfCreaturePhysics / n).toFixed(1)}ms, Interactions: ${(perfCreatureInteractions / n).toFixed(1)}ms, Update: ${(perfCreatureUpdate / n).toFixed(1)}ms`);
    console.log(`[Worker Perf] Counts - Creatures: ${creatures.length}, Plants: ${plants.length}, Corpses: ${corpses.length}`);
    perfLastLog = tSerializeEnd;
    perfUpdateCount = 0;
    perfTotalSimTime = 0;
    perfTotalSerializeTime = 0;
    perfTotalGridTime = 0;
    perfTotalCreatureLoop = 0;
    perfTotalPlantLoop = 0;
    perfCreaturePhysics = 0;
    perfCreatureInteractions = 0;
    perfCreatureUpdate = 0;
  }

  return {
    // Send all entities (no culling - culling happens on main thread)
    creatures: creatureData,
    plants: plantData,
    corpses: corpseData,
    newPlants,
    newCorpses,
    deadCreatureIds,
    deadPlantIds: [...deadPlantIds, ...eatenPlantIds],
    deadCorpseIds,
    // Send FULL data only for new creatures (includes DNA, genes, emergentFeatures)
    newCreatures: newCreatures.map(c => c.toData()),
    stats: {
      creatureCount: creatures.length,
      plantCount: plants.length,
      corpseCount: corpses.length,
      time,
      energySources: energyStats,
      // Pre-calculated stats (no main thread iteration needed)
      maxGeneration,
      matureCount,
      avgAge: creatures.length > 0 ? totalAge / creatures.length : 0,
      population: {
        predators: predatorCount,
        parasites: parasiteCount,
        scavengers: scavengerCount,
        herbivores: herbivoreCount
      },
      avgGenes: creatures.length > 0 ? {
        size: geneAverages.size / creatures.length,
        speed: geneAverages.speed / creatures.length,
        sight: geneAverages.sight / creatures.length,
        smell: geneAverages.smell / creatures.length,
        hearing: geneAverages.hearing / creatures.length,
        armor: geneAverages.armor / creatures.length,
        metabolicEfficiency: geneAverages.metabolicEfficiency / creatures.length,
        toxicity: geneAverages.toxicity / creatures.length,
        coldResistance: geneAverages.coldResistance / creatures.length,
        heatResistance: geneAverages.heatResistance / creatures.length,
        lungCapacity: geneAverages.lungCapacity / creatures.length,
        scavenging: geneAverages.scavenging / creatures.length,
        parasitic: geneAverages.parasitic / creatures.length,
        reproductionUrgency: geneAverages.reproductionUrgency / creatures.length,
        maneuverability: geneAverages.maneuverability / creatures.length,
        predatory: geneAverages.predatory / creatures.length,
        limbs: geneAverages.limbs / creatures.length,
        jaws: geneAverages.jaws / creatures.length,
        filterFeeding: geneAverages.filterFeeding / creatures.length,
        colorHue: geneAverages.colorHue / creatures.length,
        colorSaturation: geneAverages.colorSaturation / creatures.length
      } : null
    }
  };
}

// Write all entity positions to shared buffer (zero-copy transfer)
function writeToSharedBuffer() {
  if (!sharedBuffer) return;

  // Mark buffer as being written
  Atomics.store(sharedBuffer.header, HEADER.FRAME_READY, 0);

  // Write counts
  const creatureCount = Math.min(creatures.length, MAX_CREATURES);
  const plantCount = Math.min(plants.length, MAX_PLANTS);
  const corpseCount = Math.min(corpses.length, MAX_CORPSES);

  sharedBuffer.header[HEADER.CREATURE_COUNT] = creatureCount;
  sharedBuffer.header[HEADER.PLANT_COUNT] = plantCount;
  sharedBuffer.header[HEADER.CORPSE_COUNT] = corpseCount;

  // Write creatures directly to typed array
  for (let i = 0; i < creatureCount; i++) {
    writeCreature(sharedBuffer.creatures, i, creatures[i]);
  }

  // Write plants directly to typed array
  for (let i = 0; i < plantCount; i++) {
    writePlant(sharedBuffer.plants, i, plants[i]);
  }

  // Write corpses directly to typed array
  for (let i = 0; i < corpseCount; i++) {
    writeCorpse(sharedBuffer.corpses, i, corpses[i]);
  }

  // Increment frame number and signal ready
  sharedBuffer.header[HEADER.FRAME_NUMBER]++;
  Atomics.store(sharedBuffer.header, HEADER.FRAME_READY, 1);
  Atomics.notify(sharedBuffer.header, HEADER.FRAME_READY);
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

    case 'setSharedBuffer':
      // Receive SharedArrayBuffer from main thread
      sharedBuffer = attachSharedBuffer(data.buffer);
      useSharedBuffer = true;
      console.log('Worker: SharedArrayBuffer attached');
      self.postMessage({ type: 'sharedBufferReady' });
      break;

    case 'update':
      // Pass camera position for distance-based culling
      // Worker pre-culls entities by distance, dramatically reducing data transfer
      const result = update(
        data.dt,
        data.cameraX || 0,
        data.cameraY || 0,
        data.cameraZ || 0,
        data.cullDistance || 300
      );

      // Send only nearby entities (already culled in update())
      self.postMessage({ type: 'update', data: result });
      break;
  }
};
