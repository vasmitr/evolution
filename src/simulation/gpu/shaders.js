/**
 * WGSL Shader Sources
 * Embedded directly for worker compatibility
 */

export const SPATIAL_GRID_SHADER = /* wgsl */`
// Spatial Grid Compute Shaders
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

const MAX_CREATURES_PER_CELL: u32 = 64u;
const GRID_SIZE: u32 = 20u;

// Simplified grid - just counts and creature indices
// count is at index 0, creatures at indices 1-64
const CELL_STRIDE: u32 = 65u; // 1 count + 64 creatures

@group(0) @binding(0) var<uniform> uniforms: SimUniforms;
@group(0) @binding(1) var<storage, read> creatures: array<Creature>;
@group(0) @binding(2) var<storage, read_write> grid: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> cell_counts: array<atomic<u32>>;

fn get_cell_index(pos: vec3<f32>) -> u32 {
  let half_width = uniforms.world_width * 0.5;
  let half_depth = uniforms.world_depth * 0.5;
  let x = clamp(pos.x, -half_width, half_width - 1.0);
  let z = clamp(pos.z, -half_depth, half_depth - 1.0);
  let cell_x = u32((x + half_width) / uniforms.cell_size);
  let cell_z = u32((z + half_depth) / uniforms.cell_size);
  let cx = min(cell_x, GRID_SIZE - 1u);
  let cz = min(cell_z, GRID_SIZE - 1u);
  return cz * GRID_SIZE + cx;
}

@compute @workgroup_size(256)
fn clear_grid(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let cell_idx = global_id.x;
  if (cell_idx >= GRID_SIZE * GRID_SIZE) { return; }
  // Clear count for this cell
  atomicStore(&grid[cell_idx * CELL_STRIDE], 0u);
  atomicStore(&cell_counts[cell_idx], 0u);
}

@compute @workgroup_size(256)
fn populate_grid(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let creature_idx = global_id.x;
  if (creature_idx >= uniforms.creature_count) { return; }
  let c = creatures[creature_idx];
  let flags = bitcast<u32>(c.energy_age_gen_flags.w);
  if ((flags & 1u) != 0u) { return; }
  let cell_idx = get_cell_index(c.position.xyz);
  let cell_base = cell_idx * CELL_STRIDE;
  let slot = atomicAdd(&grid[cell_base], 1u);
  if (slot < MAX_CREATURES_PER_CELL) {
    atomicStore(&grid[cell_base + 1u + slot], creature_idx);
  }
  atomicAdd(&cell_counts[cell_idx], 1u);
}
`;

export const PHYSICS_SHADER = /* wgsl */`
// Physics Compute Shader
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

const FLAG_DEAD: u32 = 1u;
const FLAG_IN_WATER: u32 = 4u;
const FLAG_ON_LAND: u32 = 8u;

@group(0) @binding(0) var<uniform> uniforms: SimUniforms;
@group(0) @binding(1) var<storage, read> creatures_in: array<Creature>;
@group(0) @binding(2) var<storage, read_write> creatures_out: array<Creature>;

fn hash2d(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn value_noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash2d(i);
  let b = hash2d(i + vec2<f32>(1.0, 0.0));
  let c = hash2d(i + vec2<f32>(0.0, 1.0));
  let d = hash2d(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

fn pcg_hash(input: u32) -> u32 {
  var state = input * 747796405u + 2891336453u;
  var word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn get_terrain_height(x: f32, z: f32) -> f32 {
  let noise = value_noise(vec2<f32>(x * 0.02, z * 0.02)) * 2.0;
  var base_height: f32;
  if (z < -300.0) { base_height = -20.0; }
  else if (z < -100.0) { let t = (z + 300.0) / 200.0; base_height = -20.0 + t * 20.0; }
  else if (z < 0.0) { let t = (z + 100.0) / 100.0; base_height = t * 5.0; }
  else if (z < 200.0) { let t = z / 200.0; base_height = 5.0 + t * 5.0; }
  else if (z < 350.0) { let t = (z - 200.0) / 150.0; base_height = 10.0 + t * 5.0; }
  else { let t = min(1.0, (z - 350.0) / 150.0); base_height = 15.0 + t * 5.0; }
  return base_height + noise;
}

// 3D current/wind field - works for water currents and air currents
fn get_current(pos: vec3<f32>, time: f32, terrain_height: f32) -> vec3<f32> {
  // Large-scale horizontal flow
  let scale1 = 0.002;
  let n1 = value_noise(vec2<f32>(pos.x * scale1, pos.z * scale1 + time * 0.05));
  let angle1 = n1 * 3.14159 * 4.0;

  // Medium-scale turbulence
  let scale2 = 0.008;
  let n2 = value_noise(vec2<f32>(pos.x * scale2 - time * 0.1, pos.z * scale2));
  let angle2 = n2 * 3.14159 * 2.0;

  var current_x = cos(angle1) * 1.5 + cos(angle2) * 0.5;
  var current_z = sin(angle1) * 1.5 + sin(angle2) * 0.5;

  // Strong vertical currents - upwelling and downwelling columns
  let scale_v1 = 0.004;  // Larger features
  let v1 = value_noise(vec2<f32>(pos.x * scale_v1 + 50.0, pos.z * scale_v1 + time * 0.02));
  let scale_v2 = 0.012;
  let v2 = value_noise(vec2<f32>(pos.x * scale_v2 + pos.y * 0.05, pos.z * scale_v2 - time * 0.04));

  // Much stronger vertical component for real mixing
  var current_y = (v1 - 0.5) * 5.0 + v2 * 2.0;

  // Depth-based modulation - but keep some vertical flow everywhere
  let water_depth = abs(terrain_height);
  let depth_from_surface = abs(pos.y);
  let relative_depth = depth_from_surface / max(water_depth, 1.0);

  // Vertical mixing throughout water column, slightly stronger in middle
  let vertical_strength = 0.5 + sin(relative_depth * 3.14159) * 0.5;
  current_y *= vertical_strength;

  // Near-shore effects
  if (terrain_height > -20.0) {
    let depth_factor = max(0.0, (-terrain_height) / 20.0);
    current_x *= depth_factor;
    current_z *= depth_factor;
    // Wave action near surface
    let wave = sin(time * 1.0 + pos.x * 0.05);
    current_x += wave * 0.5 * (1.0 - depth_factor);
    // Still allow some vertical current in shallows
    current_y *= max(0.3, depth_factor);
  }

  // Large thermal convection cells - strong vertical columns
  let convection_scale = 0.002;
  let convection = value_noise(vec2<f32>(pos.x * convection_scale, pos.z * convection_scale + time * 0.008));
  // Strong upwelling/downwelling zones
  current_y += (convection - 0.5) * 4.0;

  return vec3<f32>(current_x, current_y, current_z);
}

@compute @workgroup_size(256)
fn update_physics(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  if (idx >= uniforms.creature_count) { return; }
  var c = creatures_in[idx];
  var flags = bitcast<u32>(c.energy_age_gen_flags.w);
  if ((flags & FLAG_DEAD) != 0u) { creatures_out[idx] = c; return; }

  let dt = uniforms.dt;
  let size = c.core_genes.x;
  let speed_gene = c.core_genes.y;
  let limbs = c.movement_genes.y;
  var pos = c.position.xyz;
  var vel = c.velocity.xyz;
  var acc = c.acceleration.xyz;
  let max_speed = c.velocity.w;

  vel += acc * dt;
  let speed = length(vel);
  if (speed > max_speed) { vel = normalize(vel) * max_speed; }
  pos += vel * dt;

  let terrain_height = get_terrain_height(pos.x, pos.z);
  let min_height = terrain_height + size;
  let half_width = uniforms.world_width * 0.5 - 10.0;
  let half_depth = uniforms.world_depth * 0.5 - 10.0;

  if (pos.x > half_width) { pos.x = half_width; vel.x = -abs(vel.x) * 0.5; }
  else if (pos.x < -half_width) { pos.x = -half_width; vel.x = abs(vel.x) * 0.5; }
  if (pos.z > half_depth) { pos.z = half_depth; vel.z = -abs(vel.z) * 0.5; }
  else if (pos.z < -half_depth) { pos.z = -half_depth; vel.z = abs(vel.z) * 0.5; }
  if (pos.y > 100.0) { pos.y = 100.0; vel.y = -abs(vel.y) * 0.5; }
  if (pos.y < min_height) { pos.y = min_height; if (vel.y < 0.0) { vel.y = 0.0; } }

  let is_water_zone = pos.z < -100.0;
  let is_in_water = is_water_zone && pos.y < 0.0;

  flags = flags & ~(FLAG_IN_WATER | FLAG_ON_LAND);
  if (is_in_water) { flags = flags | FLAG_IN_WATER; } else { flags = flags | FLAG_ON_LAND; }

  if (is_in_water) {
    let water_depth = abs(terrain_height);

    // HARD boundary - keep creature well above seafloor for visibility
    // Larger offset ensures creatures are clearly visible above the terrain texture
    let min_water_y = terrain_height + size + 5.0;  // +5 units above terrain (increased from 3)
    if (pos.y < min_water_y) {
      pos.y = min_water_y;  // Hard clamp to prevent sinking into terrain
      vel.y = max(vel.y, 2.0);  // Strong upward bounce (increased from 1.0)
    }

    // Neutral buoyancy zone - MUCH stronger push away from seafloor
    // This creates a "soft floor" that creatures naturally float above
    let depth_from_floor = pos.y - terrain_height;
    let target_height = 10.0 + size * 2.0;  // Target floating height above floor
    if (depth_from_floor < target_height) {
      // Strong exponential push when close to floor
      let push_strength = (target_height - depth_from_floor) / target_height;
      vel.y += push_strength * push_strength * 0.15;  // Quadratic falloff, much stronger (0.15 vs 0.02)
    }

    // Soft ceiling at water surface
    if (pos.y > -size) {
      vel.y -= (pos.y + size) * 0.05;
    }

    // Gentle drag in water (less restrictive)
    vel *= 0.97;

    // Water currents - with stronger vertical mixing
    let current = get_current(pos, uniforms.time, terrain_height);
    let current_resistance = speed_gene * 0.5;
    let current_influence = 1.0 - current_resistance;
    pos += current * dt * 2.0 * current_influence;

    // Occasional random movement impulse - only every ~30 frames per creature to prevent shaking
    let impulse_seed = idx * 73u + (uniforms.frame_count / 30u);
    if (pcg_hash(impulse_seed) % 30u == (uniforms.frame_count % 30u)) {
      let speed_now = length(vel);
      if (speed_now < 0.5) {
        let seed = impulse_seed * 17u;
        let rand_x = (f32(pcg_hash(seed)) / 4294967295.0 - 0.5) * 2.0;
        let rand_y = (f32(pcg_hash(seed + 1u)) / 4294967295.0 - 0.2) * 1.5;  // Slight upward bias (0.3 center)
        let rand_z = (f32(pcg_hash(seed + 2u)) / 4294967295.0 - 0.5) * 2.0;
        vel.x += rand_x * 0.6;
        vel.y += rand_y * 0.8;  // Stronger vertical impulse
        vel.z += rand_z * 0.6;
      }
    }
  } else {
    vel.y -= 0.1;
    vel.x *= 0.95;
    vel.z *= 0.95;
    if (pos.y <= min_height + 0.1) {
      vel.x *= 0.9;
      vel.z *= 0.9;
      let sample_dist = 10.0;
      let hX1 = get_terrain_height(pos.x + sample_dist, pos.z);
      let hX2 = get_terrain_height(pos.x - sample_dist, pos.z);
      let hZ1 = get_terrain_height(pos.x, pos.z + sample_dist);
      let hZ2 = get_terrain_height(pos.x, pos.z - sample_dist);
      let slide_force = 0.02 * (1.0 - limbs * 0.5);
      vel.x += (hX2 - hX1) * slide_force;
      vel.z += (hZ2 - hZ1) * slide_force;
    }
  }

  c.position = vec4<f32>(pos, c.position.w);
  c.velocity = vec4<f32>(vel, max_speed);
  c.acceleration = vec4<f32>(0.0, 0.0, 0.0, c.acceleration.w);
  c.energy_age_gen_flags.w = bitcast<f32>(flags);
  creatures_out[idx] = c;
}
`;

export const BEHAVIOR_SHADER = /* wgsl */`
// Behavior Compute Shader
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

struct Corpse {
  position: vec4<f32>,
  data: vec4<f32>,
}

struct Plant {
  position: vec4<f32>,  // x, y, z, padding
  data: vec4<f32>,      // energy, size, flags, padding
}

struct PlantCount {
  count: u32,
  padding1: u32,
  padding2: u32,
  padding3: u32,
}

const FLAG_DEAD: u32 = 1u;
const FLAG_IN_WATER: u32 = 4u;
const FLAG_UPDATE_OFFSET_MASK: u32 = 224u;
const MAX_CREATURES_PER_CELL: u32 = 64u;
const GRID_SIZE: u32 = 20u;
const CELL_STRIDE: u32 = 65u;
const PLANT_FLAG_DEAD: u32 = 1u;

@group(0) @binding(0) var<uniform> uniforms: SimUniforms;
@group(0) @binding(1) var<storage, read> creatures_in: array<Creature>;
@group(0) @binding(2) var<storage, read_write> creatures_out: array<Creature>;
@group(0) @binding(3) var<storage, read> grid: array<u32>;
@group(0) @binding(4) var<storage, read> corpses: array<Corpse>;
@group(0) @binding(5) var<uniform> corpse_count: u32;
@group(0) @binding(6) var<storage, read> plants: array<Plant>;
@group(0) @binding(7) var<uniform> plant_count: PlantCount;

fn pcg_hash(input: u32) -> u32 {
  var state = input * 747796405u + 2891336453u;
  var word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn random_float(seed: u32) -> f32 { return f32(pcg_hash(seed)) / 4294967295.0; }
fn random_signed(seed: u32) -> f32 { return random_float(seed) * 2.0 - 1.0; }

fn get_cell_index(pos: vec3<f32>) -> u32 {
  let half_width = uniforms.world_width * 0.5;
  let half_depth = uniforms.world_depth * 0.5;
  let x = clamp(pos.x, -half_width, half_width - 1.0);
  let z = clamp(pos.z, -half_depth, half_depth - 1.0);
  let cell_x = u32((x + half_width) / uniforms.cell_size);
  let cell_z = u32((z + half_depth) / uniforms.cell_size);
  return min(cell_z, GRID_SIZE - 1u) * GRID_SIZE + min(cell_x, GRID_SIZE - 1u);
}

fn score_prey(hunter: Creature, prey: Creature, dist: f32) -> f32 {
  let size_diff = hunter.core_genes.x - prey.core_genes.x;
  return size_diff * 20.0 - prey.core_genes.z * 30.0 - prey.core_genes.w * 50.0 - dist * 0.5;
}

fn score_plant(creature: Creature, plant_energy: f32, plant_size: f32, dist: f32) -> f32 {
  // Prefer closer plants with more energy
  let energy_score = plant_energy * 0.5;
  let distance_penalty = dist * 0.8;
  // Filter feeders are better at finding plants
  let filter_bonus = creature.behavior_genes.w * 20.0;
  return energy_score - distance_penalty + filter_bonus;
}

@compute @workgroup_size(256)
fn update_behavior(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  if (idx >= uniforms.creature_count) { return; }
  var c = creatures_in[idx];
  var flags = bitcast<u32>(c.energy_age_gen_flags.w);
  if ((flags & FLAG_DEAD) != 0u) { creatures_out[idx] = c; return; }

  let update_offset = (flags & FLAG_UPDATE_OFFSET_MASK) >> 5u;
  if ((uniforms.frame_count % 8u) != update_offset) { creatures_out[idx] = c; return; }

  let pos = c.position.xyz;
  let is_in_water = (flags & FLAG_IN_WATER) != 0u;
  let predatory = c.behavior_genes.x;
  let filter_feeding = c.behavior_genes.w;
  let sense_radius = c.sense_genes.w; // Removed cap for 3D sensing
  let max_force = c.acceleration.w;
  let speed_gene = c.core_genes.y;
  let maneuverability = c.movement_genes.x;
  let limbs = c.movement_genes.y;
  let jaws = c.movement_genes.z;
  let smell = c.sense_genes.y;

  let center_cell_x = i32((pos.x + uniforms.world_width * 0.5) / uniforms.cell_size);
  let center_cell_z = i32((pos.z + uniforms.world_depth * 0.5) / uniforms.cell_size);
  let search_range = i32(ceil(sense_radius / uniforms.cell_size));

  var best_prey_score = -999999.0;
  var best_prey_dir = vec3<f32>(0.0);
  var best_plant_score = -999999.0;
  var best_plant_dir = vec3<f32>(0.0);
  var acc = vec3<f32>(0.0);

  // Hunting behavior for predators
  if (predatory > 0.3 && jaws > 0.2) {
    for (var dz = -search_range; dz <= search_range; dz++) {
      for (var dx = -search_range; dx <= search_range; dx++) {
        let cell_x = center_cell_x + dx;
        let cell_z = center_cell_z + dz;
        if (cell_x < 0 || cell_x >= i32(GRID_SIZE) || cell_z < 0 || cell_z >= i32(GRID_SIZE)) { continue; }
        let cell_idx = u32(cell_z) * GRID_SIZE + u32(cell_x);
        let cell_base = cell_idx * CELL_STRIDE;
        let cell_count = grid[cell_base];
        for (var i = 0u; i < min(cell_count, MAX_CREATURES_PER_CELL); i++) {
          let prey_idx = grid[cell_base + 1u + i];
          if (prey_idx == idx) { continue; }
          let prey = creatures_in[prey_idx];
          let prey_flags = bitcast<u32>(prey.energy_age_gen_flags.w);
          if ((prey_flags & FLAG_DEAD) != 0u) { continue; }
          let dist = distance(pos, prey.position.xyz);
          if (dist > sense_radius) { continue; }
          let score = score_prey(c, prey, dist);
          if (score > best_prey_score) {
            best_prey_score = score;
            best_prey_dir = normalize(prey.position.xyz - pos);
          }
        }
      }
    }
  }

  // Plant-seeking behavior for herbivores/filter feeders
  let is_herbivore = predatory < 0.5 || filter_feeding > 0.2;
  if (is_herbivore) {
    // Much larger search radius for 3D environment - plants are spread vertically
    let base_plant_radius = 80.0 + sense_radius * 0.5;
    let plant_sense_radius = base_plant_radius * (1.0 + smell * 0.5 + filter_feeding * 0.3);
    let num_plants = plant_count.count;
    // Sample more plants with random offset for better coverage
    let max_plants_to_check = min(num_plants, 1000u);
    let seed_base = idx * 17u + uniforms.frame_count;
    // Random start offset to sample different plants each frame
    let start_offset = pcg_hash(seed_base) % max(num_plants, 1u);

    for (var i = 0u; i < max_plants_to_check; i++) {
      let plant_idx = (start_offset + i) % num_plants;
      let plant = plants[plant_idx];
      let plant_flags = bitcast<u32>(plant.data.z);
      if ((plant_flags & PLANT_FLAG_DEAD) != 0u) { continue; }
      let plant_pos = plant.position.xyz;
      let dist = distance(pos, plant_pos);
      if (dist > plant_sense_radius) { continue; }
      let plant_energy = plant.data.x;
      let plant_size = plant.data.y;
      if (plant_energy < 1.0) { continue; }
      let score = score_plant(c, plant_energy, plant_size, dist);
      if (score > best_plant_score) {
        best_plant_score = score;
        best_plant_dir = normalize(plant_pos - pos);
      }
    }
  }

  let hunt_force = max_force * (0.5 + predatory * 0.5);
  let forage_force = max_force * (0.6 + filter_feeding * 0.4);

  // Decide between hunting prey vs seeking plants
  var found_target = false;
  if (best_prey_score > -100.0 && best_prey_score > best_plant_score * 0.5) {
    // Prey is more attractive
    acc += best_prey_dir * hunt_force;
    found_target = true;
  } else if (best_plant_score > -100.0) {
    // Plant is more attractive
    acc += best_plant_dir * forage_force;
    found_target = true;
  }

  // Random movement / depth exploration if no target found
  if (!found_target) {
    let seed = idx * 31u + uniforms.frame_count * 7u;
    let energy = c.energy_age_gen_flags.x;
    // More desperate vertical search when hungry
    let hunger_factor = max(0.0, 1.0 - energy / 100.0);

    // Always allow some movement - even primitive creatures can drift/wiggle
    // Base swim force allows movement even with zero genes
    let base_swim = max_force * 0.4;
    let swim_force = base_swim + max_force * (speed_gene * 1.5 + maneuverability * 0.5);
    if (is_in_water) {
      // Vertical migration behavior - change depth to find food
      let vertical_explore_chance = 0.08 + hunger_factor * 0.15;
      if (random_float(seed) < vertical_explore_chance) {
        // Strongly biased vertical movement to explore different depths
        let angle_xz = random_float(seed + 1u) * 6.28318;
        // Bias toward vertical when hungry - alternate up/down based on position
        let depth_bias = select(1.0, -1.0, pos.y > -10.0); // Go down if near surface, up if deep
        let vertical_bias = hunger_factor * depth_bias * 0.5;
        let angle_y = (random_float(seed + 2u) - 0.5 + vertical_bias) * 3.14159;
        acc.x += cos(angle_xz) * cos(angle_y) * swim_force * 0.5;
        acc.z += sin(angle_xz) * cos(angle_y) * swim_force * 0.5;
        // Strong vertical component for depth exploration
        acc.y += sin(angle_y) * swim_force * (1.0 + hunger_factor);
      } else if (random_float(seed + 3u) < 0.15) {
        // More frequent random movement - continue or wander
        let vel = c.velocity.xyz;
        let vel_len = length(vel);
        if (vel_len > 0.01) {
          acc += (vel / vel_len) * swim_force * 0.5;
          // More vertical wandering when searching
          acc.y += random_signed(seed + 4u) * swim_force * (0.4 + hunger_factor * 0.4);
        } else {
          // If stationary, start moving in random 3D direction
          let angle_xz = random_float(seed + 5u) * 6.28318;
          let angle_y = (random_float(seed + 6u) - 0.5) * 2.0;
          acc.x += cos(angle_xz) * swim_force * 0.4;
          acc.z += sin(angle_xz) * swim_force * 0.4;
          acc.y += angle_y * swim_force * 0.3;
        }
      }
      if (limbs > 0.2) { acc *= (1.0 + limbs * 0.3); }
    } else if (limbs > 0.3) {
      if (random_float(seed + 4u) < 0.05 * limbs) {
        let angle = random_float(seed + 5u) * 6.28318;
        let land_force = swim_force * limbs;
        acc.x += cos(angle) * land_force;
        acc.z += sin(angle) * land_force;
      }
    }
  }

  c.acceleration = vec4<f32>(acc, max_force);
  creatures_out[idx] = c;
}
`;

export const METABOLISM_SHADER = /* wgsl */`
// Metabolism Compute Shader
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

const FLAG_DEAD: u32 = 1u;
const FLAG_MATURE: u32 = 2u;
const FLAG_IN_WATER: u32 = 4u;
const FLAG_NEEDS_REPRODUCTION: u32 = 16u;
const MATURITY_AGE: f32 = 10.0;
const LIFESPAN_BASE: f32 = 60.0;
// Lowered from 150 to make reproduction more achievable
const REPRO_ENERGY_BASE: f32 = 120.0;

@group(0) @binding(0) var<uniform> uniforms: SimUniforms;
@group(0) @binding(1) var<storage, read> creatures_in: array<Creature>;
@group(0) @binding(2) var<storage, read_write> creatures_out: array<Creature>;

fn get_biome_temp(z: f32) -> f32 {
  if (z < -300.0) { return 5.0; }
  if (z < -100.0) { return 15.0; }
  if (z < 0.0) { return 25.0; }
  if (z < 200.0) { return 20.0; }
  if (z < 350.0) { return 40.0; }
  return -10.0;
}

fn calculate_max_age(c: Creature) -> f32 {
  let size = c.core_genes.x;
  let complexity = (c.core_genes.z + c.core_genes.w + c.movement_genes.y + c.movement_genes.z) / 4.0;
  var max_age = LIFESPAN_BASE + 30.0;
  max_age *= (1.0 - size * 0.3);
  max_age *= (1.0 - complexity * 0.2);
  max_age *= (1.0 + c.movement_genes.w * 0.5);
  return max(30.0, max_age);
}

@compute @workgroup_size(256)
fn update_metabolism(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  if (idx >= uniforms.creature_count) { return; }
  var c = creatures_in[idx];
  var flags = bitcast<u32>(c.energy_age_gen_flags.w);
  if ((flags & FLAG_DEAD) != 0u) { creatures_out[idx] = c; return; }

  let dt = uniforms.dt;
  let pos = c.position.xyz;
  let vel = c.velocity.xyz;
  let speed = length(vel);

  let size = c.core_genes.x;
  let speed_gene = c.core_genes.y;
  let armor = c.core_genes.z;
  let toxicity = c.core_genes.w;
  let sight = c.sense_genes.x;
  let smell = c.sense_genes.y;
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

  age += dt;
  let max_age = calculate_max_age(c);
  if (age >= max_age) {
    flags = flags | FLAG_DEAD;
    c.energy_age_gen_flags = vec4<f32>(0.0, age, generation, bitcast<f32>(flags));
    creatures_out[idx] = c;
    return;
  }

  if (!is_mature && age >= MATURITY_AGE) { flags = flags | FLAG_MATURE; }

  if (!is_mature) {
    var total_dev_cost = size * 25.0 + speed_gene * 12.0 + sight * 15.0 + smell * 5.0 + armor * 20.0 + toxicity * 15.0 + limbs * 20.0 + jaws * 22.0;
    energy -= (total_dev_cost / MATURITY_AGE) * dt;
  }

  var basal_cost = 0.05 * (1.0 + size * 1.5) * (1.0 - metabolic_efficiency * 0.5);
  var maintenance_cost = size * 0.04 + speed_gene * 0.015 + sight * 0.025 + smell * 0.008 + armor * 0.015 + toxicity * 0.02 + limbs * 0.015 + jaws * 0.015 + predatory * 0.015 + filter_feeding * 0.003;
  if (armor > 0.3) { maintenance_cost *= (1.0 + armor * 0.15); }

  let temp = get_biome_temp(pos.z);
  var temp_cost = 0.0;
  if (temp < 10.0) { temp_cost = (10.0 - temp) * 0.02; }
  else if (temp > 30.0) { temp_cost = (temp - 30.0) * 0.02; }

  var move_cost = speed * speed * 0.08 * (1.0 + speed_gene * 1.5);
  if (is_in_water) { move_cost *= (1.0 + limbs * 0.3); }
  else { move_cost *= (1.0 - limbs * 0.5); }

  if (!is_in_water && limbs < 0.3) { energy -= 0.5 * dt; }

  energy -= (basal_cost + move_cost + temp_cost + maintenance_cost) * dt;

  // Filter feeding - passive energy gain for slow-moving creatures in water
  if (is_in_water && speed < 0.5) {
    // Increased base gain to make filter feeders more viable
    let filter_gain = 0.8 * dt * (1.0 + filter_feeding * 4.0) * (1.0 + smell * 0.5) * (1.0 - predatory * 0.5);
    energy += filter_gain;
  }

  if (energy <= 0.0) { flags = flags | FLAG_DEAD; energy = 0.0; }

  flags = flags & ~FLAG_NEEDS_REPRODUCTION;
  if ((flags & FLAG_MATURE) != 0u && energy > REPRO_ENERGY_BASE) {
    let threshold = select(REPRO_ENERGY_BASE + 25.0, (REPRO_ENERGY_BASE + 25.0) * 0.6, predatory > 0.5);
    if (energy > threshold) { flags = flags | FLAG_NEEDS_REPRODUCTION; }
  }

  c.energy_age_gen_flags = vec4<f32>(energy, age, generation, bitcast<f32>(flags));
  creatures_out[idx] = c;
}
`;
