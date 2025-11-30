// Shared type definitions for evolution simulation compute shaders

// Creature data structure - 32 floats = 128 bytes (aligned)
struct Creature {
  // Position (vec4): x, y, z, radius
  position: vec4<f32>,
  // Velocity (vec4): vx, vy, vz, maxSpeed
  velocity: vec4<f32>,
  // Acceleration (vec4): ax, ay, az, maxForce
  acceleration: vec4<f32>,
  // Energy and lifecycle: energy, age, generation, flags
  energy_age_gen_flags: vec4<f32>,
  // Core genes: size, speed, armor, toxicity
  core_genes: vec4<f32>,
  // Sense genes: sight, smell, hearing, senseRadius
  sense_genes: vec4<f32>,
  // Behavior genes: predatory, parasitic, scavenging, filterFeeding
  behavior_genes: vec4<f32>,
  // Movement genes: maneuverability, limbs, jaws, metabolicEfficiency
  movement_genes: vec4<f32>,
}

// Accessors for creature fields
fn get_position(c: Creature) -> vec3<f32> { return c.position.xyz; }
fn get_radius(c: Creature) -> f32 { return c.position.w; }
fn get_velocity(c: Creature) -> vec3<f32> { return c.velocity.xyz; }
fn get_max_speed(c: Creature) -> f32 { return c.velocity.w; }
fn get_acceleration(c: Creature) -> vec3<f32> { return c.acceleration.xyz; }
fn get_max_force(c: Creature) -> f32 { return c.acceleration.w; }

fn get_energy(c: Creature) -> f32 { return c.energy_age_gen_flags.x; }
fn get_age(c: Creature) -> f32 { return c.energy_age_gen_flags.y; }
fn get_generation(c: Creature) -> f32 { return c.energy_age_gen_flags.z; }
fn get_flags(c: Creature) -> u32 { return bitcast<u32>(c.energy_age_gen_flags.w); }

fn get_size(c: Creature) -> f32 { return c.core_genes.x; }
fn get_speed_gene(c: Creature) -> f32 { return c.core_genes.y; }
fn get_armor(c: Creature) -> f32 { return c.core_genes.z; }
fn get_toxicity(c: Creature) -> f32 { return c.core_genes.w; }

fn get_sight(c: Creature) -> f32 { return c.sense_genes.x; }
fn get_smell(c: Creature) -> f32 { return c.sense_genes.y; }
fn get_hearing(c: Creature) -> f32 { return c.sense_genes.z; }
fn get_sense_radius(c: Creature) -> f32 { return c.sense_genes.w; }

fn get_predatory(c: Creature) -> f32 { return c.behavior_genes.x; }
fn get_parasitic(c: Creature) -> f32 { return c.behavior_genes.y; }
fn get_scavenging(c: Creature) -> f32 { return c.behavior_genes.z; }
fn get_filter_feeding(c: Creature) -> f32 { return c.behavior_genes.w; }

fn get_maneuverability(c: Creature) -> f32 { return c.movement_genes.x; }
fn get_limbs(c: Creature) -> f32 { return c.movement_genes.y; }
fn get_jaws(c: Creature) -> f32 { return c.movement_genes.z; }
fn get_metabolic_efficiency(c: Creature) -> f32 { return c.movement_genes.w; }

// Flag bit masks
const FLAG_DEAD: u32 = 1u;
const FLAG_MATURE: u32 = 2u;
const FLAG_IN_WATER: u32 = 4u;
const FLAG_ON_LAND: u32 = 8u;
const FLAG_NEEDS_REPRODUCTION: u32 = 16u;
const FLAG_UPDATE_OFFSET_MASK: u32 = 224u; // 0x7 << 5

fn is_dead(c: Creature) -> bool { return (get_flags(c) & FLAG_DEAD) != 0u; }
fn is_mature(c: Creature) -> bool { return (get_flags(c) & FLAG_MATURE) != 0u; }
fn get_update_offset(c: Creature) -> u32 { return (get_flags(c) & FLAG_UPDATE_OFFSET_MASK) >> 5u; }

// Helper to set a flag
fn set_flag(flags: u32, flag: u32) -> u32 { return flags | flag; }
fn clear_flag(flags: u32, flag: u32) -> u32 { return flags & (~flag); }

// Simulation uniforms
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

// Spatial grid cell
struct GridCell {
  count: atomic<u32>,
  creatures: array<u32, 64>, // Max 64 creatures per cell
}

// Corpse for scavenging
struct Corpse {
  position: vec4<f32>, // x, y, z, size
  data: vec4<f32>,     // energy, toxicity, age, flags
}

// Plant for herbivores
struct Plant {
  position: vec4<f32>, // x, y, z, energy
  flags: u32,
  padding: vec3<u32>,
}

// Terrain biome IDs
const BIOME_DEEP_WATER: u32 = 0u;
const BIOME_SHOALS: u32 = 1u;
const BIOME_BEACH: u32 = 2u;
const BIOME_LAND: u32 = 3u;
const BIOME_DESERT: u32 = 4u;
const BIOME_TUNDRA: u32 = 5u;

// Get biome from Z position
fn get_biome(z: f32) -> u32 {
  if (z < -300.0) { return BIOME_DEEP_WATER; }
  if (z < -100.0) { return BIOME_SHOALS; }
  if (z < 0.0) { return BIOME_BEACH; }
  if (z < 200.0) { return BIOME_LAND; }
  if (z < 350.0) { return BIOME_DESERT; }
  return BIOME_TUNDRA;
}

// Get biome temperature
fn get_biome_temp(biome: u32) -> f32 {
  switch (biome) {
    case BIOME_DEEP_WATER: { return 5.0; }
    case BIOME_SHOALS: { return 15.0; }
    case BIOME_BEACH: { return 25.0; }
    case BIOME_LAND: { return 20.0; }
    case BIOME_DESERT: { return 40.0; }
    default: { return -10.0; } // TUNDRA
  }
}

// Simple noise function for terrain height
// Based on value noise - fast and deterministic
fn hash2d(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn value_noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f); // smoothstep

  let a = hash2d(i);
  let b = hash2d(i + vec2<f32>(1.0, 0.0));
  let c = hash2d(i + vec2<f32>(0.0, 1.0));
  let d = hash2d(i + vec2<f32>(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

// Get terrain height at position
fn get_terrain_height(x: f32, z: f32) -> f32 {
  let noise = value_noise(vec2<f32>(x * 0.02, z * 0.02)) * 2.0;

  var base_height: f32;

  if (z < -300.0) {
    base_height = -20.0;
  } else if (z < -100.0) {
    let t = (z + 300.0) / 200.0;
    base_height = -20.0 + t * 20.0;
  } else if (z < 0.0) {
    let t = (z + 100.0) / 100.0;
    base_height = t * 5.0;
  } else if (z < 200.0) {
    let t = z / 200.0;
    base_height = 5.0 + t * 5.0;
  } else if (z < 350.0) {
    let t = (z - 200.0) / 150.0;
    base_height = 10.0 + t * 5.0;
  } else {
    let t = min(1.0, (z - 350.0) / 150.0);
    base_height = 15.0 + t * 5.0;
  }

  return base_height + noise;
}

// Simple pseudo-random number generator
fn pcg_hash(input: u32) -> u32 {
  var state = input * 747796405u + 2891336453u;
  var word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn random_float(seed: u32) -> f32 {
  return f32(pcg_hash(seed)) / 4294967295.0;
}

// Random in range [-1, 1]
fn random_signed(seed: u32) -> f32 {
  return random_float(seed) * 2.0 - 1.0;
}
