// Physics Compute Shader
// Updates creature positions, velocities, and handles terrain/water physics

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

@group(0) @binding(0) var<uniform> uniforms: SimUniforms;
@group(0) @binding(1) var<storage, read> creatures_in: array<Creature>;
@group(0) @binding(2) var<storage, read_write> creatures_out: array<Creature>;

// Noise functions for terrain
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

// Ocean current calculation
fn get_current(pos: vec3<f32>, time: f32, terrain_height: f32) -> vec3<f32> {
  let scale1 = 0.002;
  let n1 = value_noise(vec2<f32>(pos.x * scale1, pos.z * scale1 + time * 0.05));
  let angle1 = n1 * 3.14159 * 4.0;

  let scale2 = 0.01;
  let n2 = value_noise(vec2<f32>(pos.x * scale2 - time * 0.1, pos.z * scale2));
  let angle2 = n2 * 3.14159 * 2.0;

  var current_x = cos(angle1) * 1.5 + cos(angle2) * 0.5;
  var current_z = sin(angle1) * 1.5 + sin(angle2) * 0.5;

  let scale3 = 0.015;
  let n3 = value_noise(vec2<f32>(pos.x * scale3 + 100.0, pos.z * scale3 + time * 0.1));
  var current_y = n3 * 0.5;

  // Reduce current near shore
  if (terrain_height > -20.0) {
    let depth_factor = max(0.0, (-terrain_height) / 20.0);
    current_x *= depth_factor;
    current_z *= depth_factor;

    // Wave action
    let wave = sin(time * 1.0 + pos.x * 0.05);
    current_x += wave * 0.5 * (1.0 - depth_factor);
  }

  return vec3<f32>(current_x, current_y, current_z);
}

@compute @workgroup_size(256)
fn update_physics(@builtin(global_invocation_id) global_id: vec3<u32>) {
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

  let dt = uniforms.dt;
  let size = c.core_genes.x;
  let speed_gene = c.core_genes.y;
  let limbs = c.movement_genes.y;
  let lung_capacity = c.movement_genes.z; // Actually stored in jaws slot, adjust if needed

  // Get current position
  var pos = c.position.xyz;
  var vel = c.velocity.xyz;
  var acc = c.acceleration.xyz;
  let max_speed = c.velocity.w;

  // Apply acceleration
  vel += acc * dt;

  // Clamp velocity to max speed
  let speed = length(vel);
  if (speed > max_speed) {
    vel = normalize(vel) * max_speed;
  }

  // Update position
  pos += vel * dt;

  // Get terrain height at new position
  let terrain_height = get_terrain_height(pos.x, pos.z);
  let min_height = terrain_height + size;

  // World bounds
  let half_width = uniforms.world_width * 0.5 - 10.0;
  let half_depth = uniforms.world_depth * 0.5 - 10.0;

  // X bounds
  if (pos.x > half_width) {
    pos.x = half_width;
    vel.x = -abs(vel.x) * 0.5;
  } else if (pos.x < -half_width) {
    pos.x = -half_width;
    vel.x = abs(vel.x) * 0.5;
  }

  // Z bounds
  if (pos.z > half_depth) {
    pos.z = half_depth;
    vel.z = -abs(vel.z) * 0.5;
  } else if (pos.z < -half_depth) {
    pos.z = -half_depth;
    vel.z = abs(vel.z) * 0.5;
  }

  // Height ceiling
  if (pos.y > 100.0) {
    pos.y = 100.0;
    vel.y = -abs(vel.y) * 0.5;
  }

  // Terrain collision
  if (pos.y < min_height) {
    pos.y = min_height;
    if (vel.y < 0.0) {
      vel.y = 0.0;
    }
  }

  // Determine environment
  let is_water_zone = pos.z < -100.0;
  let is_in_water = is_water_zone && pos.y < 0.0;

  // Update flags
  flags = flags & ~(FLAG_IN_WATER | FLAG_ON_LAND);
  if (is_in_water) {
    flags = flags | FLAG_IN_WATER;
  } else {
    flags = flags | FLAG_ON_LAND;
  }

  if (is_in_water) {
    // WATER PHYSICS
    let water_depth = abs(terrain_height);
    let target_y = terrain_height + min(water_depth * 0.4, 5.0) + size;
    let depth_error = target_y - pos.y;

    // Buoyancy
    vel.y += depth_error * 0.03;
    vel.y *= 0.85;

    // Stay below surface
    if (pos.y > -1.0) {
      vel.y -= 0.05;
    }

    // Water drag
    vel *= 0.95;

    // Ocean currents
    let current = get_current(pos, uniforms.time, terrain_height);
    let current_resistance = speed_gene * 0.5;
    let current_influence = 1.0 - current_resistance;
    pos += current * dt * 3.0 * current_influence;

  } else {
    // LAND/AIR PHYSICS
    // Gravity
    vel.y -= 0.1;

    // Air drag
    vel.x *= 0.95;
    vel.z *= 0.95;

    // Ground physics
    if (pos.y <= min_height + 0.1) {
      // Ground friction
      vel.x *= 0.9;
      vel.z *= 0.9;

      // Slope sliding
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

  // Write back
  c.position = vec4<f32>(pos, c.position.w);
  c.velocity = vec4<f32>(vel, max_speed);
  c.acceleration = vec4<f32>(0.0, 0.0, 0.0, c.acceleration.w); // Clear acceleration
  c.energy_age_gen_flags.w = bitcast<f32>(flags);

  creatures_out[idx] = c;
}
