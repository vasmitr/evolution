import * as THREE from 'three';
import { DNA } from './DNA.js';
import { GENE_DEFINITIONS } from './Constants.js';

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
    this.camouflage = this.dna.getGene('camouflage');
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

    // Derived stats
    this.maxSpeed = 0.5 + (this.speed * 2); // Base 0.5, max 2.5
    this.maxForce = 0.05 + (this.maneuverability * 0.1); // Turning speed
    this.mass = 1 + (this.size * 5) + (this.armor * 2);
    
    // Update mesh scale/appearance
    const scale = 0.5 + (this.size * 1.5);
    this.mesh.scale.set(scale, scale, scale);
    
    // Update color based on traits (Toxicity = Red/Yellow, Camouflage = adapts later)
    if (this.bodyMesh) {
      if (this.toxicity > 0.5) {
        this.bodyMesh.material.color.setHSL(0, 1, 0.5); // Red warning
      } else {
        // Default or camouflage logic will override this in update
        this.bodyMesh.material.color.setHSL(0.3, 0.5, 0.5); // Greenish
      }
    }
    
    this.updateVisuals();
  }

  createMesh() {
    // Body shape depends on maneuverability
    // Low maneuverability = Sphere/Blocky
    // High maneuverability = Elongated/Cone
    
    const geometry = new THREE.SphereGeometry(1, 16, 16);
    // Deform based on maneuverability (elongate)
    // We'll do this simply by scaling the sphere in Z direction in updateFromGenes or here
    // But geometry modification is expensive, better to use scale on a specific axis?
    // Let's stick to a base sphere for now and modify it.
    
    const material = new THREE.MeshStandardMaterial({ 
      color: 0x00ff00,
      roughness: 0.7,
      metalness: 0.1
    });
    
    this.bodyMesh = new THREE.Mesh(geometry, material);
    this.mesh.add(this.bodyMesh);
    
    // Armor mesh (slightly larger)
    const armorGeo = new THREE.IcosahedronGeometry(1.1, 1);
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x555555,
      wireframe: true,
      transparent: true,
      opacity: 0
    });
    this.armorMesh = new THREE.Mesh(armorGeo, armorMat);
    this.mesh.add(this.armorMesh);
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
    
    // Limbs Trade-off
    if (this.position.y < 0) {
      // Water: Limbs cause drag
      moveCost *= (1 + this.limbs * 0.5);
    } else {
      // Land: Limbs help movement (reduce cost)
      moveCost *= (1 - this.limbs * 0.5);
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

  createMesh() {
    // Body shape depends on maneuverability
    // Low maneuverability = Sphere/Blocky
    // High maneuverability = Elongated/Cone
    
    let geometry;
    if (this.maneuverability > 0.7) {
      geometry = new THREE.ConeGeometry(0.8, 2, 16);
      geometry.rotateX(Math.PI / 2);
    } else if (this.maneuverability < 0.3) {
      geometry = new THREE.BoxGeometry(1.5, 1, 1);
    } else {
      geometry = new THREE.SphereGeometry(1, 16, 16);
    }
    
    const material = new THREE.MeshStandardMaterial({ 
      color: 0x00ff00,
      roughness: 0.7,
      metalness: 0.1
    });
    
    this.bodyMesh = new THREE.Mesh(geometry, material);
    this.mesh.add(this.bodyMesh);
    
    // Armor/Shell (Spikes)
    // We'll add a group of spikes if armor is high
    this.armorGroup = new THREE.Group();
    this.mesh.add(this.armorGroup);
    
    // Cold Resistance (Fur/Blubber)
    // We'll add a shell for blubber or particles for fur. 
    // Let's use a slightly larger transparent shell for blubber/fur visual
    this.coldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.05, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0 })
    );
    this.mesh.add(this.coldMesh);
    
    // Limbs Group
    this.limbsGroup = new THREE.Group();
    this.mesh.add(this.limbsGroup);
    
    // Jaws Group
    this.jawsGroup = new THREE.Group();
    this.mesh.add(this.jawsGroup);
  }
  
  updateVisuals() {
     // Dynamic updates that might change with genes if we allowed gene changes (we don't really, but good for init)
     // Armor Spikes
     if (this.armor > 0.3 && this.armorGroup.children.length === 0) {
       const spikeGeo = new THREE.ConeGeometry(0.1, 0.5, 4);
       const spikeMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
       
       for (let i = 0; i < 8; i++) {
         const spike = new THREE.Mesh(spikeGeo, spikeMat);
         spike.position.set(
           (Math.random() - 0.5) * 2,
           (Math.random() - 0.5) * 2,
           (Math.random() - 0.5) * 2
         ).normalize().multiplyScalar(1.1);
         spike.lookAt(0,0,0);
         this.armorGroup.add(spike);
       }
     }
     
     // Cold Resistance
     if (this.coldResistance > 0.5) {
       this.coldMesh.material.opacity = 0.3 + (this.coldResistance - 0.5);
       this.coldMesh.scale.setScalar(1 + this.coldResistance * 0.2);
     } else {
       this.coldMesh.material.opacity = 0;
     }
     
     // Predatory (Sharp mouth/head)
     // If predatory, maybe add a red cone at front
     if (this.predatory > 0.5) {
        // Add visual cue
     }
     
     // Limbs
     if (this.limbs > 0.3 && this.limbsGroup.children.length === 0) {
       const limbGeo = new THREE.CylinderGeometry(0.1, 0.1, 1);
       const limbMat = new THREE.MeshStandardMaterial({ color: 0x00aa00 });
       
       // 4 Legs
       const positions = [
         [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5],
         [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5]
       ];
       
       positions.forEach(pos => {
         const limb = new THREE.Mesh(limbGeo, limbMat);
         limb.position.set(...pos);
         limb.rotation.x = Math.PI / 2; // Point down/out
         this.limbsGroup.add(limb);
       });
     }
     
     // Jaws
     if (this.jaws > 0.3 && this.jawsGroup.children.length === 0) {
       const jawGeo = new THREE.BoxGeometry(0.5, 0.2, 0.5);
       const jawMat = new THREE.MeshStandardMaterial({ color: 0xaa0000 }); // Red mouth
       const jaw = new THREE.Mesh(jawGeo, jawMat);
       jaw.position.set(0, 0, 1); // Front
       this.jawsGroup.add(jaw);
       
       // Teeth if very high jaws
       if (this.jaws > 0.7) {
         const toothGeo = new THREE.ConeGeometry(0.05, 0.2, 4);
         const toothMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
         const tooth = new THREE.Mesh(toothGeo, toothMat);
         tooth.position.set(0, 0.2, 1.2);
         tooth.rotation.x = -Math.PI / 4;
         this.jawsGroup.add(tooth);
       }
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
