import * as THREE from 'three';
import { DNA } from './DNA.js';
import { GENE_DEFINITIONS, DEFAULT_GENE_WEIGHTS } from './Constants.js';

export class Creature {
  constructor(dna, position) {
    this.dna = dna || new DNA();
    this.position = position || new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.acceleration = new THREE.Vector3();
    
    this.energy = 100; // Starting energy
    this.age = 0;
    this.dead = false;
    this.generation = 0; // Track evolutionary generation
    
    // Mesh setup
    this.mesh = new THREE.Group();
    this.bodyMesh = null;
    this.armorMesh = null;
    this.createMesh();
    
    this.updateFromGenes();
  }

  updateFromGenes() {
    // Cache gene values for performance
    this.size = this.dna.getGene('size');
    this.speed = this.dna.getGene('speed');
    this.senseRadius = this.dna.getGene('senseRadius');
    this.armor = this.dna.getGene('armor');
    this.metabolicEfficiency = this.dna.getGene('metabolicEfficiency');
    this.toxicity = this.dna.getGene('toxicity');
    this.coldResistance = this.dna.getGene('coldResistance');
    this.heatResistance = this.dna.getGene('heatResistance');
    this.lungCapacity = this.dna.getGene('lungCapacity');
    this.scavenging = this.dna.getGene('scavenging');
    this.parasitic = this.dna.getGene('parasitic');
    this.reproductionUrgency = this.dna.getGene('reproductionUrgency');
    this.maneuverability = this.dna.getGene('maneuverability');
    this.predatory = this.dna.getGene('predatory');
    this.limbs = this.dna.getGene('limbs');
    this.jaws = this.dna.getGene('jaws');

    // Calculate phenotype characteristics based on variativeness
    this.phenotype = this.calculatePhenotype();

    // Derived stats (now influenced by phenotype)
    this.maxSpeed = 0.5 + (this.speed * 2); // Base 0.5, max 2.5
    // Streamlined bodies move faster
    this.maxSpeed *= (0.8 + this.phenotype.body.streamlining * 0.4);
    
    this.maxForce = 0.05 + (this.maneuverability * 0.1); // Turning speed
    // Body flexibility improves turning
    this.maxForce *= (0.8 + this.phenotype.body.flexibility * 0.4);
    
    this.mass = 1 + (this.size * 5) + (this.armor * 2);
    // Armor thickness adds mass
    this.mass += this.phenotype.armor.thickness * 2;
    
    // Update mesh scale/appearance with body proportions
    const baseScale = 0.5 + (this.size * 1.5);
    // Apply body length ratio (elongated vs compact)
    const lengthRatio = this.phenotype.body.lengthRatio;
    const widthRatio = 1.0 / Math.sqrt(lengthRatio); // Maintain volume
    
    // Scale body based on phenotype
    this.bodyMesh.scale.set(
      widthRatio * baseScale,
      widthRatio * baseScale,
      lengthRatio * baseScale
    );
    
    // Update color based on color genes (freely evolvable)
    if (this.bodyMesh) {
      // Get color genes - these can mutate freely
      const colorHue = this.dna.getGene('colorHue');
      const colorSaturation = this.dna.getGene('colorSaturation');

      // Base color from genes
      const hue = colorHue; // Full spectrum 0-1
      let saturation = 0.3 + colorSaturation * 0.5; // 0.3-0.8
      let lightness = 0.35 + colorSaturation * 0.15; // 0.35-0.5

      // Toxic creatures get brighter, more saturated colors (warning coloration)
      // This is biologically meaningful - bright colors warn predators (aposematism)
      if (this.toxicity > 0.4) {
        saturation = Math.min(saturation + this.toxicity * 0.3, 1.0);
        lightness = Math.min(lightness + this.toxicity * 0.2, 0.6);
      }

      this.bodyMesh.material.color.setHSL(hue, saturation, lightness);
    }
    
    this.updateVisuals();
  }

  calculatePhenotype() {
    const pw = DEFAULT_GENE_WEIGHTS.phenotype;
    const phenotype = {};
    
    // Get gene objects (not just values) to access variativeness
    const limbsGene = this.dna.genes.limbs;
    const maneuverGene = this.dna.genes.maneuverability;
    const speedGene = this.dna.genes.speed;
    const jawsGene = this.dna.genes.jaws;
    const armorGene = this.dna.genes.armor;
    const sightGene = this.dna.genes.sight;
    const hearingGene = this.dna.genes.hearing;
    const smellGene = this.dna.genes.smell;
    const sizeGene = this.dna.genes.size;
    const toxicityGene = this.dna.genes.toxicity;
    const metabolicGene = this.dna.genes.metabolicEfficiency;
    const predatoryGene = this.dna.genes.predatory;
    const colorHueGene = this.dna.genes.colorHue;
    const colorSatGene = this.dna.genes.colorSaturation;
    
    // Limb characteristics
    phenotype.limbs = {
      count: Math.floor(pw.limbs.countMin + limbsGene.value * (pw.limbs.countMax - pw.limbs.countMin)),
      length: pw.limbs.lengthBase + limbsGene.variativeness * pw.limbs.lengthFromVariativeness,
      width: pw.limbs.widthBase + limbsGene.variativeness * pw.limbs.widthFromVariativeness,
    };
    
    // Body streamlining and flexibility
    phenotype.body = {
      streamlining: pw.body.streamliningBase + 
                   maneuverGene.variativeness * pw.body.streamliningFromManeuver +
                   speedGene.variativeness * pw.body.streamliningFromSpeed,
      flexibility: maneuverGene.variativeness * pw.body.flexibilityFromManeuver,
      // Body proportions based on size variativeness
      // High variativeness = elongated, low = compact
      lengthRatio: 1.0 + sizeGene.variativeness * 0.8,
      // Metabolic efficiency affects sleekness
      sleekness: metabolicGene.variativeness, // High = lean, low = bulky
    };
    
    // Fins (for swimming)
    phenotype.fins = {
      size: pw.fins.sizeBase + maneuverGene.variativeness * pw.fins.sizeFromVariativeness,
      count: Math.floor(maneuverGene.value * pw.fins.countFromManeuver),
      aspectRatio: pw.fins.aspectRatioBase + maneuverGene.variativeness * pw.fins.aspectRatioFromVariativeness,
    };
    
    // Wings (for potential flight/gliding)
    phenotype.wings = {
      span: pw.wings.spanBase + 
           limbsGene.variativeness * pw.wings.spanFromLimbVariativeness +
           maneuverGene.variativeness * pw.wings.spanFromManeuverVariativeness,
    };
    
    // Jaw characteristics
    phenotype.jaws = {
      size: pw.jaws.sizeBase + jawsGene.variativeness * pw.jaws.sizeFromVariativeness,
      biteForce: 1.0 + jawsGene.variativeness * pw.jaws.forceFromVariativeness,
      // Predatory affects jaw prominence
      prominence: 0.5 + predatoryGene.variativeness * 0.5,
    };
    
    // Armor characteristics
    phenotype.armor = {
      thickness: pw.armor.thicknessBase + armorGene.variativeness * pw.armor.thicknessFromVariativeness,
      coverage: pw.armor.coverageBase + armorGene.value * pw.armor.coverageFromValue,
      massPenalty: armorGene.variativeness * pw.armor.massPenaltyFromVariativeness,
    };
    
    // Sensory organs
    phenotype.sensors = {
      eyeSize: sightGene ? sightGene.variativeness * pw.sensors.eyeSizeFromSightVariativeness : 0,
      earSize: hearingGene ? hearingGene.variativeness * pw.sensors.earSizeFromHearingVariativeness : 0,
      antennaSize: smellGene ? smellGene.variativeness * pw.sensors.antennaSizeFromSmellVariativeness : 0,
    };
    
    // Color and pattern (for visual diversity)
    phenotype.appearance = {
      // Toxicity affects color intensity
      toxicityHue: toxicityGene.variativeness, // High = bright warning colors
      toxicityIntensity: toxicityGene.value,
      // Color genes determine base coloration
      colorHue: colorHueGene ? colorHueGene.value : 0.33,
      colorSaturation: colorSatGene ? colorSatGene.value : 0.5,
    };
    
    return phenotype;
  }

  createMesh() {
    // Create main body group
    this.mesh = new THREE.Group();

    // Create organic blob-like body using a modified sphere with noise
    // Use icosahedron for more organic feel, then smooth it
    const bodyGeo = new THREE.IcosahedronGeometry(1, 3);

    // Add slight organic deformation to vertices
    const positions = bodyGeo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);

      // Subtle organic bulges
      const noise = Math.sin(x * 3) * Math.sin(y * 3) * Math.sin(z * 3) * 0.08;
      const len = Math.sqrt(x*x + y*y + z*z);
      const scale = 1 + noise;

      positions.setXYZ(i, x * scale, y * scale, z * scale);
    }
    bodyGeo.computeVertexNormals();

    // Create organic-looking material with subsurface scattering feel
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x00ff00,
      roughness: 0.6,
      metalness: 0.0,
      flatShading: false,
    });

    this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.mesh.add(this.bodyMesh);
    
    // Armor/Shell Group - will be populated based on armor gene
    this.armorGroup = new THREE.Group();
    this.mesh.add(this.armorGroup);
    
    // Cold Resistance (Fur/Blubber layer)
    const furGeo = new THREE.SphereGeometry(1.08, 16, 16);
    this.coldMesh = new THREE.Mesh(
      furGeo,
      new THREE.MeshStandardMaterial({ 
        color: 0xf0f0f0, 
        transparent: true, 
        opacity: 0,
        roughness: 1.0, // Very rough for fur appearance
      })
    );
    this.mesh.add(this.coldMesh);
    
    // Limbs Group
    this.limbsGroup = new THREE.Group();
    this.mesh.add(this.limbsGroup);
    
    // Jaws/Mouth Group
    this.jawsGroup = new THREE.Group();
    this.mesh.add(this.jawsGroup);
    
    // Fins Group (for aquatic creatures)
    this.finsGroup = new THREE.Group();
    this.mesh.add(this.finsGroup);
    
    // Eyes Group
    this.eyesGroup = new THREE.Group();
    this.mesh.add(this.eyesGroup);
    
    // Antennae Group
    this.antennaeGroup = new THREE.Group();
    this.mesh.add(this.antennaeGroup);
    
    // Tail (for streamlined creatures)
    this.tailGroup = new THREE.Group();
    this.mesh.add(this.tailGroup);
  }

  update(dt, world, biome) {
    if (this.dead) return;

    this.age += dt;
    
    // Metabolic Cost
    // Basal Metabolism - reduced for easier survival
    let basalCost = 0.05 * (1 + this.size); 
    // Reduced by Metabolic Efficiency
    basalCost *= (1 - this.metabolicEfficiency * 0.5);
    // Increased by Predatory Instinct (stress)
    basalCost *= (1 + this.predatory * 0.5);
    // Jaws cost (weight/maintenance)
    basalCost *= (1 + this.jaws * 0.3);
    
    // Temperature Cost
    // Ideal temp is 20. 
    // Cold resistance helps if temp < 10
    // Heat resistance helps if temp > 30
    const temp = biome ? biome.temp : 20;
    let tempCost = 0;
    
    if (temp < 10) {
      // Cold
      const resistance = this.coldResistance;
      tempCost = (10 - temp) * 0.05 * (1 - resistance);
    } else if (temp > 30) {
      // Heat
      const resistance = this.heatResistance;
      tempCost = (temp - 30) * 0.05 * (1 - resistance);
    }
    
    // Movement Cost
    const speed = this.velocity.length();
    let moveCost = speed * speed * 0.1;
    moveCost *= (1 + this.speed * 2); // Speed gene increases cost
    
    // Limbs/Fins Trade-off based on phenotype
    if (this.position.y < 0) {
      // Water: Limbs cause drag, but fins help
      const limbDrag = this.limbs * (0.3 + this.phenotype.limbs.length * 0.3);
      const finBonus = this.phenotype.fins.size * 0.4; // Larger fins = better swimming
      moveCost *= (1 + limbDrag - finBonus);
    } else {
      // Land: Limbs help movement (longer limbs = better running)
      const limbBonus = this.limbs * (0.3 + this.phenotype.limbs.length * 0.2);
      moveCost *= Math.max(0.2, 1 - limbBonus); // Don't go below 20% cost
    }
    
    // Brain Cost
    const brainCost = this.senseRadius * 0.05;
    
    // Total Step Cost
    const totalCost = (basalCost + moveCost + brainCost + tempCost) * dt;
    this.energy -= totalCost;
    
    // Filter Feeding (Passive Energy Gain)
    // Greatly reduced - creatures MUST eat plants to survive and reproduce
    // This is just baseline survival for staying still
    if (this.position.y < 0 && speed < 0.3) {
       const filterGain = 0.1 * dt * (1 + this.senseRadius * 0.2);
       this.energy += filterGain;
    }
    
    if (this.energy <= 0) {
      this.die();
    }
    
    // Movement Logic
    this.velocity.add(this.acceleration);
    this.velocity.clampLength(0, this.maxSpeed);
    this.position.add(this.velocity);
    this.acceleration.set(0, 0, 0);
    
    // Update Mesh Position
    this.mesh.position.copy(this.position);
    
    // Rotate to face velocity
    if (this.velocity.lengthSq() > 0.001) {
      const targetQuaternion = new THREE.Quaternion();
      const m = new THREE.Matrix4();
      m.lookAt(this.velocity, new THREE.Vector3(0,0,0), new THREE.Vector3(0,1,0));
      targetQuaternion.setFromRotationMatrix(m);
      this.mesh.quaternion.slerp(targetQuaternion, 0.1);
    }
    
    // Visual Updates
    if (this.armorMesh) {
      this.armorMesh.material.opacity = this.armor * 0.5;
    }
    
    // Reproduction - lowered threshold to make evolution happen faster
    if (this.energy > 120) { // Threshold
      // Check reproduction urgency gene?
      const threshold = 120 * (1 - this.reproductionUrgency * 0.5);
      if (this.energy > threshold) {
        return this.reproduce();
      }
    }
    return null;
  }

  reproduce() {
    this.energy /= 2;
    const offspringDNA = this.dna.clone();
    offspringDNA.mutate();
    
    const offset = new THREE.Vector3(Math.random()-0.5, 0, Math.random()-0.5).normalize().multiplyScalar(2);
    const offspringPos = this.position.clone().add(offset);
    
    const offspring = new Creature(offspringDNA, offspringPos);
    offspring.energy = this.energy; // Split energy
    offspring.generation = this.generation + 1; // Increment generation
    return offspring;
  }

  eat(amount) {
    // Digestion time penalty?
    this.energy += amount;
  }


  
  updateVisuals() {
     if (!this.phenotype) return;
     
     const baseScale = 0.5 + (this.size * 1.5);
     const bodyScale = this.bodyMesh.scale; // Get actual body scale
     
     // === ARMOR - Dark brown carapace on top ===
     if (this.armor > 0.2 && this.armorGroup.children.length === 0) {
       const carapaceMat = new THREE.MeshStandardMaterial({
         color: 0x3d2817, // Dark brown
         roughness: 0.4,
         metalness: 0.15
       });

       // Half-sphere covering top of body
       const carapaceGeo = new THREE.SphereGeometry(1.02, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
       const carapace = new THREE.Mesh(carapaceGeo, carapaceMat);
       carapace.scale.set(
         bodyScale.x * 1.02,
         bodyScale.y * (0.8 + this.armor * 0.2),
         bodyScale.z * 1.05
       );
       carapace.position.y = 0.05 * bodyScale.y;
       this.armorGroup.add(carapace);
     }
     
     // === COLD RESISTANCE - Fur/Blubber ===
     if (this.coldResistance > 0.5) {
       this.coldMesh.material.opacity = 0.2 + (this.coldResistance - 0.5) * 0.6;
       this.coldMesh.scale.copy(bodyScale).multiplyScalar(1.05 + this.coldResistance * 0.1);
     } else {
       this.coldMesh.material.opacity = 0;
     }
     
     // === LIMBS ===
     // Gene VALUE controls SIZE (0=none, 1=big limbs)
     // Gene VARIATIVENESS controls TYPE (fins for aquatic, legs for land, claws for predation)

     const limbsGene = this.dna.genes.limbs;
     const limbValue = limbsGene.value;           // Controls SIZE
     const limbVariativeness = limbsGene.variativeness;  // Controls TYPE

     // Skip if limb value is too low (no limbs)
     if (limbValue > 0.15 && this.limbsGroup.children.length === 0) {
       // SIZE based on gene VALUE
       const limbScale = 0.3 + limbValue * 1.2;  // 0.3 to 1.5 scale factor
       const limbLength = limbScale * baseScale * 0.6;
       const limbWidth = limbScale * baseScale * 0.08;

       // Number of limbs scales with value too (more value = more limbs)
       const limbCount = limbValue > 0.7 ? 6 : (limbValue > 0.4 ? 4 : 2);

       // TYPE based on gene VARIATIVENESS
       // Low variativeness (0-0.33): FINS (aquatic, flat paddle-like)
       // Medium variativeness (0.33-0.66): LEGS (land locomotion, jointed)
       // High variativeness (0.66-1.0): CLAWS (predatory, pincers)
       let limbType;
       if (limbVariativeness < 0.33) {
         limbType = 'fin';
       } else if (limbVariativeness < 0.66) {
         limbType = 'leg';
       } else {
         limbType = 'claw';
       }

       // Get body color for limbs (slightly darker)
       const bodyColor = this.bodyMesh.material.color.clone();
       const limbColor = bodyColor.clone().multiplyScalar(0.7);

       const limbMat = new THREE.MeshStandardMaterial({
         color: limbColor,
         roughness: 0.7
       });

       for (let i = 0; i < limbCount; i++) {
         // Distribute limbs on sides of body
         const pairIndex = Math.floor(i / 2);
         const side = (i % 2 === 0) ? -1 : 1;
         const zOffset = (pairIndex - (Math.floor(limbCount / 2) - 1) * 0.5) * 0.4;

         const limbGroup = new THREE.Group();

         if (limbType === 'fin') {
           // === FINS - Flat paddle-like for swimming ===
           const finMat = new THREE.MeshStandardMaterial({
             color: limbColor,
             side: THREE.DoubleSide,
             transparent: true,
             opacity: 0.85,
             roughness: 0.5
           });

           // Paddle shape
           const finShape = new THREE.Shape();
           finShape.moveTo(0, 0);
           finShape.quadraticCurveTo(limbLength * 0.3, limbLength * 0.6, 0, limbLength);
           finShape.quadraticCurveTo(-limbLength * 0.2, limbLength * 0.5, 0, 0);

           const finGeo = new THREE.ShapeGeometry(finShape);
           const fin = new THREE.Mesh(finGeo, finMat);
           fin.rotation.x = -Math.PI / 2;  // Lay flat
           fin.rotation.z = side * 0.3;    // Angle outward
           limbGroup.add(fin);

           // Position fins on sides
           limbGroup.position.set(
             side * bodyScale.x * 0.9,
             0,
             zOffset * bodyScale.z
           );
           limbGroup.rotation.y = side * Math.PI / 3;

         } else if (limbType === 'claw') {
           // === CLAWS - Pincers for predation ===
           const armLength = limbLength * 0.8;
           const clawSize = limbWidth * 3;

           // Socket
           const socketGeo = new THREE.SphereGeometry(limbWidth * 2, 8, 8);
           const socket = new THREE.Mesh(socketGeo, limbMat);
           limbGroup.add(socket);

           // Upper arm
           const upperArmGeo = new THREE.CylinderGeometry(limbWidth * 1.0, limbWidth * 1.3, armLength * 0.5, 8);
           const upperArm = new THREE.Mesh(upperArmGeo, limbMat);
           upperArm.position.y = -armLength * 0.25;
           limbGroup.add(upperArm);

           // Forearm
           const forearmGeo = new THREE.CylinderGeometry(limbWidth * 0.8, limbWidth * 1.0, armLength * 0.5, 8);
           const forearm = new THREE.Mesh(forearmGeo, limbMat);
           forearm.position.y = -armLength * 0.75;
           limbGroup.add(forearm);

           // Pincer claws
           const pincerMat = limbMat.clone();
           pincerMat.color.multiplyScalar(0.75);
           const pincerGeo = new THREE.ConeGeometry(clawSize * 0.25, clawSize * 1.0, 4);

           const pincer1 = new THREE.Mesh(pincerGeo, pincerMat);
           pincer1.position.set(clawSize * 0.2, -armLength - clawSize * 0.3, 0);
           pincer1.rotation.z = -0.3;
           limbGroup.add(pincer1);

           const pincer2 = new THREE.Mesh(pincerGeo, pincerMat);
           pincer2.position.set(-clawSize * 0.2, -armLength - clawSize * 0.3, 0);
           pincer2.rotation.z = 0.3;
           limbGroup.add(pincer2);

           limbGroup.userData.isClaw = true;

           // Position claws on lower sides
           limbGroup.position.set(
             side * bodyScale.x * 0.85,
             -0.2 * bodyScale.y,
             zOffset * bodyScale.z
           );
           limbGroup.rotation.z = side * 0.4;
           limbGroup.rotation.x = 0.2;

         } else {
           // === LEGS - Jointed for land locomotion ===
           // Socket joint
           const socketGeo = new THREE.SphereGeometry(limbWidth * 1.8, 8, 8);
           const socket = new THREE.Mesh(socketGeo, limbMat);
           socket.scale.set(1, 0.8, 1);
           limbGroup.add(socket);

           // Thigh
           const thighLength = limbLength * 0.45;
           const thighGeo = new THREE.CylinderGeometry(limbWidth * 0.85, limbWidth * 1.1, thighLength, 8);
           const thigh = new THREE.Mesh(thighGeo, limbMat);
           thigh.position.y = -thighLength * 0.5;
           limbGroup.add(thigh);

           // Knee
           const kneeGeo = new THREE.SphereGeometry(limbWidth * 0.95, 6, 6);
           const knee = new THREE.Mesh(kneeGeo, limbMat);
           knee.position.y = -thighLength;
           limbGroup.add(knee);

           // Shin
           const shinLength = limbLength * 0.5;
           const shinGeo = new THREE.CylinderGeometry(limbWidth * 0.55, limbWidth * 0.8, shinLength, 8);
           const shin = new THREE.Mesh(shinGeo, limbMat);
           shin.position.y = -thighLength - shinLength * 0.5;
           limbGroup.add(shin);

           // Foot
           const footGeo = new THREE.SphereGeometry(limbWidth * 1.0, 8, 6);
           const foot = new THREE.Mesh(footGeo, limbMat);
           foot.position.y = -thighLength - shinLength;
           foot.scale.set(1.4, 0.5, 1.6);
           limbGroup.add(foot);

           // Position legs on lower sides
           limbGroup.position.set(
             side * bodyScale.x * 0.85,
             -0.25 * bodyScale.y,
             zOffset * bodyScale.z
           );
           limbGroup.rotation.z = side * 0.5;
           limbGroup.rotation.x = 0.15;
         }

         // Store for animation
         limbGroup.userData.initialRotation = limbGroup.rotation.clone();
         limbGroup.userData.side = side;
         limbGroup.userData.pairIndex = pairIndex;
         limbGroup.userData.limbType = limbType;

         this.limbsGroup.add(limbGroup);
       }
     }
     
     // === JAWS - Thin insect-like mandibles ===
     if (this.jaws > 0.3 && this.jawsGroup.children.length === 0) {
       const jawSize = this.phenotype.jaws.size * baseScale * 0.8;
       const biteForce = this.phenotype.jaws.biteForce;

       // Dark chitinous color for mandibles
       const mandibleColor = new THREE.Color(0x3a2a1a);
       const mandibleMat = new THREE.MeshStandardMaterial({
         color: mandibleColor,
         roughness: 0.4,
         metalness: 0.2
       });

       // Create curved mandible shape using tapered cylinder
       const mandibleLength = jawSize * 1.2;
       const mandibleWidth = jawSize * 0.12;

       for (let side = -1; side <= 1; side += 2) {
         // Each mandible is a curved, tapered pincer
         const mandibleGeo = new THREE.CylinderGeometry(
           mandibleWidth * 0.3,  // Tip (thin)
           mandibleWidth,        // Base (thicker)
           mandibleLength,
           6
         );

         const mandible = new THREE.Mesh(mandibleGeo, mandibleMat);

         // Position at sides of mouth area
         mandible.position.set(
           side * bodyScale.x * 0.15,
           -bodyScale.y * 0.2,
           bodyScale.z * 0.95
         );

         // Rotate to point forward and curve inward
         mandible.rotation.x = Math.PI * 0.4;  // Point forward-down
         mandible.rotation.z = -side * 0.3;    // Angle inward

         // Add serrated edge/teeth for strong jaws
         if (this.jaws > 0.5) {
           const teethCount = Math.floor(3 + biteForce * 3);
           const toothGeo = new THREE.ConeGeometry(mandibleWidth * 0.3, mandibleWidth * 0.8, 3);
           const toothMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0a });

           for (let i = 0; i < teethCount; i++) {
             const tooth = new THREE.Mesh(toothGeo, toothMat);
             const t = (i / teethCount) - 0.3;
             tooth.position.set(side * mandibleWidth * 0.4, t * mandibleLength, 0);
             tooth.rotation.z = -side * Math.PI * 0.5;
             mandible.add(tooth);
           }
         }

         mandible.userData.side = side;
         mandible.userData.baseRotationZ = mandible.rotation.z;
         this.jawsGroup.add(mandible);
       }

       // Store for animation
       this.jawsGroup.userData.left = this.jawsGroup.children[0];
       this.jawsGroup.userData.right = this.jawsGroup.children[1];
     }
     
     // === EYES - Properly embedded in head ===
     if (this.phenotype.sensors.eyeSize > 0.3 && this.eyesGroup.children.length === 0) {
       const eyeSize = (0.12 + this.phenotype.sensors.eyeSize * 0.18) * baseScale;

       for (let side = -1; side <= 1; side += 2) {
         // Eye socket (slight indent in body color)
         const socketGeo = new THREE.SphereGeometry(eyeSize * 1.2, 12, 12, 0, Math.PI * 2, 0, Math.PI * 0.6);
         const socketMat = new THREE.MeshStandardMaterial({
           color: this.bodyMesh.material.color.clone().multiplyScalar(0.85),
           roughness: 0.7
         });
         const socket = new THREE.Mesh(socketGeo, socketMat);

         // Eyeball
         const eyeGeo = new THREE.SphereGeometry(eyeSize, 16, 16);
         const eyeMat = new THREE.MeshStandardMaterial({
           color: 0xf8f8f5,
           roughness: 0.2,
           metalness: 0.1
         });
         const eye = new THREE.Mesh(eyeGeo, eyeMat);

         // Iris
         const irisGeo = new THREE.CircleGeometry(eyeSize * 0.5, 16);
         const irisColor = new THREE.Color().setHSL(Math.random() * 0.2 + 0.05, 0.7, 0.4);
         const irisMat = new THREE.MeshStandardMaterial({
           color: irisColor,
           roughness: 0.3
         });
         const iris = new THREE.Mesh(irisGeo, irisMat);
         iris.position.z = eyeSize * 0.95;
         eye.add(iris);

         // Pupil
         const pupilGeo = new THREE.CircleGeometry(eyeSize * 0.25, 12);
         const pupilMat = new THREE.MeshStandardMaterial({ color: 0x050505 });
         const pupil = new THREE.Mesh(pupilGeo, pupilMat);
         pupil.position.z = eyeSize * 0.96;
         eye.add(pupil);

         // Specular highlight
         const highlightGeo = new THREE.CircleGeometry(eyeSize * 0.12, 8);
         const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
         const highlight = new THREE.Mesh(highlightGeo, highlightMat);
         highlight.position.set(eyeSize * 0.2, eyeSize * 0.2, eyeSize * 0.97);
         eye.add(highlight);

         // Position eye on front-side of head
         const eyeAngle = side * 0.4; // Angle from center
         const eyeX = side * 0.35 * bodyScale.x;
         const eyeY = 0.25 * bodyScale.y;
         const eyeZ = 0.85 * bodyScale.z;

         socket.position.set(eyeX, eyeY, eyeZ);
         socket.rotation.x = -0.3;
         socket.rotation.y = side * 0.2;

         eye.position.set(eyeX, eyeY, eyeZ + eyeSize * 0.3);
         eye.rotation.y = side * 0.15; // Slight outward look

         this.eyesGroup.add(socket);
         this.eyesGroup.add(eye);
       }
     }
     
     // === ANTENNAE ===
     if (this.phenotype.sensors.antennaSize > 0.25 && this.antennaeGroup.children.length === 0) {
       const antennaLength = (0.5 + this.phenotype.sensors.antennaSize * 1.0) * baseScale;
       const segments = 6;
       
       for (let side = -1; side <= 1; side += 2) {
         const antennaGroup = new THREE.Group();
         
         for (let i = 0; i < segments; i++) {
           const segmentLength = antennaLength / segments;
           const segmentWidth = 0.03 * baseScale * (1 - i / segments * 0.6);
           
           const segmentGeo = new THREE.CylinderGeometry(segmentWidth, segmentWidth * 0.85, segmentLength, 6);
           const segmentMat = new THREE.MeshStandardMaterial({ color: 0x5a5a5a });
           
           const segment = new THREE.Mesh(segmentGeo, segmentMat);
           segment.position.y = i * segmentLength;
           segment.rotation.x = i * 0.12;
           
           antennaGroup.add(segment);
         }
         
         // Position on surface
         antennaGroup.position.set(
           side * 0.3 * bodyScale.x,
           0.5 * bodyScale.y,
           0.6 * bodyScale.z
         );
         
         // Push to surface
         // Simple approximation
         antennaGroup.position.normalize().multiply(new THREE.Vector3(bodyScale.x, bodyScale.y, bodyScale.z));
         
         antennaGroup.rotation.z = side * Math.PI / 5;
         antennaGroup.rotation.x = -Math.PI / 6;
         
         // Store for animation
         antennaGroup.userData.initialRotation = antennaGroup.rotation.clone();
         antennaGroup.userData.side = side;
         
         this.antennaeGroup.add(antennaGroup);
       }
     }
  }

  animate(time) {
    // Idle animations
    
    // Breathing (scale body slightly)
    // IMPORTANT: We must use the BASE scale, not multiply current scale
    // But we don't have easy access to base scale here without recalculating
    // So we'll just pulse the mesh.scale relative to 1.0 (assuming it was reset)
    // Wait, updateVisuals sets the scale. 
    // If we modify it here, next frame we modify it again... it will drift or explode.
    // We need to store the base scale.
    
    if (!this.userData) this.userData = {};
    if (!this.userData.baseScale && this.bodyMesh) {
        this.userData.baseScale = this.bodyMesh.scale.clone();
    }
    
    if (this.userData.baseScale) {
        const breathe = 1 + Math.sin(time * 2) * 0.02;
        this.bodyMesh.scale.copy(this.userData.baseScale).multiplyScalar(breathe);
    }
    
    // Limb movement (idle sway)
    if (this.limbsGroup.children.length > 0) {
        this.limbsGroup.children.forEach(limb => {
            if (limb.userData.initialRotation) {
                // Leg/Fin Sway
                const sway = Math.sin(time * 4 + (limb.userData.pairIndex || 0)) * 0.15;
                const side = limb.userData.side || 1;

                limb.rotation.z = limb.userData.initialRotation.z + sway * 0.3 * side;
                limb.rotation.x = limb.userData.initialRotation.x + sway * 0.2;

                // Claw Pinching (if it has children pincers)
                if (limb.children.length > 3 && limb.userData.isClaw) {
                     const pinch = (Math.sin(time * 3) + 1) * 0.1;
                     // Find pincers (last two children)
                     const lastIdx = limb.children.length - 1;
                     limb.children[lastIdx - 1].rotation.z = -0.2 - pinch;
                     limb.children[lastIdx].rotation.z = 0.2 + pinch;
                }
            }
        });
    }
    
    // Tail swishing
    if (this.tailGroup.children.length > 0) {
        const tail = this.tailGroup.children[0];
        tail.rotation.y = Math.sin(time * 4) * 0.4; // Increased amp
    }
    
    // Antennae twitching
    if (this.antennaeGroup.children.length > 0) {
        this.antennaeGroup.children.forEach(ant => {
            if (ant.userData.initialRotation) {
                const twitch = Math.sin(time * 10 + ant.userData.side) * 0.1; // Faster and larger
                ant.rotation.z = ant.userData.initialRotation.z + twitch;
            }
        });
    }
    
    // Mandible animation - open/close like pincers
    if (this.jawsGroup.userData.left && this.jawsGroup.userData.right) {
        const open = (Math.sin(time * 2) + 1) * 0.15; // 0 to 0.3
        const left = this.jawsGroup.userData.left;
        const right = this.jawsGroup.userData.right;
        // Mandibles spread apart when opening
        left.rotation.z = left.userData.baseRotationZ - open;
        right.rotation.z = right.userData.baseRotationZ + open;
    }
  }

  applyForce(force) {
    // F = ma -> a = F/m
    force.divideScalar(this.mass);
    this.acceleration.add(force);
  }

  die() {
    this.dead = true;
    this.mesh.visible = false; 
  }
}
