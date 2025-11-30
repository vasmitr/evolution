/**
 * WebGPU Context Manager for Worker Thread
 * Handles GPU initialization, device management, and capability detection
 */

export class GPUContext {
  constructor() {
    this.adapter = null;
    this.device = null;
    this.initialized = false;
    this.capabilities = null;
  }

  /**
   * Initialize WebGPU in the worker thread
   * @returns {Promise<boolean>} true if initialization succeeded
   */
  async initialize() {
    if (this.initialized) return true;

    // Check if WebGPU is available in this worker
    if (!navigator.gpu) {
      console.warn('WebGPU not available in this environment');
      return false;
    }

    try {
      // Request adapter with high-performance preference
      this.adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance'
      });

      if (!this.adapter) {
        console.warn('No WebGPU adapter found');
        return false;
      }

      // Get adapter capabilities
      this.capabilities = {
        maxBufferSize: this.adapter.limits.maxBufferSize,
        maxComputeWorkgroupsPerDimension: this.adapter.limits.maxComputeWorkgroupsPerDimension,
        maxComputeInvocationsPerWorkgroup: this.adapter.limits.maxComputeInvocationsPerWorkgroup,
        maxComputeWorkgroupSizeX: this.adapter.limits.maxComputeWorkgroupSizeX,
        maxStorageBufferBindingSize: this.adapter.limits.maxStorageBufferBindingSize,
      };

      // Request device with required features
      this.device = await this.adapter.requestDevice({
        requiredLimits: {
          maxStorageBufferBindingSize: Math.min(
            256 * 1024 * 1024, // 256MB
            this.adapter.limits.maxStorageBufferBindingSize
          ),
          maxBufferSize: Math.min(
            256 * 1024 * 1024,
            this.adapter.limits.maxBufferSize
          ),
        }
      });

      // Handle device loss
      this.device.lost.then((info) => {
        console.error('WebGPU device lost:', info.message);
        this.initialized = false;
        this.device = null;
      });

      // Error handling
      this.device.onuncapturederror = (event) => {
        console.error('WebGPU uncaptured error:', event.error);
      };

      this.initialized = true;
      console.log('WebGPU initialized successfully in worker');
      console.log('Capabilities:', this.capabilities);

      return true;
    } catch (error) {
      console.error('Failed to initialize WebGPU:', error);
      return false;
    }
  }

  /**
   * Create a compute shader module from WGSL source
   * @param {string} code - WGSL shader source
   * @param {string} label - Optional label for debugging
   * @returns {Promise<GPUShaderModule>}
   */
  async createShaderModule(code, label = 'compute shader') {
    if (!this.device) throw new Error('GPU not initialized');

    const module = this.device.createShaderModule({
      label,
      code
    });

    // Check for compilation errors
    const compilationInfo = await module.getCompilationInfo();
    for (const message of compilationInfo.messages) {
      const type = message.type;
      const text = message.message;
      const line = message.lineNum;
      const col = message.linePos;

      if (type === 'error') {
        console.error(`Shader "${label}" compilation error at line ${line}:${col}: ${text}`);
        throw new Error(`Shader compilation failed: ${text}`);
      } else if (type === 'warning') {
        console.warn(`Shader "${label}" warning at line ${line}:${col}: ${text}`);
      }
    }

    return module;
  }

  /**
   * Create a compute pipeline
   * @param {GPUShaderModule} shaderModule
   * @param {string} entryPoint
   * @param {GPUPipelineLayout|'auto'} layout
   * @param {string} label
   * @returns {GPUComputePipeline}
   */
  createComputePipeline(shaderModule, entryPoint, layout = 'auto', label = 'compute pipeline') {
    if (!this.device) throw new Error('GPU not initialized');

    return this.device.createComputePipeline({
      label,
      layout,
      compute: {
        module: shaderModule,
        entryPoint
      }
    });
  }

  /**
   * Create a GPU buffer
   * @param {number} size - Size in bytes
   * @param {GPUBufferUsageFlags} usage - Buffer usage flags
   * @param {string} label - Optional label
   * @returns {GPUBuffer}
   */
  createBuffer(size, usage, label = 'buffer') {
    if (!this.device) throw new Error('GPU not initialized');

    return this.device.createBuffer({
      label,
      size,
      usage
    });
  }

  /**
   * Create a bind group layout
   * @param {GPUBindGroupLayoutEntry[]} entries
   * @param {string} label
   * @returns {GPUBindGroupLayout}
   */
  createBindGroupLayout(entries, label = 'bind group layout') {
    if (!this.device) throw new Error('GPU not initialized');

    return this.device.createBindGroupLayout({
      label,
      entries
    });
  }

  /**
   * Create a bind group
   * @param {GPUBindGroupLayout} layout
   * @param {GPUBindGroupEntry[]} entries
   * @param {string} label
   * @returns {GPUBindGroup}
   */
  createBindGroup(layout, entries, label = 'bind group') {
    if (!this.device) throw new Error('GPU not initialized');

    return this.device.createBindGroup({
      label,
      layout,
      entries
    });
  }

  /**
   * Create a command encoder
   * @param {string} label
   * @returns {GPUCommandEncoder}
   */
  createCommandEncoder(label = 'command encoder') {
    if (!this.device) throw new Error('GPU not initialized');

    return this.device.createCommandEncoder({ label });
  }

  /**
   * Submit command buffers to the GPU queue
   * @param {GPUCommandBuffer[]} commandBuffers
   */
  submit(commandBuffers) {
    if (!this.device) throw new Error('GPU not initialized');
    this.device.queue.submit(commandBuffers);
  }

  /**
   * Write data to a buffer
   * @param {GPUBuffer} buffer
   * @param {ArrayBuffer|TypedArray} data
   * @param {number} offset
   */
  writeBuffer(buffer, data, offset = 0) {
    if (!this.device) throw new Error('GPU not initialized');
    this.device.queue.writeBuffer(buffer, offset, data);
  }

  /**
   * Read data from a GPU buffer (async)
   * @param {GPUBuffer} buffer - Source buffer (must have COPY_SRC usage)
   * @param {number} size - Number of bytes to read
   * @returns {Promise<ArrayBuffer>}
   */
  async readBuffer(buffer, size) {
    if (!this.device) throw new Error('GPU not initialized');

    // Create staging buffer for readback
    const stagingBuffer = this.createBuffer(
      size,
      GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      'staging buffer'
    );

    // Copy from GPU buffer to staging
    const encoder = this.createCommandEncoder('readback');
    encoder.copyBufferToBuffer(buffer, 0, stagingBuffer, 0, size);
    this.submit([encoder.finish()]);

    // Map and read
    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const data = stagingBuffer.getMappedRange().slice(0); // Copy the data
    stagingBuffer.unmap();
    stagingBuffer.destroy();

    return data;
  }

  /**
   * Get the GPU device
   * @returns {GPUDevice}
   */
  getDevice() {
    return this.device;
  }

  /**
   * Check if GPU is ready
   * @returns {boolean}
   */
  isReady() {
    return this.initialized && this.device !== null;
  }

  /**
   * Destroy GPU resources
   */
  destroy() {
    if (this.device) {
      this.device.destroy();
      this.device = null;
    }
    this.initialized = false;
  }
}

// Singleton instance for worker
let gpuContext = null;

export function getGPUContext() {
  if (!gpuContext) {
    gpuContext = new GPUContext();
  }
  return gpuContext;
}
