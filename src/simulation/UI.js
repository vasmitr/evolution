import { GENE_DEFINITIONS } from './Constants.js';

export class UI {
  constructor() {
    this.createStatsPanel();
    this.createCreaturePanel();
    this.createDietPanel();
    this.createLegendPanel();

    // Smoothing for diet stats (rolling average)
    this.dietHistory = {
      plants: [],
      meat: [],
      filter: []
    };
    this.dietHistoryLength = 180; // Average over ~3 seconds at 60fps for very smooth stats
    this.dietUpdateCounter = 0;
    this.dietUpdateInterval = 30; // Update display every 30 frames (~2 times per second)
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
      <div id="stat-mature">Mature: 0</div>
      <div id="stat-plants">Plants: 0</div>
      <div id="stat-corpses">Corpses: 0</div>
      <div id="stat-generation">Max Generation: 0</div>
      <div id="stat-avg-age">Avg Age: 0s</div>
      <div style="margin-top: 10px;">
        <button id="reset-camera-btn" style="
          background: #444; 
          color: white; 
          border: 1px solid #666; 
          padding: 5px 10px; 
          cursor: pointer; 
          pointer-events: auto;
          border-radius: 3px;
          font-family: monospace;
        ">Reset Camera</button>
      </div>
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
      top: 50px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 15px;
      font-family: monospace;
      font-size: 11px;
      border-radius: 5px;
      min-width: 250px;
      max-height: 60vh;
      overflow-y: auto;
      display: none;
      pointer-events: none;
    `;

    document.body.appendChild(panel);
  }

  createDietPanel() {
    const panel = document.createElement('div');
    panel.id = 'diet-panel';
    panel.style.cssText = `
      position: absolute;
      top: 10px;
      right: 10px;
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
      <div><strong>DIET (Energy/s)</strong></div>
      <div id="diet-stats"></div>
    `;

    document.body.appendChild(panel);
  }

  createLegendPanel() {
    const panel = document.createElement('div');
    panel.id = 'legend-panel';
    panel.style.cssText = `
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 10px 20px;
      font-family: monospace;
      font-size: 12px;
      border-radius: 5px;
      pointer-events: none;
      display: flex;
      gap: 20px;
      align-items: center;
    `;

    panel.innerHTML = `
      <div><strong>CREATURE TYPES</strong></div>
      <div style="display: flex; gap: 15px;">
        <div style="display: flex; align-items: center; gap: 5px;">
          <span style="display: inline-block; width: 12px; height: 12px; background: linear-gradient(90deg, #666 50%, #c22 50%); border-radius: 2px;"></span>
          <span style="color:#f88;">Predator</span>
        </div>
        <div style="display: flex; align-items: center; gap: 5px;">
          <span style="display: inline-block; width: 12px; height: 12px; background: radial-gradient(circle, #94a 30%, #666 30%); border-radius: 2px;"></span>
          <span style="color:#a6f;">Parasite</span>
        </div>
        <div style="display: flex; align-items: center; gap: 5px;">
          <span style="display: inline-block; width: 12px; height: 12px; background: linear-gradient(135deg, #864 25%, #666 25%, #666 50%, #864 50%, #864 75%, #666 75%); border-radius: 2px;"></span>
          <span style="color:#da8;">Scavenger</span>
        </div>
        <div style="display: flex; align-items: center; gap: 5px;">
          <span style="display: inline-block; width: 12px; height: 12px; background: #6a6; border-radius: 2px;"></span>
          <span style="color:#8f8;">Herbivore</span>
        </div>
      </div>
      <div id="population-breakdown" style="display: flex; gap: 10px; font-size: 11px;"></div>
    `;

    document.body.appendChild(panel);
  }

  // Helper to get gene value from creature (works with both old and new formats)
  getGeneValue(creature, key) {
    // New format: dna.genes.key
    if (creature.dna && creature.dna.genes && creature.dna.genes[key] !== undefined) {
      return creature.dna.genes[key];
    }
    // Method access (worker-side)
    if (creature.dna && typeof creature.dna.getGene === 'function') {
      return creature.dna.getGene(key);
    }
    // Direct property on creature (cached values)
    if (creature[key] !== undefined) {
      return creature[key];
    }
    // Old format fallback
    if (creature.dna && creature.dna[key] !== undefined) {
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

    // Count corpses
    const corpseCount = world.corpses ? world.corpses.length : 0;
    document.getElementById('stat-corpses').textContent = `Corpses: ${corpseCount}`;

    // Calculate stats from creatures
    let maxGen = 0;
    let matureCount = 0;
    let totalAge = 0;

    world.creatures.forEach(c => {
      if (c.generation > maxGen) maxGen = c.generation;
      if (c.mature) matureCount++;
      totalAge += c.age || 0;
    });

    document.getElementById('stat-generation').textContent = `Max Generation: ${maxGen}`;
    document.getElementById('stat-mature').textContent = `Mature: ${matureCount}`;

    const avgAge = world.creatures.length > 0 ? totalAge / world.creatures.length : 0;
    document.getElementById('stat-avg-age').textContent = `Avg Age: ${avgAge.toFixed(1)}s`;

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
    
    // Update Diet Stats with smoothing
    if (world.energySources) {
      // Add current frame values to history (always collect data)
      this.dietHistory.plants.push(world.energySources.plants || 0);
      this.dietHistory.meat.push(world.energySources.meat || 0);
      this.dietHistory.filter.push(world.energySources.filter || 0);
      
      // Trim history to maintain window size
      if (this.dietHistory.plants.length > this.dietHistoryLength) {
        this.dietHistory.plants.shift();
        this.dietHistory.meat.shift();
        this.dietHistory.filter.shift();
      }
      
      // Only update display every N frames
      this.dietUpdateCounter++;
      if (this.dietUpdateCounter >= this.dietUpdateInterval) {
        this.dietUpdateCounter = 0;
        
        // Calculate smoothed averages
        const avgPlants = this.dietHistory.plants.reduce((a, b) => a + b, 0) / this.dietHistory.plants.length;
        const avgMeat = this.dietHistory.meat.reduce((a, b) => a + b, 0) / this.dietHistory.meat.length;
        const avgFilter = this.dietHistory.filter.reduce((a, b) => a + b, 0) / this.dietHistory.filter.length;
        
        // Convert to per-second rates
        const plants = avgPlants * 60;
        const meat = avgMeat * 60;
        const filter = avgFilter * 60;
        const total = plants + meat + filter;
        
        let dietHtml = '';
        if (total > 0.1) { // Small threshold to avoid showing "0.0" noise
          const pPct = ((plants / total) * 100).toFixed(1);
          const mPct = ((meat / total) * 100).toFixed(1);
          const fPct = ((filter / total) * 100).toFixed(1);
          
          dietHtml += `<div style="color:#8f8;">Plants: ${plants.toFixed(0)} (${pPct}%)</div>`;
          dietHtml += `<div style="color:#f88;">Meat: ${meat.toFixed(0)} (${mPct}%)</div>`;
          dietHtml += `<div style="color:#88f;">Filter: ${filter.toFixed(0)} (${fPct}%)</div>`;
        } else {
          dietHtml = '<div style="color:#888;">No activity</div>';
        }
        document.getElementById('diet-stats').innerHTML = dietHtml;
        
        // Calculate population breakdown by type (update with diet stats)
        let predators = 0;
        let parasites = 0;
        let scavengers = 0;
        let herbivores = 0;

        world.creatures.forEach(c => {
          // Categorize by dominant trait (threshold > 0.4 for specialization)
          const isPredator = this.getGeneValue(c, 'predatory') > 0.4;
          const isParasite = this.getGeneValue(c, 'parasitic') > 0.4;
          const isScavenger = this.getGeneValue(c, 'scavenging') > 0.4;
          
          // A creature can have multiple traits, count primary role
          if (isPredator) {
            predators++;
          } else if (isParasite) {
            parasites++;
          } else if (isScavenger) {
            scavengers++;
          } else {
            herbivores++;
          }
        });

        // Display population breakdown (horizontal format for legend)
        let popHtml = '';
        if (world.creatures.length > 0) {
          popHtml += `<span style="color:#f88;">${predators}</span>`;
          popHtml += `<span style="color:#a6f;">${parasites}</span>`;
          popHtml += `<span style="color:#da8;">${scavengers}</span>`;
          popHtml += `<span style="color:#8f8;">${herbivores}</span>`;
        }
        document.getElementById('population-breakdown').innerHTML = popHtml;
      }
    }
  }

  showCreature(creature) {
    const panel = document.getElementById('creature-panel');
    panel.style.display = 'block';

    const agePercent = creature.maxAge ? ((creature.age / creature.maxAge) * 100).toFixed(0) : 0;
    const maturityStatus = creature.mature ? '✓ Mature' : `Growing (${((creature.developmentProgress || 0) * 100).toFixed(0)}%)`;

    let html = `
      <div><strong>SELECTED CREATURE</strong></div>
      <div>Generation: ${creature.generation || 0}</div>
      <div>Age: ${Math.floor(creature.age)}s / ${Math.floor(creature.maxAge || 0)}s (${agePercent}%)</div>
      <div>Energy: ${Math.floor(creature.energy)}</div>
      <div>Status: ${maturityStatus}</div>
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
