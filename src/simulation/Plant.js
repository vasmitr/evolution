import * as THREE from 'three';

export class Plant {
  constructor(position) {
    this.position = position;
    this.energy = 30 + Math.random() * 20; // Increased energy value
    
    const geometry = new THREE.TetrahedronGeometry(0.5);
    const material = new THREE.MeshStandardMaterial({ 
      color: 0x00ff00,
      emissive: 0x004400
    });
    
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(this.position);
    
    // Random rotation
    this.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    
    this.age = 0;
    this.maxAge = 20 + Math.random() * 20; // Seconds
    this.dead = false;
  }
  
  update(dt) {
    this.age += dt;
    if (this.age > this.maxAge) {
      this.dead = true;
    }

    // Pulse effect
    const scale = 1 + Math.sin(this.age * 2) * 0.1;
    this.mesh.scale.setScalar(scale);

    // Drift is handled in World.js with terrain-aware currents
  }
}
