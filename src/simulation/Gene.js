export class Gene {
  constructor(name, value = Math.random(), variativeness = Math.random()) {
    this.name = name;
    this.value = Math.max(0, Math.min(1, value));
    // Variativeness controls how much this gene affects phenotypic variation
    // High variativeness = more extreme/varied physical expressions
    // Low variativeness = more conservative/standard expressions
    this.variativeness = Math.max(0, Math.min(1, variativeness));
  }

  mutate() {
    // Gaussian mutation for value
    // Box-Muller transform for normal distribution
    const u = 1 - Math.random(); // Converting [0,1) to (0,1]
    const v = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    
    // Standard deviation can be small, e.g., 0.1
    const mutationAmount = z * 0.1;
    
    this.value = Math.max(0, Math.min(1, this.value + mutationAmount));
    
    // Also mutate variativeness (with smaller changes)
    const u2 = 1 - Math.random();
    const v2 = Math.random();
    const z2 = Math.sqrt(-2.0 * Math.log(u2)) * Math.cos(2.0 * Math.PI * v2);
    const variativenessMutation = z2 * 0.08; // Slightly smaller mutation rate
    
    this.variativeness = Math.max(0, Math.min(1, this.variativeness + variativenessMutation));
  }

  clone() {
    return new Gene(this.name, this.value, this.variativeness);
  }
}
