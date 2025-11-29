import { GENE_DEFINITIONS } from './Constants.js';

export class UI {
  constructor() {
    this.createStatsPanel();
    this.createCreaturePanel();
  }

  createStatsPanel() {
    const panel = document.createElement('div');
    panel.id = 'stats-panel';
    panel.style.cssText = `
      position: absolute;
      top: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 15px;
      font-family: monospace;
      font-size: 12px;
      border-radius: 5px;
      min-width: 200px;
      pointer-events: none;
    `;
    
    panel.innerHTML = `
      <div><strong>SIMULATION STATS</strong></div>
      <div id="stat-time">Time: 0s</div>
      <div id="stat-season">Season: Spring</div>
      <div id="stat-creatures">Creatures: 0</div>
      <div id="stat-plants">Plants: 0</div>
      <div id="stat-generation">Max Generation: 0</div>
      <div style="margin-top: 10px;"><strong>AVERAGE GENES</strong></div>
      <div id="avg-genes"></div>
    `;
    
    document.body.appendChild(panel);
  }

  createCreaturePanel() {
    const panel = document.createElement('div');
    panel.id = 'creature-panel';
    panel.style.cssText = `
      position: absolute;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 15px;
      font-family: monospace;
      font-size: 11px;
      border-radius: 5px;
      min-width: 250px;
      max-height: 80vh;
      overflow-y: auto;
      display: none;
      pointer-events: none;
    `;
    
    document.body.appendChild(panel);
  }

  // Helper to get gene value from creature (works with both old and new formats)
  getGeneValue(creature, key) {
    if (creature.dna && typeof creature.dna.getGene === 'function') {
      return creature.dna.getGene(key);
    } else if (creature.dna && creature.dna[key] !== undefined) {
      return creature.dna[key];
    }
    return 0;
  }

  updateStats(world) {
    const time = world.time || 0;
    const season = world.season || 0;
    const seasonValue = (season + 1) / 2;
    let seasonName = 'Spring';
    if (seasonValue < 0.25) seasonName = 'Winter';
    else if (seasonValue < 0.5) seasonName = 'Spring';
    else if (seasonValue < 0.75) seasonName = 'Summer';
    else seasonName = 'Autumn';

    document.getElementById('stat-time').textContent = `Time: ${Math.floor(time)}s`;
    document.getElementById('stat-season').textContent = `Season: ${seasonName}`;
    document.getElementById('stat-creatures').textContent = `Creatures: ${world.creatures.length}`;
    document.getElementById('stat-plants').textContent = `Plants: ${world.plants.length}`;

    // Calculate max generation
    let maxGen = 0;
    world.creatures.forEach(c => {
      if (c.generation > maxGen) maxGen = c.generation;
    });
    document.getElementById('stat-generation').textContent = `Max Generation: ${maxGen}`;

    // Calculate average genes
    if (world.creatures.length > 0) {
      const avgGenes = {};
      Object.keys(GENE_DEFINITIONS).forEach(key => {
        avgGenes[key] = 0;
      });

      world.creatures.forEach(c => {
        Object.keys(GENE_DEFINITIONS).forEach(key => {
          avgGenes[key] += this.getGeneValue(c, key);
        });
      });

      Object.keys(avgGenes).forEach(key => {
        avgGenes[key] /= world.creatures.length;
      });

      let html = '';
      Object.keys(avgGenes).forEach(key => {
        const val = avgGenes[key].toFixed(2);
        const bar = '█'.repeat(Math.floor(val * 10));
        html += `<div style="margin: 2px 0;">${GENE_DEFINITIONS[key].name}: ${bar} ${val}</div>`;
      });

      document.getElementById('avg-genes').innerHTML = html;
    }
  }

  showCreature(creature) {
    const panel = document.getElementById('creature-panel');
    panel.style.display = 'block';

    let html = `
      <div><strong>SELECTED CREATURE</strong></div>
      <div>Generation: ${creature.generation || 0}</div>
      <div>Age: ${Math.floor(creature.age)}s</div>
      <div>Energy: ${Math.floor(creature.energy)}</div>
      <div style="margin-top: 10px;"><strong>GENES</strong></div>
    `;

    Object.keys(GENE_DEFINITIONS).forEach(key => {
      const val = this.getGeneValue(creature, key).toFixed(2);
      const bar = '█'.repeat(Math.floor(val * 10));
      html += `<div style="margin: 2px 0; font-size: 10px;">${GENE_DEFINITIONS[key].name}: ${bar} ${val}</div>`;
    });

    panel.innerHTML = html;
  }

  hideCreature() {
    document.getElementById('creature-panel').style.display = 'none';
  }
}
