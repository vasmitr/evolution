import * as THREE from 'three';
import { WORLD_SIZE } from './Constants.js';

export class StreamParticles {
  constructor(count = 1000) {
    this.count = count;
    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(count * 3);
    this.speeds = new Float32Array(count);
    
    for (let i = 0; i < count; i++) {
      this.resetParticle(i);
    }
    
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    
    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 2,
      transparent: true,
      opacity: 0.6
    });
    
    this.mesh = new THREE.Points(this.geometry, material);
  }
  
  resetParticle(i) {
    // Spawn randomly in water volume
    this.positions[i * 3] = (Math.random() - 0.5) * WORLD_SIZE.width;
    this.positions[i * 3 + 1] = (Math.random() * -20) - 2; // Below surface
    this.positions[i * 3 + 2] = (Math.random() - 0.5) * WORLD_SIZE.depth;
    this.speeds[i] = 0.5 + Math.random() * 0.5;
  }
  
  update(dt, currentVector) {
    const positions = this.geometry.attributes.position.array;
    
    for (let i = 0; i < this.count; i++) {
      positions[i * 3] += currentVector.x * this.speeds[i] * 100 * dt; // Scale up for visibility
      positions[i * 3 + 1] += currentVector.y * this.speeds[i] * 100 * dt;
      positions[i * 3 + 2] += currentVector.z * this.speeds[i] * 100 * dt;
      
      // Wrap around world
      if (Math.abs(positions[i * 3]) > WORLD_SIZE.width / 2 ||
          Math.abs(positions[i * 3 + 2]) > WORLD_SIZE.depth / 2) {
        this.resetParticle(i);
      }
    }
    
    this.geometry.attributes.position.needsUpdate = true;
  }
}
