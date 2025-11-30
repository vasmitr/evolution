// Behavior Compute Shader
// Handles creature AI: hunting, scavenging, exploration, movement decisions

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

struct GridCell {
  count: atomic<u32>,
  creatures: array<u32, 64>,
}

struct Corpse {
  position: vec4<f32>,
  data: vec4<f32>,
}

// Flag constants
const FLAG_DEAD: u32 = 1u;
const FLAG_MATURE: u32 = 2u;
const FLAG_IN_WATER: u32 = 4u;
const FLAG_UPDATE_OFFSET_MASK: u32 = 224u;

const MAX_CREATURES_PER_CELL: u32 = 64u;
const GRID_SIZE: u32 = 20u;

@group(0) @binding(0) var<uniform> uniforms: SimUniforms;
@group(0) @binding(1) var<storage, read> creatures_in: array<Creature>;
@group(0) @binding(2) var<storage, read_write> creatures_out: array<Creature>;
@group(0) @binding(3) var<storage, read> grid: array<GridCell>;
@group(0) @binding(4) var<storage, read> corpses: array<Corpse>;
@group(0) @binding(5) var<uniform> corpse_count: u32;

// Random number generation
fn pcg_hash(input: u32) -> u32 {
  var state = input * 747796405u + 2891336453u;
  var word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn random_float(seed: u32) -> f32 {
  return f32(pcg_hash(seed)) / 4294967295.0;
}

fn random_signed(seed: u32) -> f32 {
  return random_float(seed) * 2.0 - 1.0;
}

// Get cell index from position
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

// Check if creature can detect target
fn can_detect(
  hunter_sight: f32,
  hunter_smell: f32,
  hunter_hearing: f32,
  distance: f32,
  sense_range: f32,
  is_in_water: bool,
  water_depth: f32
) -> bool {
  if (distance > sense_range) {
    return false;
  }

  // Simple detection probability based on senses
  let sight_contrib = select(hunter_sight * 0.6, select(hunter_sight * 0.5, hunter_sight * 0.1, water_depth > 10.0), is_in_water);
  let smell_contrib = hunter_smell * 0.3;
  let hearing_contrib = select(hunter_hearing * 0.1, hunter_hearing * 0.4, is_in_water);

  let total_sense = sight_contrib + smell_contrib + hearing_contrib;
  let detection_chance = max(0.3, 1.0 - (distance / sense_range) * 0.5);

  // Use deterministic "random" based on distance to avoid flickering
  let pseudo_random = fract(distance * 17.31 + total_sense * 23.17);
  return pseudo_random < detection_chance;
}

// Score a potential prey target
fn score_prey(
  hunter: Creature,
  target: Creature,
  distance: f32
) -> f32 {
  let size_diff = hunter.core_genes.x - target.core_genes.x;
  let target_armor = target.core_genes.z;
  let target_toxicity = target.core_genes.w;

  return size_diff * 20.0 - target_armor * 30.0 - target_toxicity * 50.0 - distance * 0.5;
}

// Score a corpse for scavenging
fn score_corpse(
  creature: Creature,
  corpse: Corpse,
  distance: f32
) -> f32 {
  let energy = corpse.data.x;
  let toxicity = corpse.data.y;
  let creature_toxicity = creature.core_genes.w;

  // Prefer high energy, low toxicity corpses
  var score = energy * 0.5 - distance * 0.3;

  // Penalty for toxic corpses (unless we're toxic too)
  if (toxicity > creature_toxicity) {
    score -= (toxicity - creature_toxicity) * 20.0;
  }

  return score;
}

@compute @workgroup_size(256)
fn update_behavior(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  if (idx >= uniforms.creature_count) {
    return;
  }

  var c = creatures_in[idx];
  var flags = bitcast<u32>(c.energy_age_gen_flags.w);

  // Skip dead creatures
  if ((flags & FLAG_DEAD) != 0u) {
    creatures_out[idx] = c;
    return;
  }

  // Staggered updates - only update 1/8 creatures per frame
  let update_offset = (flags & FLAG_UPDATE_OFFSET_MASK) >> 5u;
  if ((uniforms.frame_count % 8u) != update_offset) {
    creatures_out[idx] = c;
    return;
  }

  let pos = c.position.xyz;
  let is_in_water = (flags & FLAG_IN_WATER) != 0u;

  // Gene values
  let size = c.core_genes.x;
  let speed_gene = c.core_genes.y;
  let sight = c.sense_genes.x;
  let smell = c.sense_genes.y;
  let hearing = c.sense_genes.z;
  let sense_radius = min(c.sense_genes.w, 60.0); // Cap for performance
  let predatory = c.behavior_genes.x;
  let parasitic = c.behavior_genes.y;
  let scavenging = c.behavior_genes.z;
  let filter_feeding = c.behavior_genes.w;
  let maneuverability = c.movement_genes.x;
  let limbs = c.movement_genes.y;
  let jaws = c.movement_genes.z;

  let max_force = c.acceleration.w;
  let max_speed = c.velocity.w;

  // Calculate water depth for detection
  let water_depth = select(0.0, abs(pos.y), is_in_water);

  // Determine cell and search range
  let center_cell_x = i32((pos.x + uniforms.world_width * 0.5) / uniforms.cell_size);
  let center_cell_z = i32((pos.z + uniforms.world_depth * 0.5) / uniforms.cell_size);
  let search_range = i32(ceil(sense_radius / uniforms.cell_size));

  // Track best targets
  var best_prey_score = -999999.0;
  var best_prey_dir = vec3<f32>(0.0);
  var best_corpse_score = -999999.0;
  var best_corpse_dir = vec3<f32>(0.0);

  var acc = vec3<f32>(0.0);

  // Search nearby cells for creatures
  if (predatory > 0.3 && jaws > 0.2) {
    for (var dz = -search_range; dz <= search_range; dz++) {
      for (var dx = -search_range; dx <= search_range; dx++) {
        let cell_x = center_cell_x + dx;
        let cell_z = center_cell_z + dz;

        // Bounds check
        if (cell_x < 0 || cell_x >= i32(GRID_SIZE) || cell_z < 0 || cell_z >= i32(GRID_SIZE)) {
          continue;
        }

        let cell_idx = u32(cell_z) * GRID_SIZE + u32(cell_x);
        let cell_count = atomicLoad(&grid[cell_idx].count);

        for (var i = 0u; i < min(cell_count, MAX_CREATURES_PER_CELL); i++) {
          let target_idx = grid[cell_idx].creatures[i];

          // Skip self
          if (target_idx == idx) {
            continue;
          }

          let target = creatures_in[target_idx];
          let target_flags = bitcast<u32>(target.energy_age_gen_flags.w);

          // Skip dead targets
          if ((target_flags & FLAG_DEAD) != 0u) {
            continue;
          }

          let target_pos = target.position.xyz;
          let dist = distance(pos, target_pos);

          // Skip if too far
          if (dist > sense_radius) {
            continue;
          }

          // Detection check
          if (!can_detect(sight, smell, hearing, dist, sense_radius, is_in_water, water_depth)) {
            continue;
          }

          let score = score_prey(c, target, dist);
          if (score > best_prey_score) {
            best_prey_score = score;
            best_prey_dir = normalize(target_pos - pos);
          }
        }
      }
    }
  }

  // Search for corpses if scavenging
  if (scavenging > 0.2 || predatory > 0.5) {
    let detect_range = 10.0 + smell * 40.0 + sight * 15.0 + scavenging * 20.0;

    for (var i = 0u; i < corpse_count; i++) {
      let corpse = corpses[i];
      let corpse_pos = corpse.position.xyz;
      let dist = distance(pos, corpse_pos);

      if (dist > detect_range) {
        continue;
      }

      let score = score_corpse(c, corpse, dist);
      if (score > best_corpse_score) {
        best_corpse_score = score;
        best_corpse_dir = normalize(corpse_pos - pos);
      }
    }
  }

  // Apply behavior acceleration
  let hunt_force = max_force * (0.5 + predatory * 0.5);
  let scavenge_force = max_force * (0.3 + scavenging * 0.4);

  if (best_prey_score > -100.0) {
    // Hunting behavior
    acc += best_prey_dir * hunt_force;
  } else if (best_corpse_score > -100.0) {
    // Scavenging behavior
    acc += best_corpse_dir * scavenge_force;
  } else {
    // Exploration behavior
    let seed = idx * 31u + uniforms.frame_count * 7u;

    if (speed_gene > 0.1 || maneuverability > 0.1) {
      let swim_force = max_force * (0.8 + speed_gene * 1.5 + maneuverability * 0.5);

      if (is_in_water) {
        // Random direction changes
        if (random_float(seed) < 0.03 * (1.0 + maneuverability)) {
          let angle = random_float(seed + 1u) * 6.28318;
          acc.x += cos(angle) * swim_force;
          acc.z += sin(angle) * swim_force;
          acc.y += random_signed(seed + 2u) * swim_force * 0.5;
        } else if (random_float(seed + 3u) < 0.1) {
          // Continue in current direction
          let vel = c.velocity.xyz;
          let vel_len = length(vel.xz);
          if (vel_len > 0.01) {
            acc.x += (vel.x / vel_len) * swim_force * 0.5;
            acc.z += (vel.z / vel_len) * swim_force * 0.5;
          }
        }

        // Limb swimming bonus
        if (limbs > 0.2) {
          acc *= (1.0 + limbs * 0.3);
        }
      } else if (limbs > 0.3) {
        // Land movement requires limbs
        if (random_float(seed + 4u) < 0.05 * limbs) {
          let angle = random_float(seed + 5u) * 6.28318;
          let land_force = swim_force * limbs;
          acc.x += cos(angle) * land_force;
          acc.z += sin(angle) * land_force;
        }
      }
    }
  }

  // Write acceleration
  c.acceleration = vec4<f32>(acc, max_force);

  creatures_out[idx] = c;
}
