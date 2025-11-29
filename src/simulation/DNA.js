import { Gene } from './Gene.js';
import { GENE_DEFINITIONS, SIMULATION_CONFIG } from './Constants.js';

export class DNA {
  constructor(genes = {}) {
    this.genes = {};
    
    // Initialize genes if not provided
    Object.keys(GENE_DEFINITIONS).forEach(key => {
      if (genes[key]) {
        this.genes[key] = genes[key];
      } else {
        this.genes[key] = new Gene(key);
      }
    });
  }

  mutate() {
    if (Math.random() < SIMULATION_CONFIG.mutationRate) {
      const geneKeys = Object.keys(this.genes);
      // Select random subset of genes to mutate
      const numMutations = Math.floor(Math.random() * SIMULATION_CONFIG.mutationAmount) + 1;
      
      for (let i = 0; i < numMutations; i++) {
        const randomKey = geneKeys[Math.floor(Math.random() * geneKeys.length)];
        this.genes[randomKey].mutate();
      }
      return true; // Mutation occurred
    }
    return false;
  }

  clone() {
    const newGenes = {};
    Object.keys(this.genes).forEach(key => {
      newGenes[key] = this.genes[key].clone();
    });
    return new DNA(newGenes);
  }

  getGene(key) {
    return this.genes[key] ? this.genes[key].value : 0;
  }
}
