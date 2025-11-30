// Metabolism Compute Shader
// Handles energy costs, aging, filter feeding, death, and reproduction readiness

struct Creature {
  position: vec4<f32>,
  velocity: vec4<f32>,
  acceleration: vec4<f32>,
  energy_age_gen_flags: vec4<f32>,
  core_genes: vec4<f32>,
  sense_genes: vec4<f32>,
  behavior_genes: vec4<f32>,
  movement_genes: vec4<f32>,
}

struct SimUniforms {
  dt: f32,
  time: f32,
  frame_count: u32,
  creature_count: u32,
  world_width: f32,
  world_depth: f32,
  cell_size: f32,
  padding: f32,
}

// Flag constants
const FLAG_DEAD: u32 = 1u;
const FLAG_MATURE: u32 = 2u;
const FLAG_IN_WATER: u32 = 4u;
const FLAG_ON_LAND: u32 = 8u;
const FLAG_NEEDS_REPRODUCTION: u32 = 16u;

// Biome constants
const BIOME_DEEP_WATER: u32 = 0u;
const BIOME_SHOALS: u32 = 1u;
const BIOME_BEACH: u32 = 2u;
const BIOME_LAND: u32 = 3u;
const BIOME_DESERT: u32 = 4u;
const BIOME_TUNDRA: u32 = 5u;

// Energy cost constants (matching CPU simulation)
const ENERGY_COST_SIZE: f32 = 0.04;
const ENERGY_COST_SPEED: f32 = 0.015;
const ENERGY_COST_SIGHT: f32 = 0.025;
const ENERGY_COST_SMELL: f32 = 0.008;
const ENERGY_COST_HEARING: f32 = 0.012;
const ENERGY_COST_ARMOR: f32 = 0.015;
const ENERGY_COST_TOXICITY: f32 = 0.02;
const ENERGY_COST_LIMBS: f32 = 0.015;
const ENERGY_COST_JAWS: f32 = 0.015;
const ENERGY_COST_PREDATORY: f32 = 0.015;
const ENERGY_COST_FILTER: f32 = 0.003;

// Filter feeding constants
const FILTER_BASE_GAIN: f32 = 0.3;
const FILTER_MULTIPLIER: f32 = 3.0;
const FILTER_SMELL_BONUS: f32 = 0.5;
const FILTER_MAX_SPEED: f32 = 0.4;

// Reproduction constants
const REPRO_ENERGY_BASE: f32 = 150.0;
const REPRO_ENERGY_RANGE: f32 = 50.0;
const MATURITY_AGE: f32 = 10.0;

// Lifespan constants
const LIFESPAN_BASE: f32 = 60.0;
const LIFESPAN_SIZE_PENALTY: f32 = 0.3;
const LIFESPAN_COMPLEXITY_PENALTY: f32 = 0.2;
const LIFESPAN_EFFICIENCY_BONUS: f32 = 0.5;

@group(0) @binding(0) var<uniform> uniforms: SimUniforms;
@group(0) @binding(1) var<storage, read> creatures_in: array<Creature>;
@group(0) @binding(2) var<storage, read_write> creatures_out: array<Creature>;

fn get_biome(z: f32) -> u32 {
  if (z < -300.0) { return BIOME_DEEP_WATER; }
  if (z < -100.0) { return BIOME_SHOALS; }
  if (z < 0.0) { return BIOME_BEACH; }
  if (z < 200.0) { return BIOME_LAND; }
  if (z < 350.0) { return BIOME_DESERT; }
  return BIOME_TUNDRA;
}

fn get_biome_temp(biome: u32) -> f32 {
  switch (biome) {
    case BIOME_DEEP_WATER: { return 5.0; }
    case BIOME_SHOALS: { return 15.0; }
    case BIOME_BEACH: { return 25.0; }
    case BIOME_LAND: { return 20.0; }
    case BIOME_DESERT: { return 40.0; }
    default: { return -10.0; }
  }
}

// Calculate max age for a creature
fn calculate_max_age(c: Creature) -> f32 {
  let size = c.core_genes.x;
  let armor = c.core_genes.z;
  let toxicity = c.core_genes.w;
  let limbs = c.movement_genes.y;
  let jaws = c.movement_genes.z;
  let metabolic_efficiency = c.movement_genes.w;

  // Cold/heat resistance would need to be stored separately
  // For now, estimate complexity
  let complexity = (armor + toxicity + limbs + jaws) / 4.0;

  var max_age = LIFESPAN_BASE + 30.0; // Some randomness already baked in
  max_age *= (1.0 - size * LIFESPAN_SIZE_PENALTY);
  max_age *= (1.0 - complexity * LIFESPAN_COMPLEXITY_PENALTY);
  max_age *= (1.0 + metabolic_efficiency * LIFESPAN_EFFICIENCY_BONUS);

  return max(30.0, max_age);
}

@compute @workgroup_size(256)
fn update_metabolism(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  if (idx >= uniforms.creature_count) {
    return;
  }

  var c = creatures_in[idx];
  var flags = bitcast<u32>(c.energy_age_gen_flags.w);

  // Skip already dead creatures
  if ((flags & FLAG_DEAD) != 0u) {
    creatures_out[idx] = c;
    return;
  }

  let dt = uniforms.dt;
  let pos = c.position.xyz;
  let vel = c.velocity.xyz;
  let speed = length(vel);

  // Gene values
  let size = c.core_genes.x;
  let speed_gene = c.core_genes.y;
  let armor = c.core_genes.z;
  let toxicity = c.core_genes.w;
  let sight = c.sense_genes.x;
  let smell = c.sense_genes.y;
  let hearing = c.sense_genes.z;
  let predatory = c.behavior_genes.x;
  let filter_feeding = c.behavior_genes.w;
  let limbs = c.movement_genes.y;
  let jaws = c.movement_genes.z;
  let metabolic_efficiency = c.movement_genes.w;

  var energy = c.energy_age_gen_flags.x;
  var age = c.energy_age_gen_flags.y;
  let generation = c.energy_age_gen_flags.z;

  let is_in_water = (flags & FLAG_IN_WATER) != 0u;
  let is_mature = (flags & FLAG_MATURE) != 0u;

  // Age the creature
  age += dt;

  // Check for old age death
  let max_age = calculate_max_age(c);
  if (age >= max_age) {
    flags = flags | FLAG_DEAD;
    c.energy_age_gen_flags = vec4<f32>(0.0, age, generation, bitcast<f32>(flags));
    creatures_out[idx] = c;
    return;
  }

  // Maturity check
  let development_progress = min(1.0, age / MATURITY_AGE);
  if (development_progress >= 1.0 && !is_mature) {
    flags = flags | FLAG_MATURE;
  }

  // Development costs (before maturity)
  if (!is_mature) {
    var total_dev_cost = size * 25.0 + speed_gene * 12.0 + sight * 15.0 +
                         smell * 5.0 + hearing * 10.0 + armor * 20.0 +
                         toxicity * 15.0 + limbs * 20.0 + jaws * 22.0;
    let dev_cost_per_second = total_dev_cost / MATURITY_AGE;
    energy -= dev_cost_per_second * dt;
  }

  // Basal metabolism
  var basal_cost = 0.05 * (1.0 + size * 1.5);
  basal_cost *= (1.0 - metabolic_efficiency * 0.5);

  // Feature maintenance costs
  var maintenance_cost = size * ENERGY_COST_SIZE +
                         speed_gene * ENERGY_COST_SPEED +
                         sight * ENERGY_COST_SIGHT +
                         smell * ENERGY_COST_SMELL +
                         hearing * ENERGY_COST_HEARING +
                         armor * ENERGY_COST_ARMOR +
                         toxicity * ENERGY_COST_TOXICITY +
                         limbs * ENERGY_COST_LIMBS +
                         jaws * ENERGY_COST_JAWS +
                         predatory * ENERGY_COST_PREDATORY +
                         filter_feeding * ENERGY_COST_FILTER;

  // Armor penalty
  if (armor > 0.3) {
    let armor_penalty = armor * 0.15;
    maintenance_cost *= (1.0 + armor_penalty);
  }

  // Temperature cost
  let biome = get_biome(pos.z);
  let temp = get_biome_temp(biome);
  var temp_cost = 0.0;
  // Note: cold/heat resistance genes would need to be added to buffer
  // For now, use simplified temperature handling
  if (temp < 10.0) {
    temp_cost = (10.0 - temp) * 0.02;
  } else if (temp > 30.0) {
    temp_cost = (temp - 30.0) * 0.02;
  }

  // Movement cost
  var move_cost = speed * speed * 0.08;
  move_cost *= (1.0 + speed_gene * 1.5);

  if (is_in_water) {
    move_cost *= (1.0 + limbs * 0.3); // Limbs create drag
  } else {
    move_cost *= (1.0 - limbs * 0.5); // Limbs help on land
  }

  // Land survival - no lungs means suffocation
  // Note: lung capacity would need to be in buffer for accurate simulation
  if (!is_in_water) {
    // Simplified: creatures without limbs take damage on land
    if (limbs < 0.3) {
      energy -= 0.5 * dt; // Suffocation
    }
  }

  let total_cost = (basal_cost + move_cost + temp_cost + maintenance_cost) * dt;
  energy -= total_cost;

  // Filter feeding
  if (is_in_water && speed < FILTER_MAX_SPEED) {
    let filter_gain = FILTER_BASE_GAIN * dt *
                      (1.0 + filter_feeding * FILTER_MULTIPLIER) *
                      (1.0 + smell * FILTER_SMELL_BONUS) *
                      (1.0 - predatory * 0.5);
    energy += filter_gain;
  }

  // Check for starvation
  if (energy <= 0.0) {
    flags = flags | FLAG_DEAD;
    energy = 0.0;
  }

  // Reproduction readiness check
  flags = flags & ~FLAG_NEEDS_REPRODUCTION;
  if ((flags & FLAG_MATURE) != 0u && energy > REPRO_ENERGY_BASE) {
    // Note: reproductionUrgency gene would affect threshold
    let threshold = REPRO_ENERGY_BASE + REPRO_ENERGY_RANGE * 0.5;
    // Predator bonus
    let effective_threshold = select(threshold, threshold * 0.6, predatory > 0.5);

    if (energy > effective_threshold) {
      flags = flags | FLAG_NEEDS_REPRODUCTION;
    }
  }

  // Write back
  c.energy_age_gen_flags = vec4<f32>(energy, age, generation, bitcast<f32>(flags));

  creatures_out[idx] = c;
}
