import { GENE_DEFINITIONS } from './Constants.js';

export class UI {
  constructor() {
    this.createStatsPanel();
    this.createCreaturePanel();
    this.createDietPanel();
    this.createLegendPanel();
    this.createGlossaryPanel();

    // Smoothing for diet stats (rolling average)
    this.dietHistory = {
      plants: [],
      meat: [],
      filter: []
    };
    this.dietHistoryLength = 180; // Average over ~3 seconds at 60fps for very smooth stats
    this.dietUpdateCounter = 0;
    this.dietUpdateInterval = 30; // Update display every 30 frames (~2 times per second)

    // Throttle stats updates (heavy calculations)
    this.statsUpdateCounter = 0;
    this.statsUpdateInterval = 60; // Update stats every 60 frames (~1 time per second at 60fps)

    // Glossary state
    this.glossaryOpen = false;
    this.speciesData = new Map(); // Track species by signature
    this.speciesHistory = new Map(); // Track historical population for status
    this.svgCache = new Map(); // Cache SVG strings by species signature
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
      <button id="glossary-btn" style="
        background: #555;
        color: white;
        border: 1px solid #777;
        padding: 4px 12px;
        cursor: pointer;
        pointer-events: auto;
        border-radius: 3px;
        font-family: monospace;
        font-size: 11px;
        margin-left: 10px;
      ">Glossary</button>
    `;

    document.body.appendChild(panel);

    // Add glossary button click handler
    document.getElementById('glossary-btn').addEventListener('click', () => {
      this.toggleGlossary();
    });
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
    // Always keep a reference to world data for glossary (just a pointer, very cheap)
    this.lastWorldData = world;

    // Only do heavy glossary calculations when it's open
    if (this.glossaryOpen) {
      this.glossaryUpdateCounter = (this.glossaryUpdateCounter || 0) + 1;
      if (this.glossaryUpdateCounter >= 120) { // ~2 seconds at 60fps
        this.glossaryUpdateCounter = 0;
        this.updateGlossary();
      }
    }

    // Collect diet history every frame (lightweight)
    if (world.energySources) {
      this.dietHistory.plants.push(world.energySources.plants || 0);
      this.dietHistory.meat.push(world.energySources.meat || 0);
      this.dietHistory.filter.push(world.energySources.filter || 0);

      if (this.dietHistory.plants.length > this.dietHistoryLength) {
        this.dietHistory.plants.shift();
        this.dietHistory.meat.shift();
        this.dietHistory.filter.shift();
      }
    }

    // Throttle all heavy calculations and DOM updates
    this.statsUpdateCounter++;
    if (this.statsUpdateCounter < this.statsUpdateInterval) {
      return;
    }
    this.statsUpdateCounter = 0;

    // === All updates below run every statsUpdateInterval frames ===

    // Use pre-calculated stats from worker (no main thread iteration!)
    const stats = world.stats || {};
    const time = stats.time || 0;

    // Season calculation (simple, keep on main thread)
    const season = world.season || 0;
    const seasonValue = (season + 1) / 2;
    let seasonName = 'Spring';
    if (seasonValue < 0.25) seasonName = 'Winter';
    else if (seasonValue < 0.5) seasonName = 'Spring';
    else if (seasonValue < 0.75) seasonName = 'Summer';
    else seasonName = 'Autumn';

    document.getElementById('stat-time').textContent = `Time: ${Math.floor(time)}s`;
    document.getElementById('stat-season').textContent = `Season: ${seasonName}`;
    document.getElementById('stat-creatures').textContent = `Creatures: ${stats.creatureCount || 0}`;
    document.getElementById('stat-plants').textContent = `Plants: ${stats.plantCount || 0}`;
    document.getElementById('stat-corpses').textContent = `Corpses: ${stats.corpseCount || 0}`;
    document.getElementById('stat-generation').textContent = `Max Generation: ${stats.maxGeneration || 0}`;
    document.getElementById('stat-mature').textContent = `Mature: ${stats.matureCount || 0}`;
    document.getElementById('stat-avg-age').textContent = `Avg Age: ${(stats.avgAge || 0).toFixed(1)}s`;

    // Average genes display (pre-calculated by worker)
    const avgGenes = stats.avgGenes;
    if (avgGenes) {
      let html = '';
      for (const key of Object.keys(GENE_DEFINITIONS)) {
        const val = (avgGenes[key] || 0).toFixed(2);
        const bar = '█'.repeat(Math.floor(val * 10));
        html += `<div style="margin: 2px 0;">${GENE_DEFINITIONS[key].name}: ${bar} ${val}</div>`;
      }
      document.getElementById('avg-genes').innerHTML = html;
    }

    // Population breakdown (pre-calculated by worker)
    const pop = stats.population || {};
    const predators = pop.predators || 0;
    const parasites = pop.parasites || 0;
    const scavengers = pop.scavengers || 0;
    const herbivores = pop.herbivores || 0;

    // Diet stats display
    if (this.dietHistory.plants.length > 0) {
      const avgPlants = this.dietHistory.plants.reduce((a, b) => a + b, 0) / this.dietHistory.plants.length;
      const avgMeat = this.dietHistory.meat.reduce((a, b) => a + b, 0) / this.dietHistory.meat.length;
      const avgFilter = this.dietHistory.filter.reduce((a, b) => a + b, 0) / this.dietHistory.filter.length;

      const plants = avgPlants * 60;
      const meat = avgMeat * 60;
      const filter = avgFilter * 60;
      const total = plants + meat + filter;

      let dietHtml = '';
      if (total > 0.1) {
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
    }

    // Population breakdown display (pre-calculated by worker)
    if (stats.creatureCount > 0) {
      document.getElementById('population-breakdown').innerHTML =
        `<span style="color:#f88;">${predators}</span>` +
        `<span style="color:#a6f;">${parasites}</span>` +
        `<span style="color:#da8;">${scavengers}</span>` +
        `<span style="color:#8f8;">${herbivores}</span>`;
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

  createGlossaryPanel() {
    const panel = document.createElement('div');
    panel.id = 'glossary-panel';
    panel.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.92);
      color: white;
      padding: 20px;
      font-family: monospace;
      font-size: 12px;
      border-radius: 8px;
      min-width: 700px;
      max-width: 90vw;
      max-height: 80vh;
      overflow-y: auto;
      display: none;
      pointer-events: auto;
      border: 1px solid #444;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
      z-index: 1000;
    `;

    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #444; padding-bottom: 10px;">
        <div><strong style="font-size: 16px;">CREATURE GLOSSARY</strong></div>
        <button id="glossary-close" style="
          background: #600;
          color: white;
          border: none;
          padding: 5px 12px;
          cursor: pointer;
          border-radius: 3px;
          font-family: monospace;
        ">Close</button>
      </div>
      <div id="glossary-content" style="display: flex; flex-direction: column; gap: 10px;"></div>
    `;

    document.body.appendChild(panel);

    document.getElementById('glossary-close').addEventListener('click', () => {
      this.toggleGlossary();
    });
  }

  toggleGlossary() {
    this.glossaryOpen = !this.glossaryOpen;
    const panel = document.getElementById('glossary-panel');
    panel.style.display = this.glossaryOpen ? 'block' : 'none';

    if (this.glossaryOpen) {
      this.glossaryUpdateCounter = 0;
      this.updateGlossary();
    }
  }

  // Generate species signature from key traits
  getSpeciesSignature(creature) {
    // Group creatures by their dominant traits using coarse buckets
    // This groups similar creatures together as a "species"
    const type = this.getCreatureType(creature);

    // Only 3 color buckets (warm/neutral/cool)
    const colorBucket = Math.floor(this.getGeneValue(creature, 'colorHue') * 3);

    // Only 2 size buckets (small/large)
    const sizeBucket = this.getGeneValue(creature, 'size') > 0.5 ? 'L' : 'S';

    // Limb type stays the same (fin/leg/claw)
    const limbType = this.getLimbType(creature);

    // Add a "lifestyle" bucket based on secondary traits
    let lifestyle = '';
    if (this.getGeneValue(creature, 'armor') > 0.4) lifestyle += 'A';
    if (this.getGeneValue(creature, 'speed') > 0.6) lifestyle += 'F';
    if (this.getGeneValue(creature, 'filterFeeding') > 0.4) lifestyle += 'W';

    return `${type}-${colorBucket}-${sizeBucket}-${limbType}${lifestyle ? '-' + lifestyle : ''}`;
  }

  getCreatureType(creature) {
    // Use actual behavioral thresholds from simulation
    // Predator requires both predatory drive AND jaws to hunt
    const canHunt = this.getGeneValue(creature, 'predatory') > 0.3 && this.getGeneValue(creature, 'jaws') > 0.2;
    // Parasite requires parasitic behavior to attach and drain
    const canParasitize = this.getGeneValue(creature, 'parasitic') > 0.3;
    // Scavenger requires scavenging ability OR high predatory (carnivores scavenge)
    const canScavenge = this.getGeneValue(creature, 'scavenging') > 0.2 || this.getGeneValue(creature, 'predatory') > 0.5;

    // Primary classification based on dominant behavior
    if (canHunt && this.getGeneValue(creature, 'predatory') > 0.4) return 'predator';
    if (canParasitize && this.getGeneValue(creature, 'parasitic') > 0.4) return 'parasite';
    if (canScavenge && this.getGeneValue(creature, 'scavenging') > 0.4) return 'scavenger';
    return 'herbivore';
  }

  getLimbType(creature) {
    const limbVar = creature.limbsVariativeness || 0.5;
    if (limbVar < 0.33) return 'fin';
    if (limbVar < 0.66) return 'leg';
    return 'claw';
  }

  getEatingHabits(creature) {
    const habits = [];
    const predatory = this.getGeneValue(creature, 'predatory');
    const parasitic = this.getGeneValue(creature, 'parasitic');
    const scavenging = this.getGeneValue(creature, 'scavenging');
    const filterFeeding = this.getGeneValue(creature, 'filterFeeding');

    if (predatory > 0.4) habits.push({ name: 'Hunting', value: predatory, color: '#f88' });
    if (parasitic > 0.3) habits.push({ name: 'Parasitism', value: parasitic, color: '#a6f' });
    if (scavenging > 0.4) habits.push({ name: 'Scavenging', value: scavenging, color: '#da8' });
    if (filterFeeding > 0.3) habits.push({ name: 'Filter Feeding', value: filterFeeding, color: '#88f' });

    // All creatures can eat plants (herbivory)
    if (habits.length === 0 || predatory < 0.6) {
      habits.push({ name: 'Herbivory', value: 1 - predatory, color: '#8f8' });
    }

    return habits;
  }

  getPopulationStatus(count, prevCount) {
    if (count === 0) return { status: 'Extinct', color: '#666', icon: '💀' };
    if (prevCount === 0 && count > 0) return { status: 'New', color: '#ff0', icon: '✨' };
    if (count <= 3) return { status: 'Endangered', color: '#f44', icon: '⚠' };
    if (count < prevCount * 0.7) return { status: 'Declining', color: '#f80', icon: '↓' };
    if (count > prevCount * 1.3) return { status: 'Growing', color: '#4f4', icon: '↑' };
    return { status: 'Stable', color: '#8f8', icon: '●' };
  }

  // Get a representative CSS color from creature genes
  getCreatureColor(creature) {
    const hue = this.getGeneValue(creature, 'colorHue') || 0.33;
    const sat = 0.3 + (this.getGeneValue(creature, 'colorSaturation') || 0.5) * 0.5;
    const light = 0.35 + (this.getGeneValue(creature, 'colorSaturation') || 0.5) * 0.15;
    return `hsl(${Math.floor(hue * 360)}, ${Math.floor(sat * 100)}%, ${Math.floor(light * 100)}%)`;
  }

  // Generate a simple SVG creature icon based on traits (cached by signature)
  getCreatureSVG(creature) {
    // Use species signature as cache key
    const sig = this.getSpeciesSignature(creature);
    if (this.svgCache.has(sig)) {
      return this.svgCache.get(sig);
    }

    const size = 0.5 + this.getGeneValue(creature, 'size') * 0.5;
    const color = this.getCreatureColor(creature);
    const hasJaws = this.getGeneValue(creature, 'jaws') > 0.3;
    const hasEyes = this.getGeneValue(creature, 'sight') > 0.15;
    const limbType = this.getLimbType(creature);
    const limbValue = this.getGeneValue(creature, 'limbs');
    const hasArmor = this.getGeneValue(creature, 'armor') > 0.3;
    const type = this.getCreatureType(creature);

    // Pattern based on type
    let patternDef = '';
    let patternFill = color;
    if (type === 'predator') {
      patternDef = `<pattern id="stripes-${creature.id || 'gen'}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
        <rect width="3" height="6" fill="${color}"/>
        <rect x="3" width="3" height="6" fill="#c22"/>
      </pattern>`;
      patternFill = `url(#stripes-${creature.id || 'gen'})`;
    } else if (type === 'parasite') {
      patternDef = `<pattern id="spots-${creature.id || 'gen'}" patternUnits="userSpaceOnUse" width="10" height="10">
        <rect width="10" height="10" fill="${color}"/>
        <circle cx="5" cy="5" r="2" fill="#94a"/>
      </pattern>`;
      patternFill = `url(#spots-${creature.id || 'gen'})`;
    } else if (type === 'scavenger') {
      patternDef = `<pattern id="patches-${creature.id || 'gen'}" patternUnits="userSpaceOnUse" width="8" height="8">
        <rect width="8" height="8" fill="${color}"/>
        <rect x="0" y="0" width="4" height="4" fill="#864"/>
        <rect x="4" y="4" width="4" height="4" fill="#864"/>
      </pattern>`;
      patternFill = `url(#patches-${creature.id || 'gen'})`;
    }

    let svg = `<svg viewBox="0 0 60 60" width="60" height="60" xmlns="http://www.w3.org/2000/svg">
      <defs>${patternDef}</defs>`;

    // Body
    const bodyW = 20 * size;
    const bodyH = 16 * size;
    svg += `<ellipse cx="30" cy="30" rx="${bodyW}" ry="${bodyH}" fill="${patternFill}" stroke="#333" stroke-width="1"/>`;

    // Armor overlay
    if (hasArmor) {
      svg += `<ellipse cx="30" cy="28" rx="${bodyW * 0.9}" ry="${bodyH * 0.6}" fill="rgba(60,40,20,0.5)" stroke="#542"/>`;
    }

    // Limbs
    if (limbValue > 0.15) {
      if (limbType === 'fin') {
        svg += `<ellipse cx="${30 - bodyW - 5}" cy="30" rx="8" ry="4" fill="${color}" opacity="0.8" transform="rotate(-20, ${30 - bodyW - 5}, 30)"/>`;
        svg += `<ellipse cx="${30 + bodyW + 5}" cy="30" rx="8" ry="4" fill="${color}" opacity="0.8" transform="rotate(20, ${30 + bodyW + 5}, 30)"/>`;
      } else if (limbType === 'leg') {
        svg += `<line x1="${30 - bodyW * 0.7}" y1="${30 + bodyH * 0.5}" x2="${30 - bodyW - 8}" y2="50" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`;
        svg += `<line x1="${30 + bodyW * 0.7}" y1="${30 + bodyH * 0.5}" x2="${30 + bodyW + 8}" y2="50" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`;
      } else { // claw
        svg += `<path d="M${30 - bodyW} 35 L${30 - bodyW - 10} 42 L${30 - bodyW - 6} 38 L${30 - bodyW - 12} 48" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
        svg += `<path d="M${30 + bodyW} 35 L${30 + bodyW + 10} 42 L${30 + bodyW + 6} 38 L${30 + bodyW + 12} 48" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
      }
    }

    // Eyes
    if (hasEyes) {
      const eyeSize = 3 + this.getGeneValue(creature, 'sight') * 2;
      svg += `<circle cx="${30 - 6}" cy="${30 - bodyH * 0.3}" r="${eyeSize}" fill="white" stroke="#333"/>`;
      svg += `<circle cx="${30 + 6}" cy="${30 - bodyH * 0.3}" r="${eyeSize}" fill="white" stroke="#333"/>`;
      svg += `<circle cx="${30 - 5}" cy="${30 - bodyH * 0.3}" r="${eyeSize * 0.5}" fill="#111"/>`;
      svg += `<circle cx="${30 + 7}" cy="${30 - bodyH * 0.3}" r="${eyeSize * 0.5}" fill="#111"/>`;
    }

    // Jaws
    if (hasJaws) {
      const jawSize = 4 + this.getGeneValue(creature, 'jaws') * 4;
      svg += `<path d="M${30 - 4} ${30 - bodyH - 2} L${30} ${30 - bodyH - jawSize} L${30 + 4} ${30 - bodyH - 2}" stroke="#543" stroke-width="2" fill="none"/>`;
    }

    svg += '</svg>';

    // Cache the SVG for this species signature
    this.svgCache.set(sig, svg);

    return svg;
  }

  updateGlossary() {
    if (!this.lastWorldData) return;

    const creatures = this.lastWorldData.creatures || [];
    const content = document.getElementById('glossary-content');

    // Group creatures by species signature
    const speciesCounts = new Map();
    const speciesRepresentatives = new Map();

    for (const c of creatures) {
      const sig = this.getSpeciesSignature(c);
      speciesCounts.set(sig, (speciesCounts.get(sig) || 0) + 1);

      // Keep representative (first found)
      if (!speciesRepresentatives.has(sig)) {
        speciesRepresentatives.set(sig, c);
      }
    }

    // Update history for status tracking
    const prevCounts = new Map(this.speciesHistory);
    this.speciesHistory = new Map(speciesCounts);

    // Also check for extinct species (in history but not current)
    for (const [sig, count] of prevCounts) {
      if (!speciesCounts.has(sig) && count > 0) {
        speciesCounts.set(sig, 0);
        // Keep the old representative for extinct display
        if (!speciesRepresentatives.has(sig)) {
          speciesRepresentatives.set(sig, this.speciesData.get(sig));
        }
      }
    }

    // Store for extinct tracking
    for (const [sig, rep] of speciesRepresentatives) {
      this.speciesData.set(sig, rep);
    }

    // Group species by diet type
    const dietGroups = {
      predator: { name: 'Predators', color: '#f88', icon: '🦷', species: [] },
      parasite: { name: 'Parasites', color: '#a6f', icon: '🦠', species: [] },
      scavenger: { name: 'Scavengers', color: '#da8', icon: '🦴', species: [] },
      herbivore: { name: 'Herbivores', color: '#8f8', icon: '🌿', species: [] }
    };

    // Sort species into diet groups
    for (const [sig, count] of speciesCounts) {
      const rep = speciesRepresentatives.get(sig) || this.speciesData.get(sig);
      if (!rep) continue;

      const type = this.getCreatureType(rep);
      const prevCount = prevCounts.get(sig) || 0;

      dietGroups[type].species.push({
        sig,
        count,
        prevCount,
        rep
      });
    }

    // Sort each group by population
    for (const group of Object.values(dietGroups)) {
      group.species.sort((a, b) => b.count - a.count);
      group.totalPop = group.species.reduce((sum, s) => sum + s.count, 0);
    }

    if (speciesCounts.size === 0) {
      content.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">No creatures found</div>';
      return;
    }

    // Remember which groups were open/closed
    const openGroups = new Map();
    const hasExistingState = content.querySelectorAll('details[data-diet]').length > 0;
    content.querySelectorAll('details[data-diet]').forEach(d => {
      openGroups.set(d.dataset.diet, d.open);
    });

    let html = '';

    // Render each diet group
    for (const [dietType, group] of Object.entries(dietGroups)) {
      if (group.species.length === 0) continue;

      // Preserve user's choice, or open by default on first render
      const isOpen = hasExistingState ? (openGroups.get(dietType) ?? true) : true;

      html += `
        <details data-diet="${dietType}" style="background: rgba(255,255,255,0.03); border-radius: 5px; padding: 10px;" ${isOpen ? 'open' : ''}>
          <summary style="cursor: pointer; user-select: none; display: flex; justify-content: space-between; align-items: center; padding: 5px;">
            <span style="color: ${group.color}; font-weight: bold; font-size: 14px;">
              ${group.icon} ${group.name}
            </span>
            <span style="color: #888; font-size: 11px;">
              ${group.species.length} species | ${group.totalPop} total
            </span>
          </summary>
          <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px;">
      `;

      for (const { sig, count, prevCount, rep } of group.species) {
        const status = this.getPopulationStatus(count, prevCount);
        const habits = this.getEatingHabits(rep);

        html += `
          <div style="background: rgba(255,255,255,0.05); border-radius: 5px; padding: 10px; ${count === 0 ? 'opacity: 0.5;' : ''}">
            <div style="display: flex; gap: 12px; align-items: flex-start;">
              <!-- Creature Picture -->
              <div style="flex-shrink: 0; background: rgba(0,0,0,0.3); border-radius: 5px; padding: 5px;">
                ${this.getCreatureSVG(rep)}
              </div>

              <!-- Info -->
              <div style="flex-grow: 1;">
                <!-- Header with status -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <span style="color: ${status.color};">${status.icon} ${status.status} (${count})</span>
                  ${count > 0 ? `<button class="find-species-btn" data-sig="${sig}" style="
                    background: #446;
                    color: white;
                    border: none;
                    padding: 3px 8px;
                    cursor: pointer;
                    border-radius: 3px;
                    font-family: monospace;
                    font-size: 10px;
                  ">Find</button>` : ''}
                </div>

                <!-- Eating Habits -->
                <div style="margin-bottom: 6px; font-size: 11px;">
                  <span style="color: #aaa;">Diet: </span>
                  ${habits.map(h => `<span style="color: ${h.color};">${h.name}</span>`).join(', ')}
                </div>

                <!-- Collapsible Genetics -->
                <details style="margin-top: 5px;">
                  <summary style="cursor: pointer; color: #aaa; user-select: none; font-size: 11px;">Genetics</summary>
                  <div style="margin-top: 6px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; font-size: 9px;">
                    ${Object.keys(GENE_DEFINITIONS).map(key => {
                      const val = this.getGeneValue(rep, key);
                      const barLen = Math.floor(val * 8);
                      const bar = '█'.repeat(barLen) + '░'.repeat(8 - barLen);
                      return `<div><span style="color:#888;">${GENE_DEFINITIONS[key].name}:</span> <span style="color:#6cf;">${bar}</span> ${val.toFixed(2)}</div>`;
                    }).join('')}
                  </div>
                </details>
              </div>
            </div>
          </div>
        `;
      }

      html += `
          </div>
        </details>
      `;
    }

    content.innerHTML = html;

    // Add click handlers for Find buttons
    content.querySelectorAll('.find-species-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sig = e.target.dataset.sig;
        this.focusOnSpecies(sig);
      });
    });
  }

  // Set callback for focusing camera on a creature
  setFocusCallback(callback) {
    this.focusCallback = callback;
  }

  // Find and focus on a random creature of a species
  focusOnSpecies(signature) {
    if (!this.lastWorldData || !this.focusCallback) return;

    const creatures = this.lastWorldData.creatures || [];
    const matching = creatures.filter(c => this.getSpeciesSignature(c) === signature);

    if (matching.length > 0) {
      const randomCreature = matching[Math.floor(Math.random() * matching.length)];
      this.focusCallback(randomCreature);
      this.toggleGlossary(); // Close glossary
    }
  }
}
