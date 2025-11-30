/**
 * GPU Creature Simulator
 * Handles GPU-accelerated creature updates while maintaining compatibility
 * with the existing CPU simulation architecture
 */

import { getGPUContext } from './GPUContext.js';
import { CreatureBuffer, CREATURE_FLOATS, CREATURE_LAYOUT, CREATURE_FLAGS } from './CreatureBuffer.js';
import { PlantBuffer } from './PlantBuffer.js';
import { SPATIAL_GRID_SHADER, PHYSICS_SHADER, BEHAVIOR_SHADER, METABOLISM_SHADER } from './shaders.js';

const GRID_SIZE = 20;
const MAX_CREATURES_PER_CELL = 64;
const CELL_STRIDE = 65; // 1 count + 64 creature indices
const MAX_GPU_CREATURES = 100000;
const MAX_GPU_PLANTS = 100000;
const MAX_CORPSES = 10000;

export class GPUCreatureSimulator {
  constructor() {
    this.gpu = null;
    this.initialized = false;
    this.creatureBuffer = null;

    // Pipelines
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

    // Buffers
    this.gridBuffer = null;
    this.cellCountsBuffer = null;
    this.corpseBuffer = null;
    this.corpseCountBuffer = null;
    this.plantBuffer = null;

    // State
    this.frameCount = 0;
    this.time = 0;
  }

  /**
   * Initialize GPU resources
   * @returns {Promise<boolean>}
   */
  async initialize() {
    if (this.initialized) return true;

    this.gpu = getGPUContext();
    const ready = await this.gpu.initialize();

    if (!ready) {
      console.log('WebGPU not available, creature simulation will use CPU');
      return false;
    }

    try {
      await this.createBuffers();
      await this.createPipelines();
      this.initialized = true;
      console.log('GPU Creature Simulator initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize GPU Creature Simulator:', error);
      return false;
    }
  }

  async createBuffers() {
    this.creatureBuffer = new CreatureBuffer(this.gpu, MAX_GPU_CREATURES);

    // Grid buffer: array of u32, CELL_STRIDE per cell (count + indices)
    const gridBufferSize = GRID_SIZE * GRID_SIZE * CELL_STRIDE * 4; // 4 bytes per u32

    this.gridBuffer = this.gpu.createBuffer(
      gridBufferSize,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      'spatial grid'
    );

    this.cellCountsBuffer = this.gpu.createBuffer(
      GRID_SIZE * GRID_SIZE * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      'cell counts'
    );

    this.corpseBuffer = this.gpu.createBuffer(
      MAX_CORPSES * 32,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      'corpses'
    );

    this.corpseCountBuffer = this.gpu.createBuffer(
      4,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      'corpse count'
    );

    // Plant buffer for foraging behavior
    this.plantBuffer = new PlantBuffer(this.gpu, MAX_GPU_PLANTS);
  }

  async createPipelines() {
    const device = this.gpu.getDevice();

    // Grid pipelines
    const gridModule = await this.gpu.createShaderModule(SPATIAL_GRID_SHADER, 'spatial grid');
    this.gridBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ]
    });

    const gridLayout = device.createPipelineLayout({ bindGroupLayouts: [this.gridBindGroupLayout] });
    this.clearGridPipeline = device.createComputePipeline({
      layout: gridLayout,
      compute: { module: gridModule, entryPoint: 'clear_grid' }
    });
    this.populateGridPipeline = device.createComputePipeline({
      layout: gridLayout,
      compute: { module: gridModule, entryPoint: 'populate_grid' }
    });

    // Physics pipeline
    const physicsModule = await this.gpu.createShaderModule(PHYSICS_SHADER, 'physics');
    this.physicsBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ]
    });
    this.physicsPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.physicsBindGroupLayout] }),
      compute: { module: physicsModule, entryPoint: 'update_physics' }
    });

    // Behavior pipeline
    const behaviorModule = await this.gpu.createShaderModule(BEHAVIOR_SHADER, 'behavior');
    this.behaviorBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // plants
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // plant count
      ]
    });
    this.behaviorPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.behaviorBindGroupLayout] }),
      compute: { module: behaviorModule, entryPoint: 'update_behavior' }
    });

    // Metabolism pipeline
    const metabolismModule = await this.gpu.createShaderModule(METABOLISM_SHADER, 'metabolism');
    this.metabolismBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ]
    });
    this.metabolismPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.metabolismBindGroupLayout] }),
      compute: { module: metabolismModule, entryPoint: 'update_metabolism' }
    });
  }

  /**
   * Sync creatures from CPU to GPU
   * @param {Array} creatures - Array of WorkerCreature objects
   */
  syncCreaturesToGPU(creatures) {
    // Clear existing mappings
    this.creatureBuffer.idToIndex.clear();
    this.creatureBuffer.indexToId.clear();
    this.creatureBuffer.freeIndices = [];
    this.creatureBuffer.creatureCount = 0;

    for (const creature of creatures) {
      this.creatureBuffer.addCreature(creature);
    }

    this.creatureBuffer.uploadAll();
  }

  /**
   * Sync corpses to GPU for scavenging behavior
   * @param {Array} corpses
   */
  syncCorpsesToGPU(corpses) {
    const data = new Float32Array(Math.min(corpses.length, MAX_CORPSES) * 8);

    for (let i = 0; i < Math.min(corpses.length, MAX_CORPSES); i++) {
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
   * Sync plants to GPU for foraging behavior
   * @param {Array} plants - Array of plant objects
   */
  syncPlantsToGPU(plants) {
    this.plantBuffer.syncFromCPU(plants);
  }

  /**
   * Run GPU simulation step
   * @param {number} dt
   * @param {object} params
   * @returns {Promise<Float32Array>} Updated creature data
   */
  async runSimulationStep(dt, params = {}) {
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

    const buffers = this.creatureBuffer.getBindGroupEntries();
    const gridWorkgroups = Math.ceil((GRID_SIZE * GRID_SIZE) / 256);
    const creatureWorkgroups = Math.ceil(creatureCount / 256);

    // Create bind groups
    const gridBindGroup = device.createBindGroup({
      layout: this.gridBindGroupLayout,
      entries: [
        { binding: 0, resource: buffers.uniforms },
        { binding: 1, resource: buffers.readBuffer },
        { binding: 2, resource: { buffer: this.gridBuffer } },
        { binding: 3, resource: { buffer: this.cellCountsBuffer } },
      ]
    });

    const encoder = this.gpu.createCommandEncoder('simulation');

    // Pass 1: Clear grid
    const clearPass = encoder.beginComputePass();
    clearPass.setPipeline(this.clearGridPipeline);
    clearPass.setBindGroup(0, gridBindGroup);
    clearPass.dispatchWorkgroups(gridWorkgroups);
    clearPass.end();

    // Pass 2: Populate grid
    const populatePass = encoder.beginComputePass();
    populatePass.setPipeline(this.populateGridPipeline);
    populatePass.setBindGroup(0, gridBindGroup);
    populatePass.dispatchWorkgroups(creatureWorkgroups);
    populatePass.end();

    // Pass 3: Behavior
    const plantBuffers = this.plantBuffer.getBindGroupEntries();
    const behaviorBindGroup = device.createBindGroup({
      layout: this.behaviorBindGroupLayout,
      entries: [
        { binding: 0, resource: buffers.uniforms },
        { binding: 1, resource: buffers.readBuffer },
        { binding: 2, resource: buffers.writeBuffer },
        { binding: 3, resource: { buffer: this.gridBuffer } },
        { binding: 4, resource: { buffer: this.corpseBuffer } },
        { binding: 5, resource: { buffer: this.corpseCountBuffer } },
        { binding: 6, resource: plantBuffers.plants },
        { binding: 7, resource: plantBuffers.plantCount },
      ]
    });

    const behaviorPass = encoder.beginComputePass();
    behaviorPass.setPipeline(this.behaviorPipeline);
    behaviorPass.setBindGroup(0, behaviorBindGroup);
    behaviorPass.dispatchWorkgroups(creatureWorkgroups);
    behaviorPass.end();

    this.creatureBuffer.swap();

    // Pass 4: Physics
    const physicsBindGroup = device.createBindGroup({
      layout: this.physicsBindGroupLayout,
      entries: [
        { binding: 0, resource: this.creatureBuffer.getBindGroupEntries().uniforms },
        { binding: 1, resource: this.creatureBuffer.getBindGroupEntries().readBuffer },
        { binding: 2, resource: this.creatureBuffer.getBindGroupEntries().writeBuffer },
      ]
    });

    const physicsPass = encoder.beginComputePass();
    physicsPass.setPipeline(this.physicsPipeline);
    physicsPass.setBindGroup(0, physicsBindGroup);
    physicsPass.dispatchWorkgroups(creatureWorkgroups);
    physicsPass.end();

    this.creatureBuffer.swap();

    // Pass 5: Metabolism
    const metabolismBindGroup = device.createBindGroup({
      layout: this.metabolismBindGroupLayout,
      entries: [
        { binding: 0, resource: this.creatureBuffer.getBindGroupEntries().uniforms },
        { binding: 1, resource: this.creatureBuffer.getBindGroupEntries().readBuffer },
        { binding: 2, resource: this.creatureBuffer.getBindGroupEntries().writeBuffer },
      ]
    });

    const metabolismPass = encoder.beginComputePass();
    metabolismPass.setPipeline(this.metabolismPipeline);
    metabolismPass.setBindGroup(0, metabolismBindGroup);
    metabolismPass.dispatchWorkgroups(creatureWorkgroups);
    metabolismPass.end();

    this.creatureBuffer.swap();

    // Submit and wait
    this.gpu.submit([encoder.finish()]);

    // Read back results
    return await this.creatureBuffer.readback();
  }

  /**
   * Apply GPU results back to CPU creatures
   * @param {Float32Array} gpuData
   * @param {Array} creatures - CPU creature array (will be modified)
   * @returns {object} Results: { deadCreatures, reproductionCandidates }
   */
  applyResultsToCreatures(gpuData, creatures) {
    const deadCreatures = [];
    const reproductionCandidates = [];

    for (let i = 0; i < creatures.length; i++) {
      const creature = creatures[i];
      const index = this.creatureBuffer.idToIndex.get(creature.id);

      if (index === undefined) continue;

      const unpacked = this.creatureBuffer.unpackCreature(gpuData, index);

      // Apply GPU results to CPU creature
      creature.position.x = unpacked.position.x;
      creature.position.y = unpacked.position.y;
      creature.position.z = unpacked.position.z;
      creature.velocity.x = unpacked.velocity.x;
      creature.velocity.y = unpacked.velocity.y;
      creature.velocity.z = unpacked.velocity.z;
      creature.energy = unpacked.energy;
      creature.age = unpacked.age;
      creature.mature = unpacked.mature;
      creature.dead = unpacked.dead;

      if (unpacked.dead) {
        deadCreatures.push(creature);
      } else if (unpacked.needsReproduction) {
        reproductionCandidates.push(creature);
      }
    }

    return { deadCreatures, reproductionCandidates };
  }

  /**
   * Check if GPU simulation is available
   */
  isAvailable() {
    return this.initialized;
  }

  destroy() {
    if (this.creatureBuffer) this.creatureBuffer.destroy();
    if (this.plantBuffer) this.plantBuffer.destroy();
    if (this.gridBuffer) this.gridBuffer.destroy();
    if (this.cellCountsBuffer) this.cellCountsBuffer.destroy();
    if (this.corpseBuffer) this.corpseBuffer.destroy();
    if (this.corpseCountBuffer) this.corpseCountBuffer.destroy();
    if (this.gpu) this.gpu.destroy();
    this.initialized = false;
  }
}

// Singleton
let gpuSimulator = null;

export async function getGPUCreatureSimulator() {
  if (!gpuSimulator) {
    gpuSimulator = new GPUCreatureSimulator();
    await gpuSimulator.initialize();
  }
  return gpuSimulator;
}
