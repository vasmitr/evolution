/**
 * GPU Buffer Layout for Creatures
 * Manages creature data storage on the GPU with aligned memory layout
 */

// Creature data layout - 32 floats = 128 bytes per creature (good alignment)
// This matches the WGSL Creature struct
export const CREATURE_FLOATS = 32;
export const CREATURE_BYTES = CREATURE_FLOATS * 4;

// Bitcast helpers for u32 <-> f32 conversion (matching WGSL bitcast)
const bitcastBuffer = new ArrayBuffer(4);
const bitcastF32 = new Float32Array(bitcastBuffer);
const bitcastU32 = new Uint32Array(bitcastBuffer);

function u32ToF32(value) {
  bitcastU32[0] = value;
  return bitcastF32[0];
}

function f32ToU32(value) {
  bitcastF32[0] = value;
  return bitcastU32[0];
}

// Field offsets within a creature (in float32 indices)
export const CREATURE_LAYOUT = {
  // Position (vec4): x, y, z, radius
  posX: 0,
  posY: 1,
  posZ: 2,
  radius: 3,

  // Velocity (vec4): vx, vy, vz, maxSpeed
  velX: 4,
  velY: 5,
  velZ: 6,
  maxSpeed: 7,

  // Acceleration (vec4): ax, ay, az, maxForce
  accX: 8,
  accY: 9,
  accZ: 10,
  maxForce: 11,

  // Energy and lifecycle (vec4): energy, age, generation, flags (as float)
  energy: 12,
  age: 13,
  generation: 14,
  flags: 15,

  // Core genes (vec4): size, speed, armor, toxicity
  size: 16,
  speedGene: 17,
  armor: 18,
  toxicity: 19,

  // Sense genes (vec4): sight, smell, hearing, senseRadius
  sight: 20,
  smell: 21,
  hearing: 22,
  senseRadius: 23,

  // Behavior genes (vec4): predatory, parasitic, scavenging, filterFeeding
  predatory: 24,
  parasitic: 25,
  scavenging: 26,
  filterFeeding: 27,

  // Movement/misc genes (vec4): maneuverability, limbs, jaws, metabolicEfficiency
  maneuverability: 28,
  limbs: 29,
  jaws: 30,
  metabolicEfficiency: 31,
};

// Bit flags for creature state (stored as float, reinterpreted as u32)
export const CREATURE_FLAGS = {
  DEAD: 1 << 0,
  MATURE: 1 << 1,
  IN_WATER: 1 << 2,
  ON_LAND: 1 << 3,
  NEEDS_REPRODUCTION: 1 << 4,
  UPDATE_OFFSET_MASK: 0x7 << 5, // 3 bits for stagger offset (0-7)
};

export class CreatureBuffer {
  /**
   * @param {import('./GPUContext.js').GPUContext} gpuContext
   * @param {number} maxCreatures
   */
  constructor(gpuContext, maxCreatures) {
    this.gpu = gpuContext;
    this.maxCreatures = maxCreatures;
    this.creatureCount = 0;

    // CPU-side buffer for initial data upload
    this.cpuBuffer = new Float32Array(maxCreatures * CREATURE_FLOATS);

    // Create double-buffered GPU storage (ping-pong)
    const bufferSize = maxCreatures * CREATURE_BYTES;

    this.bufferA = gpuContext.createBuffer(
      bufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      'creatures buffer A'
    );

    this.bufferB = gpuContext.createBuffer(
      bufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      'creatures buffer B'
    );

    // Uniform buffer for simulation parameters
    // 16 floats = 64 bytes (aligned)
    this.uniformBuffer = gpuContext.createBuffer(
      64,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      'simulation uniforms'
    );

    // Current read/write buffers (swap each frame)
    this.readBuffer = this.bufferA;
    this.writeBuffer = this.bufferB;

    // ID to index mapping (for CPU-side creature management)
    this.idToIndex = new Map();
    this.indexToId = new Map();
    this.freeIndices = [];
  }

  /**
   * Pack a creature's data into the CPU buffer
   * @param {object} creature - Creature object from WorkerCreature
   * @param {number} index - Buffer index
   */
  packCreature(creature, index) {
    const offset = index * CREATURE_FLOATS;
    const buf = this.cpuBuffer;

    // Position
    buf[offset + CREATURE_LAYOUT.posX] = creature.position.x;
    buf[offset + CREATURE_LAYOUT.posY] = creature.position.y;
    buf[offset + CREATURE_LAYOUT.posZ] = creature.position.z;
    buf[offset + CREATURE_LAYOUT.radius] = creature.size * 2 + 1; // Collision radius

    // Velocity
    buf[offset + CREATURE_LAYOUT.velX] = creature.velocity.x;
    buf[offset + CREATURE_LAYOUT.velY] = creature.velocity.y;
    buf[offset + CREATURE_LAYOUT.velZ] = creature.velocity.z;
    buf[offset + CREATURE_LAYOUT.maxSpeed] = creature.maxSpeed;

    // Acceleration
    buf[offset + CREATURE_LAYOUT.accX] = creature.acceleration.x;
    buf[offset + CREATURE_LAYOUT.accY] = creature.acceleration.y;
    buf[offset + CREATURE_LAYOUT.accZ] = creature.acceleration.z;
    buf[offset + CREATURE_LAYOUT.maxForce] = creature.maxForce;

    // Energy and lifecycle
    buf[offset + CREATURE_LAYOUT.energy] = creature.energy;
    buf[offset + CREATURE_LAYOUT.age] = creature.age;
    buf[offset + CREATURE_LAYOUT.generation] = creature.generation;

    // Pack flags - need to bitcast u32 to f32 like the shader does
    let flags = 0;
    if (creature.dead) flags |= CREATURE_FLAGS.DEAD;
    if (creature.mature) flags |= CREATURE_FLAGS.MATURE;
    // IN_WATER and ON_LAND are calculated in shader
    // Store update offset in flags (for staggered updates)
    flags |= ((creature.id % 8) << 5);
    buf[offset + CREATURE_LAYOUT.flags] = u32ToF32(flags);

    // Core genes
    buf[offset + CREATURE_LAYOUT.size] = creature.size;
    buf[offset + CREATURE_LAYOUT.speedGene] = creature.speed;
    buf[offset + CREATURE_LAYOUT.armor] = creature.armor;
    buf[offset + CREATURE_LAYOUT.toxicity] = creature.toxicity;

    // Sense genes
    buf[offset + CREATURE_LAYOUT.sight] = creature.sight;
    buf[offset + CREATURE_LAYOUT.smell] = creature.smell;
    buf[offset + CREATURE_LAYOUT.hearing] = creature.hearing;
    buf[offset + CREATURE_LAYOUT.senseRadius] = this.calculateSenseRadius(creature);

    // Behavior genes
    buf[offset + CREATURE_LAYOUT.predatory] = creature.predatory;
    buf[offset + CREATURE_LAYOUT.parasitic] = creature.parasitic;
    buf[offset + CREATURE_LAYOUT.scavenging] = creature.scavenging;
    buf[offset + CREATURE_LAYOUT.filterFeeding] = creature.filterFeeding;

    // Movement genes
    buf[offset + CREATURE_LAYOUT.maneuverability] = creature.maneuverability;
    buf[offset + CREATURE_LAYOUT.limbs] = creature.limbs;
    buf[offset + CREATURE_LAYOUT.jaws] = creature.jaws;
    buf[offset + CREATURE_LAYOUT.metabolicEfficiency] = creature.metabolicEfficiency;
  }

  /**
   * Calculate approximate sense radius for spatial queries
   */
  calculateSenseRadius(creature) {
    // Approximate maximum detection range
    return 5 + creature.sight * 30 + creature.smell * 25 + creature.hearing * 20;
  }

  /**
   * Add a creature to the GPU buffer
   * @param {object} creature
   * @returns {number} Assigned buffer index
   */
  addCreature(creature) {
    let index;
    if (this.freeIndices.length > 0) {
      index = this.freeIndices.pop();
    } else {
      index = this.creatureCount;
      if (index >= this.maxCreatures) {
        console.warn('Max creatures reached');
        return -1;
      }
      this.creatureCount++;
    }

    this.packCreature(creature, index);
    this.idToIndex.set(creature.id, index);
    this.indexToId.set(index, creature.id);

    return index;
  }

  /**
   * Remove a creature from the buffer
   * @param {number} id - Creature ID
   */
  removeCreature(id) {
    const index = this.idToIndex.get(id);
    if (index === undefined) return;

    // Mark as dead in buffer - need to bitcast properly
    const offset = index * CREATURE_FLOATS;
    let flags = f32ToU32(this.cpuBuffer[offset + CREATURE_LAYOUT.flags]);
    flags |= CREATURE_FLAGS.DEAD;
    this.cpuBuffer[offset + CREATURE_LAYOUT.flags] = u32ToF32(flags);

    // Track free slot
    this.freeIndices.push(index);
    this.idToIndex.delete(id);
    this.indexToId.delete(index);
  }

  /**
   * Upload all creature data to GPU
   */
  uploadAll() {
    const dataSize = this.creatureCount * CREATURE_BYTES;
    this.gpu.writeBuffer(this.readBuffer, this.cpuBuffer.buffer, 0, dataSize);
  }

  /**
   * Upload a specific creature's data
   * @param {number} index
   */
  uploadCreature(index) {
    const offset = index * CREATURE_BYTES;
    const data = new Float32Array(this.cpuBuffer.buffer, offset, CREATURE_FLOATS);
    this.gpu.writeBuffer(this.readBuffer, data, offset);
  }

  /**
   * Update simulation uniforms
   * @param {object} params
   */
  updateUniforms(params) {
    // Use ArrayBuffer with different views for mixed types
    const buffer = new ArrayBuffer(32); // 8 x 4 bytes
    const floatView = new Float32Array(buffer);
    const uintView = new Uint32Array(buffer);

    floatView[0] = params.dt || 0.016;
    floatView[1] = params.time || 0;
    uintView[2] = params.frameCount || 0;  // u32
    uintView[3] = this.creatureCount;       // u32
    floatView[4] = params.worldWidth || 1000;
    floatView[5] = params.worldDepth || 1000;
    floatView[6] = params.cellSize || 50;
    floatView[7] = 0; // padding

    this.gpu.writeBuffer(this.uniformBuffer, floatView);
  }

  /**
   * Swap read/write buffers (ping-pong)
   */
  swap() {
    const temp = this.readBuffer;
    this.readBuffer = this.writeBuffer;
    this.writeBuffer = temp;
  }

  /**
   * Read creature data back from GPU
   * @returns {Promise<Float32Array>}
   */
  async readback() {
    const size = this.creatureCount * CREATURE_BYTES;
    const data = await this.gpu.readBuffer(this.readBuffer, size);
    return new Float32Array(data);
  }

  /**
   * Unpack creature data from GPU readback
   * @param {Float32Array} data - GPU data
   * @param {number} index - Creature index
   * @returns {object} Unpacked creature data
   */
  unpackCreature(data, index) {
    const offset = index * CREATURE_FLOATS;

    // Flags are stored as bitcast<f32>(u32) in WGSL, need to reinterpret bits
    const flags = f32ToU32(data[offset + CREATURE_LAYOUT.flags]);

    return {
      position: {
        x: data[offset + CREATURE_LAYOUT.posX],
        y: data[offset + CREATURE_LAYOUT.posY],
        z: data[offset + CREATURE_LAYOUT.posZ],
      },
      velocity: {
        x: data[offset + CREATURE_LAYOUT.velX],
        y: data[offset + CREATURE_LAYOUT.velY],
        z: data[offset + CREATURE_LAYOUT.velZ],
      },
      energy: data[offset + CREATURE_LAYOUT.energy],
      age: data[offset + CREATURE_LAYOUT.age],
      generation: data[offset + CREATURE_LAYOUT.generation],
      dead: (flags & CREATURE_FLAGS.DEAD) !== 0,
      mature: (flags & CREATURE_FLAGS.MATURE) !== 0,
      needsReproduction: (flags & CREATURE_FLAGS.NEEDS_REPRODUCTION) !== 0,
    };
  }

  /**
   * Get buffer binding resources for shader
   */
  getBindGroupEntries() {
    return {
      readBuffer: { buffer: this.readBuffer },
      writeBuffer: { buffer: this.writeBuffer },
      uniforms: { buffer: this.uniformBuffer },
    };
  }

  /**
   * Get current creature count
   */
  getCount() {
    return this.creatureCount - this.freeIndices.length;
  }

  /**
   * Destroy GPU resources
   */
  destroy() {
    this.bufferA.destroy();
    this.bufferB.destroy();
    this.uniformBuffer.destroy();
  }
}
