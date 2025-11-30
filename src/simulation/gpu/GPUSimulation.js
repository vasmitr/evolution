/**
 * GPU Simulation Orchestrator
 * Manages compute shaders and coordinates GPU-based creature simulation
 */

import { getGPUContext } from './GPUContext.js';
import { CreatureBuffer, CREATURE_FLOATS, CREATURE_LAYOUT, CREATURE_FLAGS } from './CreatureBuffer.js';
import { SPATIAL_GRID_SHADER, PHYSICS_SHADER, BEHAVIOR_SHADER, METABOLISM_SHADER } from './shaders.js';

const GRID_SIZE = 20; // 20x20 grid
const MAX_CREATURES_PER_CELL = 64;
const CELL_STRIDE = 65; // 1 count + 64 creature indices
const MAX_CREATURES = 100000;
const MAX_CORPSES = 10000;

export class GPUSimulation {
  constructor() {
    this.gpu = getGPUContext();
    this.initialized = false;
    this.creatureBuffer = null;

    // Compute pipelines
    this.clearGridPipeline = null;
    this.populateGridPipeline = null;
    this.physicsPipeline = null;
    this.behaviorPipeline = null;
    this.metabolismPipeline = null;

    // Bind group layouts
    this.gridBindGroupLayout = null;
    this.physicsBindGroupLayout = null;
    this.behaviorBindGroupLayout = null;
    this.metabolismBindGroupLayout = null;

    // GPU Buffers
    this.gridBuffer = null;
    this.cellCountsBuffer = null;
    this.corpseBuffer = null;
    this.corpseCountBuffer = null;

    // Simulation state
    this.frameCount = 0;
    this.time = 0;

    // CPU-side creature data (for reproduction, stats)
    this.cpuCreatures = new Map(); // id -> creature data
    this.pendingBirths = [];
    this.pendingDeaths = [];
  }

  /**
   * Initialize GPU simulation
   * @returns {Promise<boolean>}
   */
  async initialize() {
    if (this.initialized) return true;

    const gpuReady = await this.gpu.initialize();
    if (!gpuReady) {
      console.warn('GPU not available, falling back to CPU simulation');
      return false;
    }

    try {
      // Create creature buffer
      this.creatureBuffer = new CreatureBuffer(this.gpu, MAX_CREATURES);

      // Create grid buffers
      const gridBufferSize = GRID_SIZE * GRID_SIZE * CELL_STRIDE * 4; // u32 array

      this.gridBuffer = this.gpu.createBuffer(
        gridBufferSize,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        'spatial grid'
      );

      this.cellCountsBuffer = this.gpu.createBuffer(
        GRID_SIZE * GRID_SIZE * 4, // u32 per cell
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        'cell counts'
      );

      // Corpse buffer
      this.corpseBuffer = this.gpu.createBuffer(
        MAX_CORPSES * 32, // 8 floats per corpse
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        'corpses'
      );

      this.corpseCountBuffer = this.gpu.createBuffer(
        4,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        'corpse count'
      );

      // Create compute pipelines
      await this.createPipelines();

      this.initialized = true;
      console.log('GPU Simulation initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize GPU simulation:', error);
      return false;
    }
  }

  /**
   * Create all compute pipelines
   */
  async createPipelines() {
    const device = this.gpu.getDevice();

    // === Spatial Grid Pipelines ===
    const gridModule = this.gpu.createShaderModule(SPATIAL_GRID_SHADER, 'spatial grid');

    this.gridBindGroupLayout = device.createBindGroupLayout({
      label: 'grid bind group layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ]
    });

    const gridPipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.gridBindGroupLayout]
    });

    this.clearGridPipeline = device.createComputePipeline({
      label: 'clear grid pipeline',
      layout: gridPipelineLayout,
      compute: { module: gridModule, entryPoint: 'clear_grid' }
    });

    this.populateGridPipeline = device.createComputePipeline({
      label: 'populate grid pipeline',
      layout: gridPipelineLayout,
      compute: { module: gridModule, entryPoint: 'populate_grid' }
    });

    // === Physics Pipeline ===
    const physicsModule = this.gpu.createShaderModule(PHYSICS_SHADER, 'physics');

    this.physicsBindGroupLayout = device.createBindGroupLayout({
      label: 'physics bind group layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ]
    });

    this.physicsPipeline = device.createComputePipeline({
      label: 'physics pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.physicsBindGroupLayout] }),
      compute: { module: physicsModule, entryPoint: 'update_physics' }
    });

    // === Behavior Pipeline ===
    const behaviorModule = this.gpu.createShaderModule(BEHAVIOR_SHADER, 'behavior');

    this.behaviorBindGroupLayout = device.createBindGroupLayout({
      label: 'behavior bind group layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ]
    });

    this.behaviorPipeline = device.createComputePipeline({
      label: 'behavior pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.behaviorBindGroupLayout] }),
      compute: { module: behaviorModule, entryPoint: 'update_behavior' }
    });

    // === Metabolism Pipeline ===
    const metabolismModule = this.gpu.createShaderModule(METABOLISM_SHADER, 'metabolism');

    this.metabolismBindGroupLayout = device.createBindGroupLayout({
      label: 'metabolism bind group layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ]
    });

    this.metabolismPipeline = device.createComputePipeline({
      label: 'metabolism pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.metabolismBindGroupLayout] }),
      compute: { module: metabolismModule, entryPoint: 'update_metabolism' }
    });
  }

  /**
   * Add creatures from CPU data
   * @param {Array} creatures - Array of WorkerCreature objects
   */
  addCreatures(creatures) {
    for (const creature of creatures) {
      const index = this.creatureBuffer.addCreature(creature);
      if (index >= 0) {
        this.cpuCreatures.set(creature.id, creature);
      }
    }
  }

  /**
   * Update corpse buffer
   * @param {Array} corpses - Array of corpse objects
   */
  updateCorpses(corpses) {
    const data = new Float32Array(corpses.length * 8);

    for (let i = 0; i < corpses.length; i++) {
      const c = corpses[i];
      const offset = i * 8;

      data[offset + 0] = c.position.x;
      data[offset + 1] = c.position.y;
      data[offset + 2] = c.position.z;
      data[offset + 3] = c.size || 1;
      data[offset + 4] = c.energy;
      data[offset + 5] = c.toxicity || 0;
      data[offset + 6] = c.age || 0;
      data[offset + 7] = c.dead ? 1 : 0;
    }

    this.gpu.writeBuffer(this.corpseBuffer, data);
    this.gpu.writeBuffer(this.corpseCountBuffer, new Uint32Array([corpses.length]));
  }

  /**
   * Run one simulation step
   * @param {number} dt - Delta time
   * @param {object} params - Additional parameters
   * @returns {Promise<object>} Simulation results
   */
  async update(dt, params = {}) {
    if (!this.initialized) return null;

    this.time += dt;
    this.frameCount++;

    const device = this.gpu.getDevice();
    const creatureCount = this.creatureBuffer.getCount();

    if (creatureCount === 0) return null;

    // Update uniforms
    this.creatureBuffer.updateUniforms({
      dt,
      time: this.time,
      frameCount: this.frameCount,
      worldWidth: params.worldWidth || 1000,
      worldDepth: params.worldDepth || 1000,
      cellSize: 50
    });

    // Create bind groups
    const buffers = this.creatureBuffer.getBindGroupEntries();

    const gridBindGroup = device.createBindGroup({
      layout: this.gridBindGroupLayout,
      entries: [
        { binding: 0, resource: buffers.uniforms },
        { binding: 1, resource: buffers.readBuffer },
        { binding: 2, resource: { buffer: this.gridBuffer } },
        { binding: 3, resource: { buffer: this.cellCountsBuffer } },
      ]
    });

    const physicsBindGroup = device.createBindGroup({
      layout: this.physicsBindGroupLayout,
      entries: [
        { binding: 0, resource: buffers.uniforms },
        { binding: 1, resource: buffers.readBuffer },
        { binding: 2, resource: buffers.writeBuffer },
      ]
    });

    const behaviorBindGroup = device.createBindGroup({
      layout: this.behaviorBindGroupLayout,
      entries: [
        { binding: 0, resource: buffers.uniforms },
        { binding: 1, resource: buffers.readBuffer },
        { binding: 2, resource: buffers.writeBuffer },
        { binding: 3, resource: { buffer: this.gridBuffer } },
        { binding: 4, resource: { buffer: this.corpseBuffer } },
        { binding: 5, resource: { buffer: this.corpseCountBuffer } },
      ]
    });

    const metabolismBindGroup = device.createBindGroup({
      layout: this.metabolismBindGroupLayout,
      entries: [
        { binding: 0, resource: buffers.uniforms },
        { binding: 1, resource: buffers.readBuffer },
        { binding: 2, resource: buffers.writeBuffer },
      ]
    });

    // Calculate workgroup counts
    const gridWorkgroups = Math.ceil((GRID_SIZE * GRID_SIZE) / 256);
    const creatureWorkgroups = Math.ceil(creatureCount / 256);

    // Create command encoder
    const encoder = this.gpu.createCommandEncoder('simulation frame');

    // === Pass 1: Clear Grid ===
    const clearPass = encoder.beginComputePass({ label: 'clear grid' });
    clearPass.setPipeline(this.clearGridPipeline);
    clearPass.setBindGroup(0, gridBindGroup);
    clearPass.dispatchWorkgroups(gridWorkgroups);
    clearPass.end();

    // === Pass 2: Populate Grid ===
    const populatePass = encoder.beginComputePass({ label: 'populate grid' });
    populatePass.setPipeline(this.populateGridPipeline);
    populatePass.setBindGroup(0, gridBindGroup);
    populatePass.dispatchWorkgroups(creatureWorkgroups);
    populatePass.end();

    // === Pass 3: Behavior (uses grid, writes to writeBuffer) ===
    const behaviorPass = encoder.beginComputePass({ label: 'behavior' });
    behaviorPass.setPipeline(this.behaviorPipeline);
    behaviorPass.setBindGroup(0, behaviorBindGroup);
    behaviorPass.dispatchWorkgroups(creatureWorkgroups);
    behaviorPass.end();

    // Swap buffers (behavior wrote to writeBuffer, now it becomes read)
    this.creatureBuffer.swap();

    // Update bind groups for swapped buffers
    const buffers2 = this.creatureBuffer.getBindGroupEntries();

    const physicsBindGroup2 = device.createBindGroup({
      layout: this.physicsBindGroupLayout,
      entries: [
        { binding: 0, resource: buffers2.uniforms },
        { binding: 1, resource: buffers2.readBuffer },
        { binding: 2, resource: buffers2.writeBuffer },
      ]
    });

    // === Pass 4: Physics (reads behavior output, writes positions) ===
    const physicsPass = encoder.beginComputePass({ label: 'physics' });
    physicsPass.setPipeline(this.physicsPipeline);
    physicsPass.setBindGroup(0, physicsBindGroup2);
    physicsPass.dispatchWorkgroups(creatureWorkgroups);
    physicsPass.end();

    // Swap again
    this.creatureBuffer.swap();

    const buffers3 = this.creatureBuffer.getBindGroupEntries();

    const metabolismBindGroup2 = device.createBindGroup({
      layout: this.metabolismBindGroupLayout,
      entries: [
        { binding: 0, resource: buffers3.uniforms },
        { binding: 1, resource: buffers3.readBuffer },
        { binding: 2, resource: buffers3.writeBuffer },
      ]
    });

    // === Pass 5: Metabolism (energy, aging, death) ===
    const metabolismPass = encoder.beginComputePass({ label: 'metabolism' });
    metabolismPass.setPipeline(this.metabolismPipeline);
    metabolismPass.setBindGroup(0, metabolismBindGroup2);
    metabolismPass.dispatchWorkgroups(creatureWorkgroups);
    metabolismPass.end();

    // Final swap - writeBuffer now has final state
    this.creatureBuffer.swap();

    // Submit commands
    this.gpu.submit([encoder.finish()]);

    // Read back results
    const gpuData = await this.creatureBuffer.readback();

    // Process results on CPU
    return this.processGPUResults(gpuData, creatureCount);
  }

  /**
   * Process GPU readback data
   * @param {Float32Array} data
   * @param {number} count
   * @returns {object}
   */
  processGPUResults(data, count) {
    const creatures = [];
    const deadCreatureIds = [];
    const needsReproduction = [];

    for (let i = 0; i < count; i++) {
      const unpacked = this.creatureBuffer.unpackCreature(data, i);
      const id = this.creatureBuffer.indexToId.get(i);

      if (!id) continue;

      if (unpacked.dead) {
        deadCreatureIds.push(id);
        this.creatureBuffer.removeCreature(id);
        this.cpuCreatures.delete(id);
      } else {
        // Update CPU creature data
        const cpuCreature = this.cpuCreatures.get(id);
        if (cpuCreature) {
          cpuCreature.position = unpacked.position;
          cpuCreature.velocity = unpacked.velocity;
          cpuCreature.energy = unpacked.energy;
          cpuCreature.age = unpacked.age;
          cpuCreature.mature = unpacked.mature;

          creatures.push({
            id,
            position: unpacked.position,
            velocity: unpacked.velocity,
            energy: unpacked.energy,
            age: unpacked.age,
            dead: false,
            mature: unpacked.mature,
            developmentProgress: Math.min(1, unpacked.age / 10)
          });

          if (unpacked.needsReproduction) {
            needsReproduction.push(cpuCreature);
          }
        }
      }
    }

    return {
      creatures,
      deadCreatureIds,
      needsReproduction,
      stats: this.calculateStats(creatures)
    };
  }

  /**
   * Calculate simulation statistics
   */
  calculateStats(creatures) {
    if (creatures.length === 0) {
      return { generation: 0, age: 0, count: 0 };
    }

    let maxGeneration = 0;
    let totalAge = 0;

    for (const c of creatures) {
      const cpuCreature = this.cpuCreatures.get(c.id);
      if (cpuCreature) {
        if (cpuCreature.generation > maxGeneration) {
          maxGeneration = cpuCreature.generation;
        }
        totalAge += c.age;
      }
    }

    return {
      generation: maxGeneration,
      age: totalAge / creatures.length,
      count: creatures.length
    };
  }

  /**
   * Check if GPU simulation is available
   */
  isAvailable() {
    return this.initialized;
  }

  /**
   * Get current creature count
   */
  getCreatureCount() {
    return this.creatureBuffer ? this.creatureBuffer.getCount() : 0;
  }

  /**
   * Destroy GPU resources
   */
  destroy() {
    if (this.creatureBuffer) {
      this.creatureBuffer.destroy();
    }
    if (this.gridBuffer) {
      this.gridBuffer.destroy();
    }
    if (this.cellCountsBuffer) {
      this.cellCountsBuffer.destroy();
    }
    if (this.corpseBuffer) {
      this.corpseBuffer.destroy();
    }
    if (this.corpseCountBuffer) {
      this.corpseCountBuffer.destroy();
    }
    this.gpu.destroy();
    this.initialized = false;
  }
}

// Singleton for worker
let gpuSimulation = null;

export function getGPUSimulation() {
  if (!gpuSimulation) {
    gpuSimulation = new GPUSimulation();
  }
  return gpuSimulation;
}
