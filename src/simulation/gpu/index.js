/**
 * GPU Simulation Module - Entry point for worker
 */

export { GPUContext, getGPUContext } from './GPUContext.js';
export { GPUSimulation, getGPUSimulation } from './GPUSimulation.js';
export { GPUCreatureSimulator, getGPUCreatureSimulator } from './GPUCreatureSimulator.js';
export { CreatureBuffer, CREATURE_FLOATS, CREATURE_LAYOUT, CREATURE_FLAGS } from './CreatureBuffer.js';

/**
 * Check if WebGPU is available in this context
 * @returns {boolean}
 */
export function isWebGPUAvailable() {
  return typeof navigator !== 'undefined' && navigator.gpu !== undefined;
}

/**
 * Initialize GPU creature simulator if available
 * @returns {Promise<GPUCreatureSimulator|null>}
 */
export async function initGPUCreatureSimulator() {
  if (!isWebGPUAvailable()) {
    console.log('WebGPU not available in this context');
    return null;
  }

  try {
    const { getGPUCreatureSimulator } = await import('./GPUCreatureSimulator.js');
    const sim = await getGPUCreatureSimulator();

    if (!sim.isAvailable()) {
      console.log('GPU Creature Simulator initialization failed');
      return null;
    }

    return sim;
  } catch (error) {
    console.error('Error initializing GPU Creature Simulator:', error);
    return null;
  }
}
