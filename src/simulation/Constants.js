export const WORLD_SIZE = {
  width: 1000,
  height: 200,
  depth: 1000
};

// Gene definitions - just metadata for UI
export const GENE_DEFINITIONS = {
  size: { name: 'Size' },
  speed: { name: 'Speed' },
  sight: { name: 'Sight' },
  smell: { name: 'Smell' },
  hearing: { name: 'Hearing' },
  camouflage: { name: 'Camouflage' },
  armor: { name: 'Armor' },
  metabolicEfficiency: { name: 'Metabolism' },
  toxicity: { name: 'Toxicity' },
  coldResistance: { name: 'Cold Resist' },
  heatResistance: { name: 'Heat Resist' },
  lungCapacity: { name: 'Lungs' },
  scavenging: { name: 'Scavenging' },
  parasitic: { name: 'Parasitic' },
  reproductionUrgency: { name: 'Reproduction' },
  maneuverability: { name: 'Maneuver' },
  predatory: { name: 'Predatory' },
  limbs: { name: 'Limbs' },
  jaws: { name: 'Jaws' },
  filterFeeding: { name: 'Filter Feed' }
};

// Default weight matrix - defines how genes affect different aspects
// Each creature will carry its own copy that can mutate
export const DEFAULT_GENE_WEIGHTS = {
  // Energy costs per gene (per second, multiplied by gene value)
  // Reduced costs to help creatures survive
  energyCosts: {
    size: 0.03,           // Bigger = more expensive to maintain
    speed: 0.01,          // Fast muscles cost energy
    sight: 0.02,          // Eyes are expensive
    smell: 0.005,         // Smell is cheap
    hearing: 0.01,        // Moderate cost
    camouflage: 0.005,    // Pigment maintenance
    armor: 0.01,          // Shell maintenance
    toxicity: 0.015,      // Toxin synthesis
    coldResistance: 0.005,
    heatResistance: 0.005,
    lungCapacity: 0.01,
    limbs: 0.01,
    jaws: 0.01,
    predatory: 0.01,      // High-stress metabolism
    filterFeeding: 0.002  // Very cheap passive system
  },

  // Development costs (one-time cost to grow the feature)
  developmentCosts: {
    size: 25,
    speed: 12,
    sight: 15,
    smell: 5,
    hearing: 10,
    camouflage: 8,
    armor: 20,
    toxicity: 15,
    coldResistance: 10,
    heatResistance: 10,
    lungCapacity: 18,
    limbs: 20,
    jaws: 22,
    predatory: 5,
    filterFeeding: 3
  },

  // Sense effectiveness in different environments
  senseRanges: {
    sight: {
      land: 50,
      shallowWater: 30,   // waterDepth < 5
      mediumWater: 15,    // waterDepth < 15
      deepWater: 3        // waterDepth >= 15
    },
    smell: {
      base: 25            // Works everywhere equally
    },
    hearing: {
      water: 40,
      land: 10
    }
  },

  // Combat weights
  combat: {
    attackPower: {
      size: 20,
      jaws: 30,
      predatory: 20
    },
    defensePower: {
      size: 15,
      armor: 40
    },
    toxicDamage: 30       // Multiplied by toxicity difference
  },

  // Movement weights
  movement: {
    maxSpeedBase: 0.1,
    maxSpeedFromSpeed: 0.3,
    maxForceBase: 0.01,
    maxForceFromManeuver: 0.02,
    limbsWaterDrag: 0.5,  // Limbs create drag in water
    limbsLandBonus: 0.3   // Limbs help on land
  },

  // Filter feeding (passive food intake)
  filterFeeding: {
    baseGain: 0.5,                // Base energy per second in water (increased from 0.1)
    filterFeedingMultiplier: 4,   // Bonus from filterFeeding gene
    smellBonus: 0.8,              // Better at catching particles with smell
    maxSpeed: 0.5                 // Only works when moving slowly
  },

  // Reproduction
  reproduction: {
    energyThresholdBase: 80,
    energyThresholdRange: 40,     // Modified by reproductionUrgency
    offspringEnergyRatio: 0.5     // Parent keeps this ratio
  },

  // Lifespan weights
  lifespan: {
    base: 60,
    random: 60,
    sizePenalty: 0.3,
    complexityPenalty: 0.2,
    efficiencyBonus: 0.5
  }
};

// Weight mutation config
export const WEIGHT_MUTATION = {
  chance: 0.05,           // 5% chance to mutate a weight on reproduction
  amount: 0.15,           // Gaussian stddev for weight changes
  minValue: 0,            // Weights can't go below 0
  maxValue: 2.0           // Weights can't exceed 2x the default
};

export const BIOMES = {
  DEEP_WATER: {
    name: 'Deep Water',
    color: 0x00008B,
    heightMax: -20,
    drag: 0.95,
    friction: 0.1,
    temp: 5,
    hasCurrent: true
  },
  SHOALS: {
    name: 'Shoals',
    color: 0x006994,
    heightMax: -5,
    drag: 0.9,
    friction: 0.2,
    temp: 15,
    hasCurrent: true
  },
  BEACH: {
    name: 'Beach',
    color: 0xF4A460,
    heightMax: 5,
    drag: 0.1,
    friction: 0.6,
    temp: 25,
    hasCurrent: false
  },
  LAND: {
    name: 'Grassland',
    color: 0x228B22,
    heightMax: 40,
    drag: 0.01,
    friction: 0.8,
    temp: 20,
    hasCurrent: false
  },
  DESERT: {
    name: 'Desert',
    color: 0xEDC9AF,
    heightMax: 60,
    drag: 0.01,
    friction: 0.5,
    temp: 40,
    hasCurrent: false
  },
  TUNDRA: {
    name: 'Tundra',
    color: 0xE8E8E8,
    heightMax: 100,
    drag: 0.01,
    friction: 0.7,
    temp: -10,
    hasCurrent: false
  }
};

export const SIMULATION_CONFIG = {
  mutationRate: 0.8,       // 80% of offspring mutate (was 10%)
  mutationAmount: 4,       // Up to 4 genes mutate at once
  initialPopulation: 100,  // More starting creatures for diversity
  foodSpawnRate: 5.0,      // Very high plant spawn rate to keep up with creatures
  maxCreatures: 2000,
  maxPlants: 8000          // More plants allowed
};
