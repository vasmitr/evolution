/**
 * GPU Buffer Layout for Plants
 * Manages plant data storage on the GPU for creature foraging behavior
 */

// Plant data layout - 8 floats = 32 bytes per plant (good alignment)
export const PLANT_FLOATS = 8;
export const PLANT_BYTES = PLANT_FLOATS * 4;

// Field offsets within a plant (in float32 indices)
// Matches WGSL struct: position: vec4<f32>, data: vec4<f32>
export const PLANT_LAYOUT = {
  posX: 0,
  posY: 1,
  posZ: 2,
  posPadding: 3,  // vec4 alignment padding
  energy: 4,      // data.x
  size: 5,        // data.y
  flags: 6,       // data.z - dead, isOnLand, etc.
  dataPadding: 7, // data.w padding
};

// Plant flags
export const PLANT_FLAGS = {
  DEAD: 1 << 0,
  ON_LAND: 1 << 1,
};

// Bitcast helper for u32 -> f32 conversion (matching WGSL bitcast)
const bitcastBuffer = new ArrayBuffer(4);
const bitcastF32 = new Float32Array(bitcastBuffer);
const bitcastU32 = new Uint32Array(bitcastBuffer);

function u32ToF32(value) {
  bitcastU32[0] = value;
  return bitcastF32[0];
}

export class PlantBuffer {
  /**
   * @param {import('./GPUContext.js').GPUContext} gpuContext
   * @param {number} maxPlants
   */
  constructor(gpuContext, maxPlants) {
    this.gpu = gpuContext;
    this.maxPlants = maxPlants;
    this.plantCount = 0;

    // CPU-side buffer for data upload
    this.cpuBuffer = new Float32Array(maxPlants * PLANT_FLOATS);

    // Create GPU storage buffer
    const bufferSize = maxPlants * PLANT_BYTES;

    this.buffer = gpuContext.createBuffer(
      bufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      'plants buffer'
    );

    // Uniform buffer for plant count
    this.countBuffer = gpuContext.createBuffer(
      16, // 4 u32s for alignment
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      'plant count uniform'
    );
  }

  /**
   * Pack a plant's data into the CPU buffer
   * @param {object} plant - Plant object
   * @param {number} index - Buffer index
   */
  packPlant(plant, index) {
    const offset = index * PLANT_FLOATS;
    const buf = this.cpuBuffer;

    // Position vec4
    buf[offset + PLANT_LAYOUT.posX] = plant.position.x;
    buf[offset + PLANT_LAYOUT.posY] = plant.position.y;
    buf[offset + PLANT_LAYOUT.posZ] = plant.position.z;
    buf[offset + PLANT_LAYOUT.posPadding] = 0;

    // Data vec4 (energy, size, flags, padding)
    buf[offset + PLANT_LAYOUT.energy] = plant.energy;
    buf[offset + PLANT_LAYOUT.size] = plant.size || 1;

    let flags = 0;
    if (plant.dead) flags |= PLANT_FLAGS.DEAD;
    if (plant.isOnLand) flags |= PLANT_FLAGS.ON_LAND;
    buf[offset + PLANT_LAYOUT.flags] = u32ToF32(flags);

    buf[offset + PLANT_LAYOUT.dataPadding] = 0;
  }

  /**
   * Sync all plants from CPU array to GPU
   * @param {Array} plants - Array of plant objects
   */
  syncFromCPU(plants) {
    this.plantCount = Math.min(plants.length, this.maxPlants);

    for (let i = 0; i < this.plantCount; i++) {
      this.packPlant(plants[i], i);
    }

    // Upload to GPU
    const dataSize = this.plantCount * PLANT_BYTES;
    if (dataSize > 0) {
      this.gpu.writeBuffer(this.buffer, this.cpuBuffer.buffer, 0, dataSize);
    }

    // Update count uniform
    const countData = new Uint32Array([this.plantCount, 0, 0, 0]);
    this.gpu.writeBuffer(this.countBuffer, countData);
  }

  /**
   * Get buffer binding resources for shader
   */
  getBindGroupEntries() {
    return {
      plants: { buffer: this.buffer },
      plantCount: { buffer: this.countBuffer },
    };
  }

  /**
   * Get current plant count
   */
  getCount() {
    return this.plantCount;
  }

  /**
   * Destroy GPU resources
   */
  destroy() {
    this.buffer.destroy();
    this.countBuffer.destroy();
  }
}
