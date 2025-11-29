export class Gene {
  constructor(name, value = Math.random()) {
    this.name = name;
    this.value = Math.max(0, Math.min(1, value));
  }

  mutate() {
    // Gaussian mutation
    // Box-Muller transform for normal distribution
    const u = 1 - Math.random(); // Converting [0,1) to (0,1]
    const v = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    
    // Standard deviation can be small, e.g., 0.1
    const mutationAmount = z * 0.1;
    
    this.value = Math.max(0, Math.min(1, this.value + mutationAmount));
  }

  clone() {
    return new Gene(this.name, this.value);
  }
}
