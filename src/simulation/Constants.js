export const WORLD_SIZE = {
  width: 1000,
  height: 200,
  depth: 1000
};

export const GENE_DEFINITIONS = {
  size: { name: 'Size', bonus: 'Higher energy from meat, defense', con: 'Increases Basal Metabolism' },
  speed: { name: 'Speed', bonus: 'Faster movement', con: 'Increases movement cost' },
  senseRadius: { name: 'Sense Radius', bonus: 'Detect resources further', con: 'High constant energy cost' },
  camouflage: { name: 'Camouflage Index', bonus: 'Lower detection chance', con: 'Metabolic cost to maintain' },
  armor: { name: 'Armor/Shell', bonus: 'Protection', con: 'Reduces speed' },
  metabolicEfficiency: { name: 'Metabolic Efficiency', bonus: 'Lower Basal Metabolism', con: 'Longer digestion time' },
  toxicity: { name: 'Toxicity/Venom', bonus: 'Deter predators', con: 'High synthesis cost' },
  coldResistance: { name: 'Cold Resistance', bonus: 'Survive cold', con: 'Overheating in warm' },
  heatResistance: { name: 'Heat Resistance', bonus: 'Survive heat', con: 'Freezing in cold' },
  lungCapacity: { name: 'Lung Capacity', bonus: 'Survive on land', con: 'Energy/water cost' },
  scavenging: { name: 'Scavenging Efficiency', bonus: 'Eat corpses', con: 'Lower fresh food gain' },
  parasitic: { name: 'Parasitic Instinct', bonus: 'Attach to hosts', con: 'High defense cost' },
  reproductionUrgency: { name: 'Reproduction Urgency', bonus: 'Faster reproduction', con: 'Lower offspring energy' },
  maneuverability: { name: 'Maneuverability', bonus: 'Turning speed', con: 'Lower top speed' },
  predatory: { name: 'Predatory Instinct', bonus: 'Hunt others', con: 'High stress metabolism' },
  limbs: { name: 'Limb Development', bonus: 'Land movement/manipulation', con: 'Water drag/Energy cost' },
  jaws: { name: 'Jaw Strength', bonus: 'Hunting/Processing food', con: 'Weight/Energy cost' }
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
  mutationRate: 0.1,
  mutationAmount: 3, // Number of genes to mutate
  initialPopulation: 50,
  foodSpawnRate: 0.5,
  maxCreatures: 2000,
  maxPlants: 3000
};
