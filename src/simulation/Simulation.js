import { World } from './World.js';

export class Simulation {
  constructor() {
    this.container = document.getElementById('app');
    this.world = new World(this.container);
    this.lastTime = 0;
    this.running = true;
    
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  loop(timestamp) {
    if (!this.running) return;
    
    const dt = (timestamp - this.lastTime) / 1000;
    this.lastTime = timestamp;
    
    // Cap dt to avoid huge jumps
    const safeDt = Math.min(dt, 0.1);
    
    this.world.update(safeDt);
    
    requestAnimationFrame(this.loop);
  }
}
