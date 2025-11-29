export const WORLD_SIZE = {
  width: 1000,
  height: 200,
  depth: 1000,
};

// Gene definitions - just metadata for UI
export const GENE_DEFINITIONS = {
  size: { name: "Size" },
  speed: { name: "Speed" },
  sight: { name: "Sight" },
  smell: { name: "Smell" },
  hearing: { name: "Hearing" },
  armor: { name: "Armor" },
  metabolicEfficiency: { name: "Metabolism" },
  toxicity: { name: "Toxicity" },
  coldResistance: { name: "Cold Resist" },
  heatResistance: { name: "Heat Resist" },
  lungCapacity: { name: "Lungs" },
  scavenging: { name: "Scavenging" },
  parasitic: { name: "Parasitic" },
  reproductionUrgency: { name: "Reproduction" },
  maneuverability: { name: "Maneuver" },
  predatory: { name: "Predatory" },
  limbs: { name: "Limbs" },
  jaws: { name: "Jaws" },
  filterFeeding: { name: "Filter Feed" },
  colorHue: { name: "Color Hue" },
  colorSaturation: { name: "Color Sat" },
};

// Default weight matrix - defines how genes affect different aspects
// Each creature will carry its own copy that can mutate
export const DEFAULT_GENE_WEIGHTS = {
  // Energy costs per gene (per second, multiplied by gene value)
  // Reduced costs to help creatures survive
  energyCosts: {
    size: 0.04, // Bigger = more expensive to maintain
    speed: 0.015, // Fast muscles cost energy
    sight: 0.025, // Eyes are expensive
    smell: 0.008, // Smell is cheap
    hearing: 0.012, // Moderate cost
    armor: 0.015, // Shell maintenance
    toxicity: 0.02, // Toxin synthesis
    coldResistance: 0.008,
    heatResistance: 0.008,
    lungCapacity: 0.012,
    limbs: 0.015,
    jaws: 0.015,
    predatory: 0.015, // High-stress metabolism
    filterFeeding: 0.003, // Cheap passive system
    parasitic: 0.01, // Specialized feeding structures
    scavenging: 0.005, // Keen sense of decay
    maneuverability: 0.008, // Flexible body maintenance
    reproductionUrgency: 0.003, // Reproductive system readiness
    colorHue: 0.001, // Pigment maintenance (negligible)
    colorSaturation: 0.001, // Pigment intensity
  },

  // Development costs (one-time cost to grow the feature)
  developmentCosts: {
    size: 25,
    speed: 12,
    sight: 15,
    smell: 5,
    hearing: 10,
    armor: 20,
    toxicity: 15,
    coldResistance: 10,
    heatResistance: 10,
    lungCapacity: 18,
    limbs: 20,
    jaws: 22,
    predatory: 5,
    filterFeeding: 3,
    parasitic: 12, // Attachment organs and feeding tube
    scavenging: 4, // Scent detection for decay
    maneuverability: 8, // Flexible body development
    reproductionUrgency: 2, // Reproductive maturation
    colorHue: 0, // Free - just pigment
    colorSaturation: 0, // Free - just pigment
  },

  // Sense effectiveness in different environments
  senseRanges: {
    sight: {
      land: 50,
      shallowWater: 30, // waterDepth < 5
      mediumWater: 15, // waterDepth < 15
      deepWater: 3, // waterDepth >= 15
    },
    smell: {
      base: 25, // Works everywhere equally
    },
    hearing: {
      water: 40,
      land: 10,
    },
  },

  // Combat weights
  combat: {
    attackPower: {
      size: 20,
      jaws: 30,
      predatory: 20,
    },
    defensePower: {
      size: 15,
      armor: 40,
    },
    toxicDamage: 30, // Multiplied by toxicity difference
  },

  // Movement weights
  movement: {
    maxSpeedBase: 0.3,
    maxSpeedFromSpeed: 0.7,
    maxForceBase: 0.05,
    maxForceFromManeuver: 0.15,
    limbsWaterDrag: 0.3, // Limbs create drag in water (reduced penalty)
    limbsLandBonus: 0.5, // Limbs help on land (increased bonus)
    limbsSwimBonus: 0.3, // Limbs can help swimming when adapted
  },

  // Filter feeding (passive food intake)
  filterFeeding: {
    baseGain: 0.3, // Base energy per second in water
    filterFeedingMultiplier: 3, // Bonus from filterFeeding gene
    smellBonus: 0.5, // Better at catching particles with smell
    maxSpeed: 0.4, // Only works when moving slowly
  },

  // Reproduction
  reproduction: {
    energyThresholdBase: 150, // Higher threshold = harder to reproduce
    energyThresholdRange: 50, // Modified by reproductionUrgency
    offspringEnergyRatio: 0.4, // Parent keeps less energy (was 0.5)
    maturityAge: 10, // Seconds before creature can reproduce
  },

  // Lifespan weights
  lifespan: {
    base: 60,
    random: 60,
    sizePenalty: 0.3,
    complexityPenalty: 0.2,
    efficiencyBonus: 0.5,
  },

  // Phenotype weights - how genes and their variativeness affect physical form
  // These create visible differences in creature appearance and physics
  phenotype: {
    // Limb characteristics (affected by limbs gene + variativeness)
    limbs: {
      // High variativeness = longer, thinner limbs (good for running/swimming)
      // Low variativeness = shorter, sturdier limbs (good for stability/climbing)
      lengthBase: 0.5, // Base limb length multiplier
      lengthFromVariativeness: 1.0, // How much variativeness extends limbs
      widthBase: 0.3, // Base limb width
      widthFromVariativeness: -0.2, // High variativeness = thinner limbs
      
      // Limb count affected by limbs gene value
      countMin: 0,
      countMax: 6,
    },
    
    // Body streamlining (affected by maneuverability + speed)
    body: {
      // High variativeness in maneuverability = more streamlined (good for swimming)
      // Low variativeness = more compact/round (good for stability)
      streamliningBase: 1.0, // Length/width ratio
      streamliningFromManeuver: 0.8, // Maneuverability variativeness effect
      streamliningFromSpeed: 0.5, // Speed variativeness effect
      
      // Body flexibility
      flexibilityFromManeuver: 1.0, // Affects turning radius
    },
    
    // Fins/appendages (affected by maneuverability in water)
    fins: {
      // High variativeness = larger fins (better swimming, more drag on land)
      // Low variativeness = smaller fins (less efficient swimming, less drag)
      sizeBase: 0.2,
      sizeFromVariativeness: 0.8,
      countFromManeuver: 4, // Max number of fins
      
      // Fin shape
      aspectRatioBase: 1.5, // Length/width of fins
      aspectRatioFromVariativeness: 1.0, // High = longer, narrower fins
    },
    
    // Wings (affected by limbs + maneuverability for flying)
    wings: {
      // High variativeness in both = larger wing surface
      spanBase: 0.5,
      spanFromLimbVariativeness: 1.5,
      spanFromManeuverVariativeness: 1.0,
      
      // Wing loading (body mass / wing area)
      // Lower is better for flight
      minWingLoading: 0.5,
    },
    
    // Jaw/mouth characteristics
    jaws: {
      // High variativeness = larger, more powerful jaws
      sizeBase: 0.3,
      sizeFromVariativeness: 0.7,
      
      // Bite force multiplier
      forceFromVariativeness: 1.5,
    },
    
    // Armor plating
    armor: {
      // High variativeness = thicker, heavier armor
      // Low variativeness = lighter, more flexible armor
      thicknessBase: 0.2,
      thicknessFromVariativeness: 0.8,
      coverageBase: 0.5, // % of body covered
      coverageFromValue: 0.5, // Gene value affects coverage
      
      // Mass penalty
      massPenaltyFromVariativeness: 0.3,
    },
    
    // Sensory organs (eyes, ears, antennae)
    sensors: {
      // High variativeness = larger, more prominent sensors
      eyeSizeFromSightVariativeness: 1.0,
      earSizeFromHearingVariativeness: 0.8,
      antennaSizeFromSmellVariativeness: 1.2,
    },
  },
};

// Weight mutation config
export const WEIGHT_MUTATION = {
  chance: 0.05, // 5% chance to mutate a weight on reproduction
  amount: 0.15, // Gaussian stddev for weight changes
  minValue: 0, // Weights can't go below 0
  maxValue: 2.0, // Weights can't exceed 2x the default
};

export const BIOMES = {
  DEEP_WATER: {
    name: "Deep Water",
    color: 0x00008b,
    heightMax: -20,
    drag: 0.95,
    friction: 0.1,
    temp: 5,
    hasCurrent: true,
  },
  SHOALS: {
    name: "Shoals",
    color: 0x006994,
    heightMax: -5,
    drag: 0.9,
    friction: 0.2,
    temp: 15,
    hasCurrent: true,
  },
  BEACH: {
    name: "Beach",
    color: 0xf4a460,
    heightMax: 5,
    drag: 0.1,
    friction: 0.6,
    temp: 25,
    hasCurrent: false,
  },
  LAND: {
    name: "Grassland",
    color: 0x228b22,
    heightMax: 40,
    drag: 0.01,
    friction: 0.8,
    temp: 20,
    hasCurrent: false,
  },
  DESERT: {
    name: "Desert",
    color: 0xedc9af,
    heightMax: 60,
    drag: 0.01,
    friction: 0.5,
    temp: 40,
    hasCurrent: false,
  },
  TUNDRA: {
    name: "Tundra",
    color: 0xe8e8e8,
    heightMax: 100,
    drag: 0.01,
    friction: 0.7,
    temp: -10,
    hasCurrent: false,
  },
};

export const SIMULATION_CONFIG = {
  mutationRate: 0.8, // 80% of offspring mutate (was 10%)
  mutationAmount: 4, // Up to 4 genes mutate at once
  initialPopulation: 50, // More starting creatures for diversity
  foodSpawnRate: 50.0, // High plant spawn rate to keep up with creatures
  maxCreatures: 2000, // Higher limit for faster evolution
  maxPlants: 5000, // More plants to support larger population
};
