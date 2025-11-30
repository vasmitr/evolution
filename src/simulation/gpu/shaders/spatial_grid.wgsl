// Spatial Grid Compute Shaders
// Build and query a grid-based acceleration structure for neighbor finding

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

// Grid parameters
const MAX_CREATURES_PER_CELL: u32 = 64u;
const GRID_SIZE: u32 = 20u; // 20x20 grid = 400 cells for 1000x1000 world with 50-unit cells

struct GridCell {
  count: atomic<u32>,
  creatures: array<u32, 64>,
}

@group(0) @binding(0) var<uniform> uniforms: SimUniforms;
@group(0) @binding(1) var<storage, read> creatures: array<Creature>;
@group(0) @binding(2) var<storage, read_write> grid: array<GridCell>;
@group(0) @binding(3) var<storage, read_write> cell_counts: array<atomic<u32>>;

// Helper to get grid cell from world position
fn get_cell_index(pos: vec3<f32>) -> u32 {
  let half_width = uniforms.world_width * 0.5;
  let half_depth = uniforms.world_depth * 0.5;

  // Clamp to world bounds
  let x = clamp(pos.x, -half_width, half_width - 1.0);
  let z = clamp(pos.z, -half_depth, half_depth - 1.0);

  // Convert to grid coordinates
  let cell_x = u32((x + half_width) / uniforms.cell_size);
  let cell_z = u32((z + half_depth) / uniforms.cell_size);

  // Clamp to grid bounds
  let cx = min(cell_x, GRID_SIZE - 1u);
  let cz = min(cell_z, GRID_SIZE - 1u);

  return cz * GRID_SIZE + cx;
}

// Clear grid - run with (GRID_SIZE * GRID_SIZE / 256) workgroups
@compute @workgroup_size(256)
fn clear_grid(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let cell_idx = global_id.x;
  if (cell_idx >= GRID_SIZE * GRID_SIZE) {
    return;
  }

  atomicStore(&grid[cell_idx].count, 0u);
  atomicStore(&cell_counts[cell_idx], 0u);
}

// Populate grid - run with (creature_count / 256) workgroups
@compute @workgroup_size(256)
fn populate_grid(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let creature_idx = global_id.x;
  if (creature_idx >= uniforms.creature_count) {
    return;
  }

  let c = creatures[creature_idx];

  // Skip dead creatures
  let flags = bitcast<u32>(c.energy_age_gen_flags.w);
  if ((flags & 1u) != 0u) {
    return;
  }

  let cell_idx = get_cell_index(c.position.xyz);

  // Atomically add to cell
  let slot = atomicAdd(&grid[cell_idx].count, 1u);

  // Only add if there's room
  if (slot < MAX_CREATURES_PER_CELL) {
    grid[cell_idx].creatures[slot] = creature_idx;
  }

  // Track total count for stats
  atomicAdd(&cell_counts[cell_idx], 1u);
}
