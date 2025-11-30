import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createNoise2D } from 'simplex-noise';
import { UI } from './UI.js';
import { WORLD_SIZE, BIOMES } from './Constants.js';

// Shared geometries and materials for performance
const SharedGeometries = {
  body: {
    sphere: new THREE.IcosahedronGeometry(1, 2), // More organic
    torpedo: new THREE.CapsuleGeometry(0.4, 1.2, 4, 8),
    flat: new THREE.SphereGeometry(1, 12, 8),
  },
  eye: new THREE.SphereGeometry(0.12, 12, 12),
  iris: new THREE.CircleGeometry(0.06, 12),
  pupil: new THREE.CircleGeometry(0.03, 8),
  socket: new THREE.SphereGeometry(0.14, 8, 6),
  limb: new THREE.CylinderGeometry(0.04, 0.06, 0.3, 6),
  joint: new THREE.SphereGeometry(0.07, 6, 6),
  foot: new THREE.SphereGeometry(0.08, 6, 6),
  fin: new THREE.BoxGeometry(0.02, 0.3, 0.2),
  tailFin: new THREE.BoxGeometry(0.02, 0.25, 0.35),
  mandible: new THREE.CylinderGeometry(0.02, 0.05, 0.25, 6),
  tooth: new THREE.ConeGeometry(0.02, 0.06, 3),
  spike: new THREE.ConeGeometry(0.04, 0.2, 4),
  carapace: new THREE.SphereGeometry(1.05, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6),
  probe: new THREE.CylinderGeometry(0.03, 0.015, 0.5, 4),
  // Emergent feature geometries
  horn: new THREE.ConeGeometry(0.08, 0.4, 6),
  tailSegment: new THREE.CylinderGeometry(0.06, 0.04, 0.2, 6),
  // LOD geometry for distant creatures
  lodSphere: new THREE.IcosahedronGeometry(1, 1), // Lower poly for LOD
};

// LOD Configuration
const LOD_CONFIG = {
  detailDistance: 80,    // Full detail within this distance
  lodDistance: 250,      // LOD spheres between detail and this distance
  cullDistance: 500,     // Don't render beyond this
  maxDetailedCreatures: 100, // Max creatures with full detail at once
  poolSize: 150,         // Size of creature renderer pool
};

// Shared materials cache for creatures (reduces material instances)
const SharedMaterials = {
  cache: new Map(),

  getBodyMaterial(hue, saturation, lightness, hasPattern = false) {
    // For non-patterned materials, cache and reuse
    if (!hasPattern) {
      // Quantize colors to reduce unique materials
      const qHue = Math.round(hue * 20) / 20;
      const qSat = Math.round(saturation * 10) / 10;
      const qLight = Math.round(lightness * 10) / 10;
      const key = `body_${qHue}_${qSat}_${qLight}`;

      if (!this.cache.has(key)) {
        const color = new THREE.Color().setHSL(qHue, qSat, qLight);
        this.cache.set(key, new THREE.MeshStandardMaterial({
          color,
          roughness: 0.6,
          metalness: 0.05
        }));
      }
      return this.cache.get(key);
    }
    // Patterned materials need to be unique (shader uniforms)
    return null;
  },

  getLimbMaterial(baseColor) {
    const key = `limb_${baseColor.getHexString()}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, new THREE.MeshStandardMaterial({
        color: baseColor.clone().multiplyScalar(0.7),
        roughness: 0.7
      }));
    }
    return this.cache.get(key);
  }
};

// Rendering-only creature (mesh wrapper)
class CreatureRenderer {
  constructor(data) {
    this.id = data.id;
    this.data = data;
    this.animTime = 0;
    this.isEating = false;
    this.eatingTimer = 0;

    this.mesh = new THREE.Group();
    this.createMesh(data);
  }

  createMesh(data) {
    // Determine body color based on primary trait
    const bodyColor = this.getBodyColor(data);
    const pattern = this.getFoodHabitPattern(data);

    // Create body material - use shader if pattern exists
    let bodyMat;
    if (pattern) {
      bodyMat = this.createPatternMaterial(bodyColor, pattern);
    } else {
      bodyMat = new THREE.MeshStandardMaterial({
        color: bodyColor,
        roughness: 0.6,
        metalness: 0.05
      });
    }

    // Body shape - organic icosahedron base
    let bodyGeo;
    if (data.speed > 0.5) {
      bodyGeo = SharedGeometries.body.torpedo;
    } else if (data.filterFeeding > 0.4) {
      bodyGeo = SharedGeometries.body.flat;
    } else {
      bodyGeo = SharedGeometries.body.sphere;
    }

    this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    if (data.speed > 0.5) {
      this.bodyMesh.rotation.x = Math.PI / 2; // Point forward
    }
    this.mesh.add(this.bodyMesh);

    // Scale based on size with slight elongation
    const scale = 0.8 + data.size * 1.2;
    const lengthRatio = 1.0 + data.speed * 0.3; // Faster = more elongated
    this.mesh.scale.set(scale, scale * 0.9, scale * lengthRatio);

    // Create feature groups
    this.eyesGroup = new THREE.Group();
    this.limbsGroup = new THREE.Group();
    this.finsGroup = new THREE.Group();
    this.jawsGroup = new THREE.Group();
    this.armorGroup = new THREE.Group();
    this.emergentGroup = new THREE.Group(); // For emergent features

    this.mesh.add(this.eyesGroup);
    this.mesh.add(this.limbsGroup);
    this.mesh.add(this.finsGroup);
    this.mesh.add(this.jawsGroup);
    this.mesh.add(this.armorGroup);
    this.mesh.add(this.emergentGroup);

    // Store body color for limbs
    this.bodyColor = bodyColor;

    // Build features
    this.buildEyes(data);
    this.buildLimbs(data, bodyColor);
    this.buildFins(data);
    this.buildJaws(data);
    this.buildArmor(data);
    this.buildSpecialFeatures(data);
    this.buildEmergentFeatures(data, bodyColor);
  }

  getBodyColor(data) {
    // Color is now freely determined by color genes
    // colorHue gene: 0-1 maps to full hue spectrum
    // colorSaturation gene: 0-1 maps to saturation
    // Toxicity still affects brightness for warning coloration (aposematism)
    const hue = data.colorHue || 0.33; // Default to green if gene not present
    const baseSaturation = 0.3 + (data.colorSaturation || 0.5) * 0.5; // 0.3-0.8
    const baseLightness = 0.35 + (data.colorSaturation || 0.5) * 0.15; // 0.35-0.5

    // Toxic creatures get brighter, more saturated colors (warning coloration)
    // This is still biologically meaningful - bright colors warn predators
    let saturation = baseSaturation;
    let lightness = baseLightness;
    if (data.toxicity > 0.4) {
      saturation = Math.min(saturation + data.toxicity * 0.3, 1.0);
      lightness = Math.min(lightness + data.toxicity * 0.2, 0.6);
    }

    return new THREE.Color().setHSL(hue, saturation, lightness);
  }

  // Get pattern color for food habit markings
  getFoodHabitPattern(data) {
    // Determine dominant food habit
    if (data.predatory > 0.4) {
      return { type: 'stripes', color: new THREE.Color(0xcc2222), intensity: data.predatory }; // Red stripes for predators
    }
    if (data.parasitic > 0.3) {
      return { type: 'spots', color: new THREE.Color(0x9944aa), intensity: data.parasitic }; // Purple spots for parasites
    }
    if (data.scavenging > 0.4) {
      return { type: 'patches', color: new THREE.Color(0x886644), intensity: data.scavenging }; // Brown patches for scavengers
    }
    if (data.filterFeeding > 0.4) {
      return { type: 'waves', color: new THREE.Color(0x4488cc), intensity: data.filterFeeding }; // Blue waves for filter feeders
    }
    // Herbivores - no pattern (or subtle green)
    return null;
  }

  // Create shader material with pattern on body surface
  createPatternMaterial(bodyColor, pattern) {
    // Custom shader for procedural patterns on body surface
    const vertexShader = `
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec2 vUv;

      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPosition = position;
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    // Fragment shader with different pattern types
    const fragmentShader = `
      uniform vec3 baseColor;
      uniform vec3 patternColor;
      uniform float patternIntensity;
      uniform int patternType; // 0=stripes, 1=spots, 2=patches, 3=waves
      uniform float time;
      uniform float seed;

      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec2 vUv;

      // Simple noise function
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      // 3D noise for volumetric patterns
      float noise3D(vec3 p) {
        return noise(p.xy + p.z * 17.0);
      }

      void main() {
        vec3 color = baseColor;
        float patternMask = 0.0;

        // Use position for pattern mapping (works well for spheres)
        vec3 pos = normalize(vPosition);

        if (patternType == 0) {
          // STRIPES - tiger/wasp like bands along body
          float stripeFreq = 4.0 + patternIntensity * 6.0; // More stripes with higher intensity
          float stripe = sin(pos.z * stripeFreq * 3.14159 + seed);
          // Add some noise for organic feel
          stripe += noise(pos.xy * 10.0 + seed) * 0.3;
          patternMask = smoothstep(0.3, 0.5, stripe);

        } else if (patternType == 1) {
          // SPOTS - leopard/poison frog like spots
          float spotScale = 6.0 + patternIntensity * 4.0;
          vec2 spotUV = vec2(atan(pos.x, pos.z), pos.y) * spotScale;

          // Create spots using cellular noise approximation
          vec2 cell = floor(spotUV + seed);
          vec2 cellOffset = fract(spotUV + seed);

          float minDist = 1.0;
          for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
              vec2 neighbor = vec2(float(x), float(y));
              vec2 point = hash(cell + neighbor + seed) * 0.5 + 0.25 + neighbor;
              float dist = length(cellOffset - point);
              minDist = min(minDist, dist);
            }
          }

          float spotSize = 0.2 + patternIntensity * 0.15;
          patternMask = 1.0 - smoothstep(spotSize * 0.5, spotSize, minDist);

        } else if (patternType == 2) {
          // PATCHES - hyena/vulture like irregular patches
          float patchScale = 3.0 + patternIntensity * 2.0;
          vec2 patchUV = vec2(atan(pos.x, pos.z), pos.y) * patchScale;

          // Layered noise for irregular patches
          float n1 = noise(patchUV + seed);
          float n2 = noise(patchUV * 2.0 + seed + 100.0) * 0.5;
          float n3 = noise(patchUV * 4.0 + seed + 200.0) * 0.25;
          float patchNoise = n1 + n2 + n3;

          // Create patches with threshold
          float threshold = 0.8 - patternIntensity * 0.3;
          patternMask = smoothstep(threshold, threshold + 0.2, patchNoise);

        } else if (patternType == 3) {
          // WAVES - flowing wave pattern for filter feeders
          float waveFreq = 3.0 + patternIntensity * 4.0;
          vec2 waveUV = vec2(atan(pos.x, pos.z), pos.y);

          // Flowing waves with noise distortion
          float wave = sin(waveUV.y * waveFreq * 3.14159 + waveUV.x * 2.0 + seed);
          wave += noise(waveUV * 5.0 + seed) * 0.4;

          // Create wavy bands
          patternMask = smoothstep(0.2, 0.4, abs(wave)) * (1.0 - smoothstep(0.4, 0.6, abs(wave)));
        }

        // Mix base color with pattern color
        color = mix(baseColor, patternColor, patternMask * patternIntensity);

        // Simple lighting
        vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
        float diff = max(dot(vNormal, lightDir), 0.0);
        float ambient = 0.4;
        float lighting = ambient + diff * 0.6;

        gl_FragColor = vec4(color * lighting, 1.0);
      }
    `;

    // Create shader material
    const material = new THREE.ShaderMaterial({
      uniforms: {
        baseColor: { value: bodyColor },
        patternColor: { value: pattern.color },
        patternIntensity: { value: pattern.intensity },
        patternType: { value: pattern.type === 'stripes' ? 0 : pattern.type === 'spots' ? 1 : pattern.type === 'patches' ? 2 : 3 },
        time: { value: 0 },
        seed: { value: Math.random() * 100 }
      },
      vertexShader,
      fragmentShader
    });

    return material;
  }


  buildEyes(data) {
    if (data.sight < 0.15) return; // No visible eyes for blind creatures

    const eyeScale = 0.7 + data.sight * 0.5;

    // Position eyes ON the body surface (body radius is ~1)
    const eyeSpacing = 0.35;
    const eyeForward = 0.92;  // On front surface
    const eyeHeight = 0.25;

    const eyeWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xf8f8f5,
      roughness: 0.2,
      metalness: 0.1
    });

    // Random iris color
    const irisHue = Math.random() * 0.2 + 0.05;
    const irisMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(irisHue, 0.7, 0.4),
      roughness: 0.3
    });

    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x050505 });
    const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    [-1, 1].forEach((side) => {
      // Calculate position on body surface
      const eyeX = side * eyeSpacing;
      const eyeY = eyeHeight;
      const eyeZ = eyeForward;

      // Normalize to push onto sphere surface and then out a bit
      const len = Math.sqrt(eyeX*eyeX + eyeY*eyeY + eyeZ*eyeZ);
      const surfaceX = eyeX / len * 1.02;
      const surfaceY = eyeY / len * 1.02;
      const surfaceZ = eyeZ / len * 1.02;

      // Eyeball - sits on surface
      const eye = new THREE.Mesh(SharedGeometries.eye, eyeWhiteMat);
      eye.position.set(surfaceX, surfaceY, surfaceZ);
      eye.scale.setScalar(eyeScale);
      this.eyesGroup.add(eye);

      // Iris (on front of eyeball)
      const iris = new THREE.Mesh(SharedGeometries.iris, irisMat);
      iris.position.set(surfaceX, surfaceY, surfaceZ + 0.1 * eyeScale);
      iris.scale.setScalar(eyeScale);
      this.eyesGroup.add(iris);

      // Pupil
      const pupil = new THREE.Mesh(SharedGeometries.pupil, pupilMat);
      pupil.position.set(surfaceX, surfaceY, surfaceZ + 0.105 * eyeScale);
      pupil.scale.setScalar(eyeScale);
      pupil.userData.baseX = surfaceX;
      this.eyesGroup.add(pupil);

      // Specular highlight
      const highlight = new THREE.Mesh(SharedGeometries.pupil, highlightMat);
      highlight.position.set(
        surfaceX + 0.02 * eyeScale,
        surfaceY + 0.02 * eyeScale,
        surfaceZ + 0.11 * eyeScale
      );
      highlight.scale.setScalar(eyeScale * 0.4);
      this.eyesGroup.add(highlight);
    });
  }

  buildLimbs(data, bodyColor) {
    // Gene VALUE controls SIZE (0=none, 1=big limbs)
    // Gene VARIATIVENESS controls TYPE (fins for aquatic, legs for land, claws for predation)

    const limbValue = data.limbs;  // Controls SIZE
    const limbVariativeness = data.limbsVariativeness || 0.5;  // Controls TYPE (default to legs)

    if (limbValue < 0.15) return;  // No limbs for low value

    // SIZE based on gene VALUE
    const limbScale = 0.3 + limbValue * 1.0;  // 0.3 to 1.3 scale factor
    const limbLength = 0.25 + limbValue * 0.4;  // Scales with value

    // Number of limbs scales with value too
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

    const limbColor = bodyColor.clone().multiplyScalar(0.7);
    const limbMat = new THREE.MeshStandardMaterial({
      color: limbColor,
      roughness: 0.7
    });

    for (let i = 0; i < limbCount; i++) {
      const pairIndex = Math.floor(i / 2);
      const side = (i % 2 === 0) ? -1 : 1;
      const zOffset = 0.15 - pairIndex * 0.25;

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

        // Use existing fin geometry scaled by limb value
        const fin = new THREE.Mesh(SharedGeometries.fin, finMat);
        fin.scale.set(1, limbScale * 1.5, limbScale * 1.2);
        limbGroup.add(fin);

        // Position fins on sides
        limbGroup.position.set(side * 0.9, 0, zOffset);
        limbGroup.rotation.z = side * 0.8;
        limbGroup.rotation.y = side * 0.3;

      } else if (limbType === 'claw') {
        // === CLAWS - Pincers for predation ===
        // Socket
        const socket = new THREE.Mesh(SharedGeometries.joint, limbMat);
        socket.scale.setScalar(limbScale * 1.2);
        limbGroup.add(socket);

        // Upper arm
        const upperArm = new THREE.Mesh(SharedGeometries.limb, limbMat);
        upperArm.scale.set(limbScale * 1.1, limbLength * 1.2, limbScale * 1.1);
        upperArm.position.y = -limbLength * 0.2;
        limbGroup.add(upperArm);

        // Forearm
        const forearm = new THREE.Mesh(SharedGeometries.limb, limbMat);
        forearm.scale.set(limbScale * 0.9, limbLength * 1.0, limbScale * 0.9);
        forearm.position.y = -limbLength * 0.55;
        limbGroup.add(forearm);

        // Pincer claws
        const pincerMat = limbMat.clone();
        pincerMat.color.multiplyScalar(0.75);

        const pincer1 = new THREE.Mesh(SharedGeometries.spike, pincerMat);
        pincer1.scale.setScalar(limbScale * 1.5);
        pincer1.position.set(0.08 * limbScale, -limbLength * 0.85, 0);
        pincer1.rotation.z = -0.3;
        pincer1.rotation.x = Math.PI;
        limbGroup.add(pincer1);

        const pincer2 = new THREE.Mesh(SharedGeometries.spike, pincerMat);
        pincer2.scale.setScalar(limbScale * 1.5);
        pincer2.position.set(-0.08 * limbScale, -limbLength * 0.85, 0);
        pincer2.rotation.z = 0.3;
        pincer2.rotation.x = Math.PI;
        limbGroup.add(pincer2);

        limbGroup.userData.isClaw = true;

        // Position claws on lower sides
        const attachX = side * 0.95;
        const attachY = -0.25;
        const len = Math.sqrt(attachX*attachX + attachY*attachY + zOffset*zOffset);
        limbGroup.position.set(attachX / len, attachY / len, zOffset / len);
        limbGroup.rotation.z = side * 0.5;
        limbGroup.rotation.x = 0.2;

      } else {
        // === LEGS - Jointed for land locomotion (default) ===
        // Socket
        const socket = new THREE.Mesh(SharedGeometries.joint, limbMat);
        socket.scale.set(limbScale * 1.1, limbScale * 0.9, limbScale * 1.1);
        limbGroup.add(socket);

        // Thigh
        const thigh = new THREE.Mesh(SharedGeometries.limb, limbMat);
        thigh.scale.set(limbScale * 1.1, limbLength * 1.4, limbScale * 1.1);
        thigh.position.y = -limbLength * 0.2;
        limbGroup.add(thigh);

        // Knee
        const knee = new THREE.Mesh(SharedGeometries.joint, limbMat);
        knee.scale.setScalar(limbScale * 0.85);
        knee.position.y = -limbLength * 0.42;
        limbGroup.add(knee);

        // Shin
        const shin = new THREE.Mesh(SharedGeometries.limb, limbMat);
        shin.scale.set(limbScale * 0.85, limbLength * 1.3, limbScale * 0.85);
        shin.position.y = -limbLength * 0.65;
        limbGroup.add(shin);

        // Foot
        const foot = new THREE.Mesh(SharedGeometries.foot, limbMat);
        foot.position.y = -limbLength * 0.9;
        foot.scale.set(limbScale * 1.3, limbScale * 0.5, limbScale * 1.5);
        limbGroup.add(foot);

        // Position legs on lower sides of body
        const attachX = side * 0.95;
        const attachY = -0.3;
        const len = Math.sqrt(attachX*attachX + attachY*attachY + zOffset*zOffset);
        limbGroup.position.set(attachX / len, attachY / len, zOffset / len);
        limbGroup.rotation.z = side * 0.6;
        limbGroup.rotation.x = 0.25;
      }

      limbGroup.userData.side = side;
      limbGroup.userData.pairIndex = pairIndex;
      limbGroup.userData.limbType = limbType;
      limbGroup.userData.initialRotation = limbGroup.rotation.clone();

      this.limbsGroup.add(limbGroup);
    }
  }

  buildFins(data) {
    if (data.speed < 0.25 || data.limbs > 0.5) return; // No fins if has limbs

    const finMat = new THREE.MeshStandardMaterial({
      color: 0x4488aa,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });

    // Dorsal fin (top)
    const dorsalFin = new THREE.Mesh(SharedGeometries.fin, finMat);
    dorsalFin.position.set(0, 0.7, 0);
    dorsalFin.scale.y = 0.5 + data.speed * 0.8;
    this.finsGroup.add(dorsalFin);

    // Tail fin
    const tailFin = new THREE.Mesh(SharedGeometries.tailFin, finMat);
    tailFin.position.set(0, 0, -1.0);
    tailFin.scale.set(1, 0.8 + data.speed * 0.5, 1);
    this.finsGroup.add(tailFin);

    // Side fins (pectoral)
    [-1, 1].forEach((side) => {
      const sideFin = new THREE.Mesh(SharedGeometries.fin, finMat);
      sideFin.position.set(side * 0.5, 0, 0.2);
      sideFin.rotation.z = side * 0.8;
      sideFin.rotation.y = side * 0.3;
      sideFin.scale.set(1, 0.6, 1.2);
      this.finsGroup.add(sideFin);
    });
  }

  buildJaws(data) {
    if (data.jaws < 0.2) return;

    const jawValue = data.jaws;  // Controls SIZE
    const jawVariativeness = data.jawsVariativeness || 0.5;  // Controls TYPE

    // TYPE based on diet specialization first, then gene VARIATIVENESS
    // Priority: parasitic > scavenging > variativeness-based
    // Parasitic: PROBOSCIS - needle/tube for fluid extraction
    // Scavenger: CARRION - robust bone-crushing/tearing jaws
    // Low variativeness (0-0.33): FILTER/GRAZER - baleen-like
    // Medium variativeness (0.33-0.66): MANDIBLES - general pincers
    // High variativeness (0.66-1.0): FANGS - apex predator teeth
    let jawType;
    if (data.parasitic > 0.35) {
      jawType = 'proboscis';
    } else if (data.scavenging > 0.4) {
      jawType = 'carrion';
    } else if (jawVariativeness < 0.33) {
      jawType = 'filter';
    } else if (jawVariativeness < 0.66) {
      jawType = 'mandible';
    } else {
      jawType = 'fangs';
    }

    const jawScale = 0.6 + jawValue * 0.8;
    this.jawsGroup.userData.jawType = jawType;

    if (jawType === 'filter') {
      // === FILTER/GRAZER MOUTH ===
      // Wide, flat mouth with baleen-like structures or grinding plates
      const mouthMat = new THREE.MeshStandardMaterial({
        color: 0x554433,
        roughness: 0.6
      });

      // Wide mouth opening
      const mouthGeo = new THREE.TorusGeometry(0.15 * jawScale, 0.04 * jawScale, 8, 12, Math.PI);
      const mouth = new THREE.Mesh(mouthGeo, mouthMat);
      mouth.position.set(0, -0.15, 0.95);
      mouth.rotation.x = Math.PI / 2;
      mouth.rotation.z = Math.PI;
      this.jawsGroup.add(mouth);

      // Baleen/filter plates or grinding ridges
      const plateMat = new THREE.MeshStandardMaterial({
        color: 0x776655,
        roughness: 0.8
      });

      const plateCount = Math.floor(4 + jawValue * 6);
      for (let i = 0; i < plateCount; i++) {
        const plateGeo = new THREE.BoxGeometry(0.02, 0.08 * jawScale, 0.01);
        const plate = new THREE.Mesh(plateGeo, plateMat);
        const angle = (i / plateCount - 0.5) * Math.PI * 0.8;
        plate.position.set(
          Math.sin(angle) * 0.12 * jawScale,
          -0.2,
          0.95 + Math.cos(angle) * 0.05
        );
        plate.rotation.z = angle * 0.3;
        plate.userData.plateIndex = i;
        this.jawsGroup.add(plate);
      }

      // Store for animation
      this.jawsGroup.userData.isFilter = true;

    } else if (jawType === 'fangs') {
      // === FANGS/TEETH ===
      // Sharp predatory teeth in an open jaw
      const jawBoneMat = new THREE.MeshStandardMaterial({
        color: 0x443322,
        roughness: 0.5
      });
      const toothMat = new THREE.MeshStandardMaterial({
        color: 0xeeeedd,
        roughness: 0.3
      });

      // Upper jaw
      const upperJawGeo = new THREE.BoxGeometry(0.25 * jawScale, 0.06 * jawScale, 0.15 * jawScale);
      const upperJaw = new THREE.Mesh(upperJawGeo, jawBoneMat);
      upperJaw.position.set(0, 0.05, 0.95);
      upperJaw.userData.isUpperJaw = true;
      upperJaw.userData.baseY = 0.05;
      this.jawsGroup.add(upperJaw);

      // Lower jaw
      const lowerJawGeo = new THREE.BoxGeometry(0.22 * jawScale, 0.05 * jawScale, 0.14 * jawScale);
      const lowerJaw = new THREE.Mesh(lowerJawGeo, jawBoneMat);
      lowerJaw.position.set(0, -0.12, 0.93);
      lowerJaw.userData.isLowerJaw = true;
      lowerJaw.userData.baseY = -0.12;
      lowerJaw.userData.baseRotX = 0;
      this.jawsGroup.add(lowerJaw);

      // Add teeth to upper jaw
      const upperToothCount = Math.floor(3 + jawValue * 4);
      for (let i = 0; i < upperToothCount; i++) {
        const tooth = new THREE.Mesh(SharedGeometries.tooth, toothMat);
        const t = (i / (upperToothCount - 1)) - 0.5;
        tooth.position.set(t * 0.2 * jawScale, -0.04 * jawScale, 0.05 * jawScale);
        tooth.rotation.x = Math.PI;
        tooth.scale.setScalar(0.8 + jawValue * 0.4);
        // Larger fangs at front
        if (Math.abs(t) < 0.2) tooth.scale.y *= 1.5;
        upperJaw.add(tooth);
      }

      // Add teeth to lower jaw
      const lowerToothCount = Math.floor(2 + jawValue * 3);
      for (let i = 0; i < lowerToothCount; i++) {
        const tooth = new THREE.Mesh(SharedGeometries.tooth, toothMat);
        const t = (i / (lowerToothCount - 1)) - 0.5;
        tooth.position.set(t * 0.18 * jawScale, 0.03 * jawScale, 0.04 * jawScale);
        tooth.scale.setScalar(0.6 + jawValue * 0.3);
        lowerJaw.add(tooth);
      }

      // Store for animation
      this.jawsGroup.userData.upperJaw = upperJaw;
      this.jawsGroup.userData.lowerJaw = lowerJaw;
      this.jawsGroup.userData.isFangs = true;

    } else if (jawType === 'proboscis') {
      // === PROBOSCIS (Parasitic) ===
      // Long needle-like tube for piercing and extracting fluids
      const proboscisMat = new THREE.MeshStandardMaterial({
        color: 0x662266, // Purple tint for parasites
        roughness: 0.3,
        metalness: 0.2
      });

      // Main proboscis tube - long and needle-like
      const tubeLength = 0.4 + jawValue * 0.4;
      const tubeGeo = new THREE.CylinderGeometry(0.015, 0.04, tubeLength, 8);
      const tube = new THREE.Mesh(tubeGeo, proboscisMat);
      tube.position.set(0, -0.1, 0.9);
      tube.rotation.x = Math.PI * 0.35;
      tube.userData.isProboscis = true;
      tube.userData.baseRotX = tube.rotation.x;
      tube.userData.baseZ = tube.position.z;
      this.jawsGroup.add(tube);

      // Sheath/housing at base
      const sheathMat = new THREE.MeshStandardMaterial({
        color: 0x553355,
        roughness: 0.5
      });
      const sheathGeo = new THREE.CylinderGeometry(0.06, 0.04, 0.12, 8);
      const sheath = new THREE.Mesh(sheathGeo, sheathMat);
      sheath.position.set(0, -0.05, 0.85);
      sheath.rotation.x = Math.PI * 0.3;
      this.jawsGroup.add(sheath);

      // Tiny barbs/hooks near tip for grip
      const barbMat = new THREE.MeshStandardMaterial({ color: 0x441144 });
      for (let i = 0; i < 3; i++) {
        const barbGeo = new THREE.ConeGeometry(0.01, 0.04, 4);
        const barb = new THREE.Mesh(barbGeo, barbMat);
        const angle = (i / 3) * Math.PI * 2;
        barb.position.set(
          Math.cos(angle) * 0.02,
          -tubeLength * 0.4,
          Math.sin(angle) * 0.02
        );
        barb.rotation.x = Math.PI * 0.7;
        barb.rotation.z = angle;
        tube.add(barb);
      }

      // Store for animation
      this.jawsGroup.userData.proboscis = tube;
      this.jawsGroup.userData.isProboscis = true;

    } else if (jawType === 'carrion') {
      // === CARRION JAWS (Scavenger) ===
      // Robust, powerful jaws for tearing rotted flesh and crushing bones
      const jawBoneMat = new THREE.MeshStandardMaterial({
        color: 0x553311, // Dark brown
        roughness: 0.6,
        metalness: 0.1
      });
      const toothMat = new THREE.MeshStandardMaterial({
        color: 0xccbb99, // Yellowed, worn teeth
        roughness: 0.5
      });

      // Heavy upper jaw - wider and more robust than fangs
      const upperJawGeo = new THREE.BoxGeometry(0.3 * jawScale, 0.08 * jawScale, 0.18 * jawScale);
      const upperJaw = new THREE.Mesh(upperJawGeo, jawBoneMat);
      upperJaw.position.set(0, 0.03, 0.92);
      upperJaw.userData.isUpperJaw = true;
      upperJaw.userData.baseY = 0.03;
      this.jawsGroup.add(upperJaw);

      // Powerful lower jaw - heavier, for bone crushing
      const lowerJawGeo = new THREE.BoxGeometry(0.28 * jawScale, 0.1 * jawScale, 0.16 * jawScale);
      const lowerJaw = new THREE.Mesh(lowerJawGeo, jawBoneMat);
      lowerJaw.position.set(0, -0.15, 0.9);
      lowerJaw.userData.isLowerJaw = true;
      lowerJaw.userData.baseY = -0.15;
      lowerJaw.userData.baseRotX = 0;
      this.jawsGroup.add(lowerJaw);

      // Add worn, blunt crushing teeth to upper jaw
      const upperToothCount = Math.floor(4 + jawValue * 3);
      for (let i = 0; i < upperToothCount; i++) {
        // Mix of blunt molars and worn fangs
        const isBlunt = i % 2 === 0;
        let toothGeo;
        if (isBlunt) {
          toothGeo = new THREE.BoxGeometry(0.035, 0.04 * jawScale, 0.03);
        } else {
          toothGeo = new THREE.ConeGeometry(0.02, 0.05 * jawScale, 4);
        }
        const toothMesh = new THREE.Mesh(toothGeo, toothMat);
        const t = (i / (upperToothCount - 1)) - 0.5;
        toothMesh.position.set(t * 0.24 * jawScale, -0.05 * jawScale, 0.06 * jawScale);
        if (!isBlunt) toothMesh.rotation.x = Math.PI;
        upperJaw.add(toothMesh);
      }

      // Add crushing teeth to lower jaw
      const lowerToothCount = Math.floor(3 + jawValue * 3);
      for (let i = 0; i < lowerToothCount; i++) {
        const isBlunt = i % 2 === 1;
        let toothGeo;
        if (isBlunt) {
          toothGeo = new THREE.BoxGeometry(0.04, 0.035 * jawScale, 0.035);
        } else {
          toothGeo = new THREE.ConeGeometry(0.018, 0.04 * jawScale, 4);
        }
        const toothMesh = new THREE.Mesh(toothGeo, toothMat);
        const t = (i / (lowerToothCount - 1)) - 0.5;
        toothMesh.position.set(t * 0.22 * jawScale, 0.055 * jawScale, 0.05 * jawScale);
        lowerJaw.add(toothMesh);
      }

      // Store for animation
      this.jawsGroup.userData.upperJaw = upperJaw;
      this.jawsGroup.userData.lowerJaw = lowerJaw;
      this.jawsGroup.userData.isCarrion = true;

    } else {
      // === MANDIBLES (default) ===
      // Insect-like pincers
      const mandibleMat = new THREE.MeshStandardMaterial({
        color: 0x3a2a1a,
        roughness: 0.4,
        metalness: 0.2
      });

      [-1, 1].forEach((side) => {
        const mandible = new THREE.Mesh(SharedGeometries.mandible, mandibleMat);
        mandible.position.set(side * 0.15, -0.25, 1.0);
        mandible.rotation.x = Math.PI * 0.4;
        mandible.rotation.z = -side * 0.3;
        mandible.scale.set(jawScale, jawScale * 1.2, jawScale);

        mandible.userData.side = side;
        mandible.userData.baseRotationZ = mandible.rotation.z;

        this.jawsGroup.add(mandible);

        // Add serrated teeth for strong jaws
        if (jawValue > 0.4) {
          const toothCount = Math.floor(2 + jawValue * 2);
          const toothMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0a });

          for (let i = 0; i < toothCount; i++) {
            const tooth = new THREE.Mesh(SharedGeometries.tooth, toothMat);
            const t = (i / toothCount) - 0.2;
            tooth.position.set(side * 0.03, t * 0.15, 0);
            tooth.rotation.z = -side * Math.PI * 0.4;
            tooth.scale.setScalar(0.6);
            mandible.add(tooth);
          }
        }
      });

      // Store references for animation
      this.jawsGroup.userData.left = this.jawsGroup.children[0];
      this.jawsGroup.userData.right = this.jawsGroup.children[1];
      this.jawsGroup.userData.isMandible = true;
    }
  }

  buildArmor(data) {
    if (data.armor < 0.3) return;

    // Segmented armor plates along the back (like an armadillo or trilobite)
    const plateMat = new THREE.MeshStandardMaterial({
      color: 0x3d2817, // Dark brown
      roughness: 0.4,
      metalness: 0.15
    });

    const plateCount = 3 + Math.floor(data.armor * 3); // 3-6 plates based on armor
    const plateSize = 0.25 + data.armor * 0.1;

    for (let i = 0; i < plateCount; i++) {
      // Position plates along the dorsal (top-back) line
      const t = (i / (plateCount - 1)) - 0.5; // -0.5 to 0.5
      const zPos = t * 0.8; // Spread along body length

      // Plates are flat discs on the back
      const plateGeo = new THREE.CylinderGeometry(plateSize, plateSize * 0.9, 0.08, 8);
      const plate = new THREE.Mesh(plateGeo, plateMat);
      plate.rotation.x = Math.PI / 2; // Lay flat
      plate.position.set(0, 0.35, zPos); // On top of body, not covering sides
      plate.scale.set(1, 1, 0.7); // Slightly elongated
      this.armorGroup.add(plate);
    }
  }

  buildSpecialFeatures(data) {
    // Cold resistance - fluffy outline
    if (data.coldResistance > 0.35) {
      const fluffMat = new THREE.MeshStandardMaterial({
        color: 0xddddee,
        transparent: true,
        opacity: 0.25 + data.coldResistance * 0.2
      });
      this.coldMesh = new THREE.Mesh(SharedGeometries.body.sphere, fluffMat);
      this.coldMesh.scale.setScalar(1.15 + data.coldResistance * 0.1);
      this.mesh.add(this.coldMesh);
    }

    // Parasitic probe
    if (data.parasitic > 0.3) {
      const probeMat = new THREE.MeshStandardMaterial({ color: 0x662266 });
      this.probeMesh = new THREE.Mesh(SharedGeometries.probe, probeMat);
      this.probeMesh.position.set(0, -0.15, 0.7);
      this.probeMesh.rotation.x = Math.PI / 3;
      this.mesh.add(this.probeMesh);
    }

    // Antennae for smell-based creatures
    if (data.smell > 0.25) {
      this.antennaeGroup = new THREE.Group();
      const antennaLength = 0.3 + data.smell * 0.5;
      const segments = 3 + Math.floor(data.smell * 3); // 3-6 segments

      const antennaMat = new THREE.MeshStandardMaterial({
        color: 0x553322,
        roughness: 0.6
      });

      [-1, 1].forEach(side => {
        const antennaGroup = new THREE.Group();

        // Build segmented antenna - segments stack upward from base
        let yOffset = 0;
        for (let i = 0; i < segments; i++) {
          const t = i / segments;
          const segmentLength = antennaLength / segments;
          const segmentWidth = 0.03 * (1 - t * 0.5); // Taper toward tip

          const segGeo = new THREE.CylinderGeometry(segmentWidth * 0.7, segmentWidth, segmentLength, 6);
          const segment = new THREE.Mesh(segGeo, antennaMat);
          segment.position.y = yOffset + segmentLength / 2;
          yOffset += segmentLength;
          segment.userData.segmentIndex = i;
          antennaGroup.add(segment);
        }

        // Position on TOP of head, outside the body (body radius ~1)
        // Place at front-top of head, angled forward and outward
        const baseX = side * 0.3;
        const baseY = 0.85; // Top of head
        const baseZ = 0.5;  // Front of head

        antennaGroup.position.set(baseX, baseY, baseZ);
        antennaGroup.rotation.z = side * Math.PI / 6;  // Angle outward
        antennaGroup.rotation.x = -Math.PI / 3;        // Angle forward

        antennaGroup.userData.initialRotation = antennaGroup.rotation.clone();
        antennaGroup.userData.side = side;

        this.antennaeGroup.add(antennaGroup);
      });

      this.mesh.add(this.antennaeGroup);
    }
  }

  buildEmergentFeatures(data, bodyColor) {
    const ef = data.emergentFeatures;
    if (!ef) return;

    const limbColor = bodyColor.clone().multiplyScalar(0.75);

    // === WINGS ===
    if (ef.wings > 0.1) {
      const wingSize = 0.3 + ef.wings * 0.8;
      const wingMat = new THREE.MeshStandardMaterial({
        color: bodyColor.clone().multiplyScalar(0.9),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.7 + ef.wings * 0.2,
        roughness: 0.3
      });

      // Create wing shape
      const wingShape = new THREE.Shape();
      wingShape.moveTo(0, 0);
      wingShape.quadraticCurveTo(wingSize * 0.6, wingSize * 0.3, wingSize, wingSize * 0.1);
      wingShape.quadraticCurveTo(wingSize * 0.7, wingSize * 0.5, wingSize * 0.3, wingSize * 0.8);
      wingShape.quadraticCurveTo(0.1, wingSize * 0.4, 0, 0);

      const wingGeo = new THREE.ShapeGeometry(wingShape);

      [-1, 1].forEach(side => {
        const wing = new THREE.Mesh(wingGeo, wingMat);
        wing.position.set(side * 0.3, 0.4, 0.1);
        wing.rotation.y = side * Math.PI / 2;
        wing.rotation.x = -0.3;
        wing.scale.x = side;
        wing.userData.isWing = true;
        wing.userData.side = side;
        wing.userData.baseRotation = wing.rotation.clone();
        this.emergentGroup.add(wing);
      });
    }

    // === BIOLUMINESCENCE ===
    if (ef.bioluminescence > 0.15) {
      const glowIntensity = ef.bioluminescence;
      const glowColor = new THREE.Color().setHSL(
        0.5 + Math.random() * 0.3, // Cyan to purple
        0.8,
        0.5 + glowIntensity * 0.3
      );

      const glowMat = new THREE.MeshStandardMaterial({
        color: glowColor,
        emissive: glowColor,
        emissiveIntensity: glowIntensity * 2,
        transparent: true,
        opacity: 0.8
      });

      // Add glowing spots on the body surface
      const spotCount = Math.floor(3 + glowIntensity * 5);
      for (let i = 0; i < spotCount; i++) {
        const spotSize = 0.08 + glowIntensity * 0.06;
        const spotGeo = new THREE.SphereGeometry(spotSize, 8, 8);
        const spot = new THREE.Mesh(spotGeo, glowMat.clone());

        // Distribute spots on body surface - push out past the body radius
        const theta = (i / spotCount) * Math.PI * 2 + Math.random() * 0.5;
        const phi = Math.random() * Math.PI * 0.6 - Math.PI * 0.3;
        const surfaceRadius = 1.05; // Just outside the body
        spot.position.set(
          Math.sin(theta) * Math.cos(phi) * surfaceRadius,
          Math.sin(phi) * surfaceRadius * 0.9 + 0.1,
          Math.cos(theta) * Math.cos(phi) * surfaceRadius
        );
        // Flatten spots slightly against body
        spot.scale.set(1, 0.5, 1);
        spot.lookAt(0, 0, 0); // Face outward
        spot.userData.glowPhase = Math.random() * Math.PI * 2;
        this.emergentGroup.add(spot);
      }
    }

    // === SPIKES ===
    if (ef.spikes > 0.1) {
      const spikeCount = Math.floor(3 + ef.spikes * 8);
      const spikeSize = 0.15 + ef.spikes * 0.25;
      const spikeMat = new THREE.MeshStandardMaterial({
        color: limbColor.clone().multiplyScalar(0.6),
        roughness: 0.4
      });

      for (let i = 0; i < spikeCount; i++) {
        const spike = new THREE.Mesh(SharedGeometries.spike, spikeMat);
        spike.scale.setScalar(spikeSize);

        // Position on upper body
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI * 0.5;
        const r = 0.95;
        spike.position.set(
          Math.sin(theta) * Math.cos(phi) * r,
          Math.sin(phi) * r + 0.2,
          Math.cos(theta) * Math.cos(phi) * r
        );

        // Point outward
        spike.lookAt(spike.position.clone().multiplyScalar(2));
        this.emergentGroup.add(spike);
      }
    }

    // === TAIL ===
    if (ef.tail > 0.15) {
      const tailLength = 2 + ef.tail * 4;
      const segments = Math.floor(tailLength);
      const tailMat = new THREE.MeshStandardMaterial({
        color: limbColor,
        roughness: 0.6
      });

      let prevPos = new THREE.Vector3(0, -0.2, -0.9);
      for (let i = 0; i < segments; i++) {
        const t = i / segments;
        const segment = new THREE.Mesh(SharedGeometries.tailSegment, tailMat);
        const scale = 1 - t * 0.6;
        segment.scale.setScalar(scale * (0.5 + ef.tail * 0.5));

        segment.position.copy(prevPos);
        segment.position.z -= 0.15 * scale;
        segment.userData.tailIndex = i;
        segment.userData.basePos = segment.position.clone();

        this.emergentGroup.add(segment);
        prevPos = segment.position.clone();
      }
    }

    // === HORN ===
    if (ef.horn > 0.2) {
      const hornSize = 0.5 + ef.horn * 1.0;
      const hornMat = new THREE.MeshStandardMaterial({
        color: 0x443322,
        roughness: 0.3,
        metalness: 0.1
      });

      const horn = new THREE.Mesh(SharedGeometries.horn, hornMat);
      horn.scale.setScalar(hornSize);
      horn.position.set(0, 0.8, 0.3);
      horn.rotation.x = -0.4;
      this.emergentGroup.add(horn);

      // Second horn for high values
      if (ef.horn > 0.6) {
        [-0.25, 0.25].forEach(xOffset => {
          const sideHorn = new THREE.Mesh(SharedGeometries.horn, hornMat);
          sideHorn.scale.setScalar(hornSize * 0.7);
          sideHorn.position.set(xOffset, 0.6, 0.2);
          sideHorn.rotation.x = -0.2;
          sideHorn.rotation.z = -xOffset * 0.5;
          this.emergentGroup.add(sideHorn);
        });
      }
    }

    // === SHELL (snail-like spiral shell on the back) ===
    if (ef.shell > 0.2) {
      const shellMat = new THREE.MeshStandardMaterial({
        color: 0x886644,
        roughness: 0.4,
        metalness: 0.05
      });

      // Create a spiral shell from overlapping spheres (like a nautilus)
      const baseSize = 0.2 + ef.shell * 0.3;
      const spirals = 4 + Math.floor(ef.shell * 3); // 4-7 segments

      for (let i = 0; i < spirals; i++) {
        const t = i / spirals;
        const angle = t * Math.PI * 1.5; // Spiral angle
        const radius = 0.1 + t * 0.25; // Expanding radius
        const segmentSize = baseSize * (0.5 + t * 0.5); // Growing segments

        const segGeo = new THREE.SphereGeometry(segmentSize, 8, 6);
        const seg = new THREE.Mesh(segGeo, shellMat);

        // Position in a spiral pattern, offset to the back-right
        seg.position.set(
          0.3 + Math.cos(angle) * radius, // Offset to the right side
          0.2 + t * 0.2, // Rise up slightly
          -0.3 + Math.sin(angle) * radius // Behind the body
        );
        seg.scale.set(1, 0.8, 1); // Slightly flattened
        this.emergentGroup.add(seg);
      }
    }
  }

  updateFromData(data, dt = 0.016) {
    const prevData = this.data;
    this.data = data;
    this.animTime += dt;

    // Update position
    this.mesh.position.set(data.position.x, data.position.y, data.position.z);

    // Calculate movement speed
    const velLen = data.velocity ?
      Math.sqrt(data.velocity.x ** 2 + data.velocity.y ** 2 + data.velocity.z ** 2) : 0;

    // Face movement direction
    if (data.velocity && velLen > 0.01) {
      const vel = new THREE.Vector3(data.velocity.x, data.velocity.y, data.velocity.z);
      const m = new THREE.Matrix4().lookAt(vel, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
      const targetQuat = new THREE.Quaternion().setFromRotationMatrix(m);
      this.mesh.quaternion.slerp(targetQuat, 0.12);
    }

    // Detect eating (energy increased significantly)
    if (prevData && data.energy > prevData.energy + 0.5) {
      this.isEating = true;
      this.eatingTimer = 0.5; // Eat animation duration
    }
    
    // Detect attacking (energy decreased from attack cost, or predatory creature near prey)
    if (prevData && data.predatory > 0.3) {
      // Check if energy dropped suddenly (attack cost) but not too much (not starvation)
      const energyDrop = prevData.energy - data.energy;
      if (energyDrop > 2 && energyDrop < 10) {
        this.isAttacking = true;
        this.attackTimer = 0.3; // Quick attack animation
      }
    }
    
    if (this.eatingTimer > 0) {
      this.eatingTimer -= dt;
      if (this.eatingTimer <= 0) this.isEating = false;
    }
    
    if (this.attackTimer > 0) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) this.isAttacking = false;
    }

    // Animation speed based on movement
    const animSpeed = Math.min(velLen * 8, 4);

    // === SWIMMING ANIMATION (body wiggle + tail) ===
    if (velLen > 0.02) {
      const wiggle = Math.sin(this.animTime * animSpeed * 3) * 0.08 * Math.min(velLen, 0.5);
      this.bodyMesh.rotation.y = wiggle;

      // Tail fin wag
      if (this.finsGroup.children.length > 1) {
        const tail = this.finsGroup.children[1];
        tail.rotation.y = Math.sin(this.animTime * animSpeed * 4) * 0.5;
      }

      // Side fins flap
      for (let i = 2; i < this.finsGroup.children.length; i++) {
        const fin = this.finsGroup.children[i];
        const side = (i === 2) ? -1 : 1;
        fin.rotation.z = side * (0.8 + Math.sin(this.animTime * animSpeed * 2) * 0.2);
      }
    }

    // === LIMB ANIMATION (varies by type: fin, leg, claw) ===
    if (this.limbsGroup.children.length > 0 && velLen > 0.01) {
      const limbPhase = this.animTime * animSpeed * 2.5;

      this.limbsGroup.children.forEach((child) => {
        if (child.userData.side === undefined) return;

        const side = child.userData.side;
        const pairIndex = child.userData.pairIndex || 0;
        const limbType = child.userData.limbType || 'leg';
        const phase = limbPhase + pairIndex * Math.PI + (side > 0 ? Math.PI / 2 : 0);

        if (limbType === 'fin') {
          // FINS: Paddle/rowing motion
          const paddle = Math.sin(phase) * 0.4 * Math.min(velLen * 3, 1);
          child.rotation.z = child.userData.initialRotation.z + paddle * side;
          child.rotation.y = child.userData.initialRotation.y + Math.sin(phase * 0.5) * 0.15;

        } else if (limbType === 'claw') {
          // CLAWS: Reaching/grabbing motion
          const reach = Math.sin(phase) * 0.3 * Math.min(velLen * 3, 1);
          child.rotation.x = (child.userData.initialRotation?.x || 0.2) + reach;
          child.rotation.z = (child.userData.initialRotation?.z || side * 0.5) - Math.abs(reach) * 0.2 * side;

          // Animate pincers if present (last two children are pincers)
          if (child.userData.isClaw && child.children.length >= 2) {
            const pinch = (Math.sin(this.animTime * 4) + 1) * 0.15;
            const lastIdx = child.children.length - 1;
            if (child.children[lastIdx - 1]) {
              child.children[lastIdx - 1].rotation.z = -0.3 - pinch;
            }
            if (child.children[lastIdx]) {
              child.children[lastIdx].rotation.z = 0.3 + pinch;
            }
          }

        } else {
          // LEGS: Walking gait
          const swing = Math.sin(phase) * 0.5 * Math.min(velLen * 3, 1.2);
          const lift = Math.max(0, Math.cos(phase)) * 0.3 * Math.min(velLen * 3, 1);

          child.rotation.x = (child.userData.initialRotation?.x || 0.25) + swing;
          child.rotation.z = side * (0.5 - lift * 0.4);
        }
      });
    }

    // === JAW ANIMATIONS (type-specific) ===
    const jawData = this.jawsGroup.userData;

    if (jawData.isMandible && jawData.left && jawData.right) {
      // MANDIBLES: pincer animation
      const left = jawData.left;
      const right = jawData.right;

      if (this.isAttacking) {
        const attackSpeed = 40;
        const snap = Math.sin(this.animTime * attackSpeed);
        const openAmount = (snap + 1) * 0.5;
        left.rotation.z = left.userData.baseRotationZ - openAmount * 0.5;
        right.rotation.z = right.userData.baseRotationZ + openAmount * 0.5;
      } else if (this.isEating) {
        const chompSpeed = 25;
        const chomp = Math.sin(this.animTime * chompSpeed);
        const openAmount = (chomp + 1) * 0.5;
        left.rotation.z = left.userData.baseRotationZ - openAmount * 0.3;
        right.rotation.z = right.userData.baseRotationZ + openAmount * 0.3;
      } else {
        const idle = Math.sin(this.animTime * 2) * 0.1;
        left.rotation.z = left.userData.baseRotationZ - idle;
        right.rotation.z = right.userData.baseRotationZ + idle;
      }

    } else if ((jawData.isFangs || jawData.isCarrion) && jawData.upperJaw && jawData.lowerJaw) {
      // FANGS & CARRION: opening/closing jaw animation
      const upper = jawData.upperJaw;
      const lower = jawData.lowerJaw;
      const isCarrion = jawData.isCarrion;

      if (this.isAttacking) {
        // Wide snap attack
        const attackSpeed = isCarrion ? 30 : 40; // Carrion is slower but more powerful
        const snap = Math.sin(this.animTime * attackSpeed);
        const openAmount = (snap + 1) * 0.5;
        const openAngle = isCarrion ? 0.4 : 0.3; // Carrion opens wider
        upper.position.y = upper.userData.baseY + openAmount * 0.05;
        lower.position.y = lower.userData.baseY - openAmount * 0.08;
        lower.rotation.x = lower.userData.baseRotX - openAmount * openAngle;
      } else if (this.isEating) {
        // Chewing/tearing motion
        const chompSpeed = isCarrion ? 15 : 25; // Carrion has slower, grinding motion
        const chomp = Math.sin(this.animTime * chompSpeed);
        const openAmount = (chomp + 1) * 0.5;
        upper.position.y = upper.userData.baseY + openAmount * 0.03;
        lower.position.y = lower.userData.baseY - openAmount * 0.05;
        lower.rotation.x = lower.userData.baseRotX - openAmount * 0.2;
        // Carrion adds side-to-side grinding
        if (isCarrion) {
          lower.rotation.y = Math.sin(this.animTime * 8) * 0.1;
        }
      } else {
        // Idle slight movement
        const idle = Math.sin(this.animTime * 1.5) * 0.02;
        upper.position.y = upper.userData.baseY + idle;
        lower.position.y = lower.userData.baseY - idle;
        lower.rotation.x = lower.userData.baseRotX;
        if (isCarrion) lower.rotation.y = 0;
      }

    } else if (jawData.isProboscis && jawData.proboscis) {
      // PROBOSCIS: extending/retracting needle animation
      const prob = jawData.proboscis;

      if (this.isAttacking || this.isEating) {
        // Extend and probe - forward thrusting motion
        const probeSpeed = this.isAttacking ? 20 : 12;
        const thrust = Math.sin(this.animTime * probeSpeed);
        const extend = (thrust + 1) * 0.5;

        // Extend forward
        prob.position.z = prob.userData.baseZ + extend * 0.15;
        // Slight searching motion
        prob.rotation.x = prob.userData.baseRotX + Math.sin(this.animTime * 8) * 0.1;
        prob.rotation.y = Math.sin(this.animTime * 6) * 0.15;
        // Pulsing effect (fluid extraction)
        if (this.isEating) {
          const pulse = 1 + Math.sin(this.animTime * 15) * 0.1;
          prob.scale.x = pulse;
          prob.scale.z = pulse;
        }
      } else {
        // Idle - slight twitch
        prob.position.z = prob.userData.baseZ;
        prob.rotation.x = prob.userData.baseRotX + Math.sin(this.animTime * 2) * 0.05;
        prob.rotation.y = Math.sin(this.animTime * 1.5) * 0.05;
        prob.scale.x = 1;
        prob.scale.z = 1;
      }

    } else if (jawData.isFilter) {
      // FILTER: rippling plate movement for filter feeding
      this.jawsGroup.children.forEach(child => {
        if (child.userData.plateIndex !== undefined) {
          const platePhase = child.userData.plateIndex * 0.5;
          if (this.isEating) {
            // Rhythmic undulation for filter feeding
            const wave = Math.sin(this.animTime * 8 + platePhase) * 0.15;
            child.rotation.x = wave;
            child.position.y = -0.2 + Math.sin(this.animTime * 6 + platePhase) * 0.02;
          } else {
            // Gentle idle wave
            const wave = Math.sin(this.animTime * 2 + platePhase) * 0.05;
            child.rotation.x = wave;
          }
        }
      });
    }

    // === IDLE ANIMATIONS ===
    // Subtle breathing
    const breathe = 1 + Math.sin(this.animTime * 1.5) * 0.015;
    const baseScale = 0.8 + data.size * 1.2;
    this.mesh.scale.setScalar(baseScale * breathe);

    // Eye pupil movement (looking around)
    if (this.eyesGroup.children.length > 0) {
      for (let i = 1; i < this.eyesGroup.children.length; i += 2) {
        const pupil = this.eyesGroup.children[i];
        if (pupil.userData.baseX !== undefined) {
          const lookX = Math.sin(this.animTime * 0.4) * 0.03;
          const lookY = Math.sin(this.animTime * 0.3 + 1) * 0.02;
          pupil.position.x = pupil.userData.baseX + lookX;
          pupil.position.y = 0.15 + lookY;
        }
      }
    }

    // Parasite probe animation
    if (this.probeMesh && data.parasitic > 0.3) {
      this.probeMesh.rotation.x = Math.PI / 3 + Math.sin(this.animTime * 2) * 0.15;
      this.probeMesh.position.z = 0.7 + Math.sin(this.animTime * 1.5) * 0.05;
    }

    // Antennae twitching animation
    if (this.antennaeGroup && this.antennaeGroup.children.length > 0) {
      this.antennaeGroup.children.forEach(ant => {
        if (ant.userData.initialRotation) {
          const side = ant.userData.side || 1;
          const twitch = Math.sin(this.animTime * 5 + side * 2) * 0.15;
          const sway = Math.sin(this.animTime * 2) * 0.1;

          ant.rotation.z = ant.userData.initialRotation.z + twitch * side;
          ant.rotation.x = ant.userData.initialRotation.x + sway;
        }
      });
    }

    // === EMERGENT FEATURE ANIMATIONS ===
    if (this.emergentGroup.children.length > 0) {
      this.emergentGroup.children.forEach(child => {
        // Wing flapping
        if (child.userData.isWing) {
          const side = child.userData.side;
          const flapSpeed = velLen > 0.1 ? 12 : 3; // Fast when moving, slow idle
          const flapAmount = velLen > 0.1 ? 0.4 : 0.15;
          const flap = Math.sin(this.animTime * flapSpeed) * flapAmount;
          child.rotation.z = flap * side;
        }

        // Bioluminescence pulsing
        if (child.userData.glowPhase !== undefined && child.material) {
          const pulse = 0.5 + Math.sin(this.animTime * 2 + child.userData.glowPhase) * 0.5;
          child.material.emissiveIntensity = pulse * 2;
        }

        // Tail swaying
        if (child.userData.tailIndex !== undefined && child.userData.basePos) {
          const idx = child.userData.tailIndex;
          const sway = Math.sin(this.animTime * 3 + idx * 0.5) * 0.1 * (idx + 1);
          child.position.x = child.userData.basePos.x + sway;
        }
      });
    }
  }

  // Recreate mesh for new creature data (used by object pool)
  recreateForData(data) {
    // Clear existing mesh children
    while (this.mesh.children.length > 0) {
      const child = this.mesh.children[0];
      this.mesh.remove(child);
      if (child.material && !SharedMaterials.cache.has(child.material)) {
        child.material.dispose();
      }
    }

    // Reset state
    this.id = data.id;
    this.data = data;
    this.animTime = 0;
    this.isEating = false;
    this.eatingTimer = 0;

    // Rebuild mesh
    this.createMesh(data);
  }

  dispose() {
    this.mesh.traverse((child) => {
      // Don't dispose shared geometries or cached materials
      if (child.material && !SharedMaterials.cache.has(child.material)) {
        child.material.dispose();
      }
    });
  }
}

// LOD Creature Manager - handles all creatures with distance-based LOD, pooling, and frustum culling
class LODCreatureManager {
  constructor(scene, camera, maxCreatures = 5000) {
    this.scene = scene;
    this.camera = camera;
    this.maxCreatures = maxCreatures;

    // All creature data from simulation
    this.creatureData = new Map(); // id -> data

    // LOD tracking
    this.detailedCreatures = new Map(); // id -> CreatureRenderer (nearby, full detail)
    this.lodCreatureIndices = new Map(); // id -> instanceIndex (distant, simple sphere)

    // Object pool for detailed renderers
    this.rendererPool = [];
    this.activeRenderers = new Map(); // id -> pooled CreatureRenderer

    // Available LOD instance indices
    this.availableLodIndices = [];

    // Initialize LOD instanced mesh for distant creatures
    this.initLodMesh();

    // Initialize renderer pool
    this.initPool();

    // Reusable objects for calculations
    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._scale = new THREE.Vector3();
    this._color = new THREE.Color();
    this._cameraPos = new THREE.Vector3();

    // Frustum for culling
    this._frustum = new THREE.Frustum();
    this._projScreenMatrix = new THREE.Matrix4();

    // Stats
    this.stats = {
      detailed: 0,
      lod: 0,
      culled: 0
    };
  }

  initLodMesh() {
    // Create instanced mesh for LOD creatures (simple colored spheres)
    const geometry = SharedGeometries.lodSphere;
    const material = new THREE.MeshStandardMaterial({
      vertexColors: false,
      roughness: 0.6,
      metalness: 0.05
    });

    this.lodMesh = new THREE.InstancedMesh(geometry, material, this.maxCreatures);
    this.lodMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Enable per-instance colors
    this.lodMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.maxCreatures * 3),
      3
    );
    this.lodMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    // Initialize all instances as invisible (zero scale)
    const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.maxCreatures; i++) {
      this.lodMesh.setMatrixAt(i, zeroMatrix);
      this.availableLodIndices.push(i);
    }

    this.lodMesh.instanceMatrix.needsUpdate = true;
    this.lodMesh.count = 0; // Start with no visible instances
    this.scene.add(this.lodMesh);
  }

  initPool() {
    // Pre-create some renderers for the pool
    // We don't create all upfront - they'll be created on demand and pooled
    this.poolSize = LOD_CONFIG.poolSize;
  }

  // Get a renderer from pool or create new one
  acquireRenderer(data) {
    let renderer;
    if (this.rendererPool.length > 0) {
      renderer = this.rendererPool.pop();
      renderer.recreateForData(data);
    } else {
      renderer = new CreatureRenderer(data);
    }
    this.scene.add(renderer.mesh);
    return renderer;
  }

  // Return a renderer to the pool
  releaseRenderer(renderer) {
    this.scene.remove(renderer.mesh);
    renderer.mesh.visible = false;

    if (this.rendererPool.length < this.poolSize) {
      this.rendererPool.push(renderer);
    } else {
      // Pool is full, dispose
      renderer.dispose();
    }
  }

  // Update all creatures with LOD logic
  update(creaturesData, deadCreatureIds, dt) {
    // Update frustum
    this._projScreenMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );
    this._frustum.setFromProjectionMatrix(this._projScreenMatrix);
    this.camera.getWorldPosition(this._cameraPos);

    // Process dead creatures first
    for (const deadId of deadCreatureIds) {
      this.removeCreature(deadId);
    }

    // Calculate distances and sort by distance
    const creaturesWithDistance = [];
    for (const data of creaturesData) {
      const dx = data.position.x - this._cameraPos.x;
      const dy = data.position.y - this._cameraPos.y;
      const dz = data.position.z - this._cameraPos.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      creaturesWithDistance.push({ data, distance });
    }

    // Sort by distance (closest first)
    creaturesWithDistance.sort((a, b) => a.distance - b.distance);

    // Reset stats
    this.stats.detailed = 0;
    this.stats.lod = 0;
    this.stats.culled = 0;

    // Track which creatures should be detailed vs LOD
    const shouldBeDetailed = new Set();
    const shouldBeLod = new Set();
    let detailedCount = 0;

    for (const { data, distance } of creaturesWithDistance) {
      // Store/update creature data
      this.creatureData.set(data.id, data);

      // Check frustum culling (approximate with sphere)
      const scale = 0.8 + data.size * 1.2;
      this._position.set(data.position.x, data.position.y, data.position.z);

      // Simple frustum check
      const inFrustum = this._frustum.containsPoint(this._position) ||
        distance < LOD_CONFIG.detailDistance; // Always render very close ones

      if (!inFrustum || distance > LOD_CONFIG.cullDistance) {
        // Culled - make sure it's not rendered
        this.stats.culled++;
        this.hideCreature(data.id);
        continue;
      }

      // Decide LOD level
      if (distance < LOD_CONFIG.detailDistance && detailedCount < LOD_CONFIG.maxDetailedCreatures) {
        shouldBeDetailed.add(data.id);
        detailedCount++;
        this.stats.detailed++;
      } else if (distance < LOD_CONFIG.cullDistance) {
        shouldBeLod.add(data.id);
        this.stats.lod++;
      } else {
        this.stats.culled++;
        this.hideCreature(data.id);
      }
    }

    // Transition creatures between LOD levels
    this.updateLodTransitions(shouldBeDetailed, shouldBeLod, dt);

    // Update instance matrices
    this.lodMesh.instanceMatrix.needsUpdate = true;
    if (this.lodMesh.instanceColor) {
      this.lodMesh.instanceColor.needsUpdate = true;
    }

    // Update visible instance count
    this.lodMesh.count = this.maxCreatures - this.availableLodIndices.length;
  }

  updateLodTransitions(shouldBeDetailed, shouldBeLod, dt) {
    // Handle creatures that should be detailed
    for (const id of shouldBeDetailed) {
      const data = this.creatureData.get(id);
      if (!data) continue;

      // If currently LOD, transition to detailed
      if (this.lodCreatureIndices.has(id)) {
        this.removeLodInstance(id);
      }

      // Get or create detailed renderer
      let renderer = this.activeRenderers.get(id);
      if (!renderer) {
        renderer = this.acquireRenderer(data);
        this.activeRenderers.set(id, renderer);
      }

      renderer.mesh.visible = true;
      renderer.updateFromData(data, dt);
    }

    // Handle creatures that should be LOD
    for (const id of shouldBeLod) {
      const data = this.creatureData.get(id);
      if (!data) continue;

      // If currently detailed, transition to LOD
      if (this.activeRenderers.has(id)) {
        const renderer = this.activeRenderers.get(id);
        this.releaseRenderer(renderer);
        this.activeRenderers.delete(id);
      }

      // Update or create LOD instance
      this.updateLodInstance(data);
    }

    // Hide any detailed renderers that shouldn't be visible
    for (const [id, renderer] of this.activeRenderers) {
      if (!shouldBeDetailed.has(id)) {
        this.releaseRenderer(renderer);
        this.activeRenderers.delete(id);
      }
    }
  }

  updateLodInstance(data) {
    let index = this.lodCreatureIndices.get(data.id);

    if (index === undefined) {
      // Allocate new LOD index
      if (this.availableLodIndices.length === 0) return;
      index = this.availableLodIndices.pop();
      this.lodCreatureIndices.set(data.id, index);
    }

    // Calculate transform
    const scale = 0.8 + data.size * 1.2;
    this._position.set(data.position.x, data.position.y, data.position.z);
    this._scale.set(scale, scale, scale);

    // Simple rotation from velocity
    if (data.velocity) {
      const vel = new THREE.Vector3(data.velocity.x, data.velocity.y, data.velocity.z);
      if (vel.lengthSq() > 0.0001) {
        const m = new THREE.Matrix4().lookAt(vel, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
        this._quaternion.setFromRotationMatrix(m);
      } else {
        this._quaternion.identity();
      }
    } else {
      this._quaternion.identity();
    }

    this._matrix.compose(this._position, this._quaternion, this._scale);
    this.lodMesh.setMatrixAt(index, this._matrix);

    // Set color based on creature's color genes
    const hue = data.colorHue || 0.33;
    const saturation = 0.3 + (data.colorSaturation || 0.5) * 0.5;
    const lightness = 0.35 + (data.colorSaturation || 0.5) * 0.15;
    this._color.setHSL(hue, saturation, lightness);
    this.lodMesh.setColorAt(index, this._color);
  }

  removeLodInstance(id) {
    const index = this.lodCreatureIndices.get(id);
    if (index === undefined) return;

    // Set to zero scale (invisible)
    this._matrix.makeScale(0, 0, 0);
    this.lodMesh.setMatrixAt(index, this._matrix);

    this.availableLodIndices.push(index);
    this.lodCreatureIndices.delete(id);
  }

  hideCreature(id) {
    // Remove from LOD if present
    if (this.lodCreatureIndices.has(id)) {
      this.removeLodInstance(id);
    }

    // Hide detailed renderer if present
    if (this.activeRenderers.has(id)) {
      const renderer = this.activeRenderers.get(id);
      renderer.mesh.visible = false;
    }
  }

  removeCreature(id) {
    // Remove from data
    this.creatureData.delete(id);

    // Remove LOD instance
    this.removeLodInstance(id);

    // Release detailed renderer
    if (this.activeRenderers.has(id)) {
      const renderer = this.activeRenderers.get(id);
      this.releaseRenderer(renderer);
      this.activeRenderers.delete(id);
    }
  }

  getCreatureData(id) {
    return this.creatureData.get(id);
  }

  getAllCreatureData() {
    return Array.from(this.creatureData.values());
  }

  getStats() {
    return {
      ...this.stats,
      total: this.creatureData.size,
      pooled: this.rendererPool.length
    };
  }

  dispose() {
    // Dispose all active renderers
    for (const renderer of this.activeRenderers.values()) {
      renderer.dispose();
    }
    this.activeRenderers.clear();

    // Dispose pooled renderers
    for (const renderer of this.rendererPool) {
      renderer.dispose();
    }
    this.rendererPool = [];

    // Dispose LOD mesh
    this.scene.remove(this.lodMesh);
    this.lodMesh.geometry.dispose();
    this.lodMesh.material.dispose();
  }
}

// Instanced plant renderer - handles all plants with just 2 draw calls
class InstancedPlantRenderer {
  constructor(scene, maxPlants = 6000) {
    this.scene = scene;
    this.maxPlants = maxPlants;
    this.plantData = new Map(); // id -> { index, isWater, age, position }
    this.waterIndices = []; // Available indices for water plants
    this.landIndices = []; // Available indices for land plants
    this.time = 0;

    // Culling settings - use detailDistance to match creature visibility
    this.cullDistance = LOD_CONFIG.detailDistance;
    this.camera = null; // Set by World

    // Shared geometry for all plants
    const geometry = new THREE.TetrahedronGeometry(0.5);

    // Water plants - cyan-green, brighter glow
    const waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x00ffaa,
      emissive: 0x00aa66,
      emissiveIntensity: 0.5
    });

    // Land plants - pure green, dimmer
    const landMaterial = new THREE.MeshStandardMaterial({
      color: 0x00ff00,
      emissive: 0x004400,
      emissiveIntensity: 0.2
    });

    // Create instanced meshes - 70% water, 30% land estimate
    const waterCount = Math.floor(maxPlants * 0.7);
    const landCount = maxPlants - waterCount;

    this.waterMesh = new THREE.InstancedMesh(geometry, waterMaterial, waterCount);
    this.landMesh = new THREE.InstancedMesh(geometry, landMaterial, landCount);

    // Use dynamic draw for frequently updated matrices
    this.waterMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.landMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Initialize with zero scale (invisible)
    const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < waterCount; i++) {
      this.waterMesh.setMatrixAt(i, zeroMatrix);
      this.waterIndices.push(i);
    }
    for (let i = 0; i < landCount; i++) {
      this.landMesh.setMatrixAt(i, zeroMatrix);
      this.landIndices.push(i);
    }

    this.waterMesh.instanceMatrix.needsUpdate = true;
    this.landMesh.instanceMatrix.needsUpdate = true;

    // Disable Three.js frustum culling - we do our own distance-based culling per instance
    // Three.js frustum culling uses a single bounding sphere for the entire InstancedMesh,
    // which doesn't work well when instances are spread across the world
    this.waterMesh.frustumCulled = false;
    this.landMesh.frustumCulled = false;

    scene.add(this.waterMesh);
    scene.add(this.landMesh);

    // Reusable objects for matrix calculations
    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._scale = new THREE.Vector3();
    this._cameraPos = new THREE.Vector3();

    // Frustum for view culling
    this._frustum = new THREE.Frustum();
    this._projScreenMatrix = new THREE.Matrix4();
  }

  setCamera(camera) {
    this.camera = camera;
  }

  addPlant(data) {
    const isWater = !data.isOnLand;
    const indices = isWater ? this.waterIndices : this.landIndices;

    if (indices.length === 0) {
      return false;
    }

    const index = indices.pop();
    const mesh = isWater ? this.waterMesh : this.landMesh;

    // Check if plant is within visible range
    let isVisible = true;
    if (this.camera) {
      this.camera.getWorldPosition(this._cameraPos);
      const dx = data.position.x - this._cameraPos.x;
      const dy = data.position.y - this._cameraPos.y;
      const dz = data.position.z - this._cameraPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      isVisible = distSq < this.cullDistance * this.cullDistance;
    }

    // Store plant data with position for distance checking
    this.plantData.set(data.id, {
      index,
      isWater,
      age: 0,
      position: { x: data.position.x, y: data.position.y, z: data.position.z },
      rotation: new THREE.Euler(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      ),
      visible: isVisible
    });

    // Set initial transform (hidden if outside cull distance)
    this.updatePlantMatrix(data, mesh, index, 0, isVisible);

    return true;
  }

  updatePlant(data, dt) {
    const plantInfo = this.plantData.get(data.id);
    if (!plantInfo) {
      return this.addPlant(data);
    }

    // Update stored position
    plantInfo.position.x = data.position.x;
    plantInfo.position.y = data.position.y;
    plantInfo.position.z = data.position.z;

    // Check distance from camera for culling
    let shouldUpdate = true;
    if (this.camera) {
      this.camera.getWorldPosition(this._cameraPos);
      const dx = data.position.x - this._cameraPos.x;
      const dy = data.position.y - this._cameraPos.y;
      const dz = data.position.z - this._cameraPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      shouldUpdate = distSq < this.cullDistance * this.cullDistance;
    }

    const mesh = plantInfo.isWater ? this.waterMesh : this.landMesh;

    if (shouldUpdate) {
      plantInfo.age += dt;
      plantInfo.visible = true;
      this.updatePlantMatrix(data, mesh, plantInfo.index, plantInfo.age, true);
    } else if (plantInfo.visible) {
      // Hide plant - set to zero scale
      plantInfo.visible = false;
      this._matrix.makeScale(0, 0, 0);
      mesh.setMatrixAt(plantInfo.index, this._matrix);
    }
    // If already hidden, skip entirely

    return true;
  }

  updatePlantMatrix(data, mesh, index, age, visible) {
    if (!visible) {
      this._matrix.makeScale(0, 0, 0);
      mesh.setMatrixAt(index, this._matrix);
      return;
    }

    const plantInfo = this.plantData.get(data.id);

    // Calculate scale based on energy + pulse
    const energyScale = 0.5 + (data.energy / 80) * 0.5;
    const pulse = 1 + Math.sin(age * 2) * 0.1;
    const scale = energyScale * pulse;

    this._position.set(data.position.x, data.position.y, data.position.z);
    this._quaternion.setFromEuler(plantInfo.rotation);
    this._scale.set(scale, scale, scale);

    this._matrix.compose(this._position, this._quaternion, this._scale);
    mesh.setMatrixAt(index, this._matrix);
  }

  removePlant(id) {
    const plantInfo = this.plantData.get(id);
    if (!plantInfo) return;

    const mesh = plantInfo.isWater ? this.waterMesh : this.landMesh;
    const indices = plantInfo.isWater ? this.waterIndices : this.landIndices;

    // Set to zero scale (invisible)
    this._matrix.makeScale(0, 0, 0);
    mesh.setMatrixAt(plantInfo.index, this._matrix);

    // Return index to pool
    indices.push(plantInfo.index);
    this.plantData.delete(id);
  }

  finishUpdate() {
    // Mark matrices as needing update
    this.waterMesh.instanceMatrix.needsUpdate = true;
    this.landMesh.instanceMatrix.needsUpdate = true;
  }

  // Update visibility of all plants based on camera frustum and distance (call each frame)
  updateCulling() {
    if (!this.camera) return;

    // Update frustum from camera
    this._projScreenMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );
    this._frustum.setFromProjectionMatrix(this._projScreenMatrix);
    this.camera.getWorldPosition(this._cameraPos);

    const cullDistSq = this.cullDistance * this.cullDistance;

    for (const [, plantInfo] of this.plantData) {
      // Check distance
      const dx = plantInfo.position.x - this._cameraPos.x;
      const dy = plantInfo.position.y - this._cameraPos.y;
      const dz = plantInfo.position.z - this._cameraPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      // Check if in frustum (view)
      this._position.set(plantInfo.position.x, plantInfo.position.y, plantInfo.position.z);
      const inFrustum = this._frustum.containsPoint(this._position);

      const shouldBeVisible = distSq < cullDistSq && inFrustum;
      const mesh = plantInfo.isWater ? this.waterMesh : this.landMesh;

      if (shouldBeVisible) {
        this._quaternion.setFromEuler(plantInfo.rotation);
        const scale = 0.5 + (plantInfo.energy || 50) / 80 * 0.5;
        this._scale.set(scale, scale, scale);
        this._matrix.compose(this._position, this._quaternion, this._scale);
      } else {
        this._matrix.makeScale(0, 0, 0);
      }
      mesh.setMatrixAt(plantInfo.index, this._matrix);
    }

    this.waterMesh.instanceMatrix.needsUpdate = true;
    this.landMesh.instanceMatrix.needsUpdate = true;
  }

  getPlantCount() {
    return this.plantData.size;
  }

  dispose() {
    this.scene.remove(this.waterMesh);
    this.scene.remove(this.landMesh);
    this.waterMesh.geometry.dispose();
    this.waterMesh.material.dispose();
    this.landMesh.geometry.dispose();
    this.landMesh.material.dispose();
  }
}

// Instanced corpse renderer - handles all corpses with 2 draw calls (normal + toxic)
class InstancedCorpseRenderer {
  constructor(scene, maxCorpses = 500) {
    this.scene = scene;
    this.maxCorpses = maxCorpses;
    this.corpseData = new Map(); // id -> { index, isToxic, baseScale, initialEnergy }
    this.normalIndices = [];
    this.toxicIndices = [];

    // Shared geometry
    const geometry = new THREE.SphereGeometry(1, 8, 8);

    // Normal corpse material - brown/decaying
    const normalMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a3728,
      roughness: 0.9,
      metalness: 0.0
    });

    // Toxic corpse material - purple tint
    const toxicMaterial = new THREE.MeshStandardMaterial({
      color: 0x6b3a6b,
      roughness: 0.9,
      metalness: 0.0
    });

    // 80% normal, 20% toxic estimate
    const normalCount = Math.floor(maxCorpses * 0.8);
    const toxicCount = maxCorpses - normalCount;

    this.normalMesh = new THREE.InstancedMesh(geometry, normalMaterial, normalCount);
    this.toxicMesh = new THREE.InstancedMesh(geometry, toxicMaterial, toxicCount);

    // Initialize with zero scale
    const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < normalCount; i++) {
      this.normalMesh.setMatrixAt(i, zeroMatrix);
      this.normalIndices.push(i);
    }
    for (let i = 0; i < toxicCount; i++) {
      this.toxicMesh.setMatrixAt(i, zeroMatrix);
      this.toxicIndices.push(i);
    }

    this.normalMesh.instanceMatrix.needsUpdate = true;
    this.toxicMesh.instanceMatrix.needsUpdate = true;

    scene.add(this.normalMesh);
    scene.add(this.toxicMesh);

    // Reusable objects
    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._scale = new THREE.Vector3();
  }

  addCorpse(data) {
    const isToxic = data.toxicity > 0.3;
    const indices = isToxic ? this.toxicIndices : this.normalIndices;

    if (indices.length === 0) return false;

    const index = indices.pop();
    const baseScale = Math.min(2, 0.5 + (data.size || 0) * 1.5);

    this.corpseData.set(data.id, {
      index,
      isToxic,
      baseScale,
      initialEnergy: data.energy || 100
    });

    this.updateCorpseMatrix(data);
    return true;
  }

  updateCorpse(data) {
    const corpseInfo = this.corpseData.get(data.id);
    if (!corpseInfo) {
      return this.addCorpse(data);
    }

    this.updateCorpseMatrix(data);
    return true;
  }

  updateCorpseMatrix(data) {
    const corpseInfo = this.corpseData.get(data.id);
    if (!corpseInfo) return;

    const mesh = corpseInfo.isToxic ? this.toxicMesh : this.normalMesh;

    // Shrink as energy decays
    const energyRatio = Math.min(1, Math.max(0.2, data.energy / corpseInfo.initialEnergy));
    const scale = corpseInfo.baseScale * energyRatio;

    this._position.set(data.position.x, data.position.y, data.position.z);
    this._quaternion.identity();
    this._scale.set(scale, scale, scale);

    this._matrix.compose(this._position, this._quaternion, this._scale);
    mesh.setMatrixAt(corpseInfo.index, this._matrix);
  }

  removeCorpse(id) {
    const corpseInfo = this.corpseData.get(id);
    if (!corpseInfo) return;

    const mesh = corpseInfo.isToxic ? this.toxicMesh : this.normalMesh;
    const indices = corpseInfo.isToxic ? this.toxicIndices : this.normalIndices;

    this._matrix.makeScale(0, 0, 0);
    mesh.setMatrixAt(corpseInfo.index, this._matrix);

    indices.push(corpseInfo.index);
    this.corpseData.delete(id);
  }

  finishUpdate() {
    this.normalMesh.instanceMatrix.needsUpdate = true;
    this.toxicMesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.normalMesh);
    this.scene.remove(this.toxicMesh);
    this.normalMesh.geometry.dispose();
    this.normalMesh.material.dispose();
    this.toxicMesh.geometry.dispose();
    this.toxicMesh.material.dispose();
  }
}

export class World {
  constructor(container) {
    this.container = container;
    // LOD creature manager handles creatures with distance-based detail, pooling, and frustum culling
    this.creatureManager = null; // LODCreatureManager - initialized after scene/camera
    // Instanced renderers for plants and corpses (much better performance)
    this.plantRenderer = null; // InstancedPlantRenderer - initialized after scene
    this.corpseRenderer = null; // InstancedCorpseRenderer - initialized after scene
    this.time = 0;
    this.noise2D = createNoise2D();

    this.ui = new UI();
    this.ui.setFocusCallback((creature) => this.focusOnCreature(creature));
    this.selectedCreature = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Worker for simulation
    this.worker = null;
    this.workerReady = false;
    this.pendingUpdate = false;
    this.accumulatedDt = 0; // Accumulate dt while waiting for worker response
    this.lastWorkerData = null;

    this.initThree();
    this.initTerrain();
    this.initOptimizedRenderers();
    this.initWorker();
  }

  initOptimizedRenderers() {
    // Create LOD creature manager with frustum culling and object pooling
    this.creatureManager = new LODCreatureManager(this.scene, this.camera, 5000);

    // Create instanced renderers for plants and corpses
    // These use InstancedMesh for massive performance gains
    this.plantRenderer = new InstancedPlantRenderer(this.scene, 8000);
    this.plantRenderer.setCamera(this.camera); // Enable distance-based culling
    this.corpseRenderer = new InstancedCorpseRenderer(this.scene, 500);
  }

  initWorker() {
    // Create worker using Vite's worker syntax
    this.worker = new Worker(
      new URL('./SimulationWorker.js', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = (e) => {
      const { type, data } = e.data;

      switch (type) {
        case 'init':
          this.workerReady = true;
          this.handleWorkerInit(data);
          break;

        case 'update':
          this.pendingUpdate = false;
          this.handleWorkerUpdate(data);
          break;
      }
    };

    this.worker.onerror = (e) => {
      console.error('Worker error:', e);
    };

    // Initialize the worker
    this.worker.postMessage({ type: 'init' });
  }

  handleWorkerInit(data) {
    // Initial creatures will be handled by the first update call
    // The LODCreatureManager handles all creature lifecycle

    // Add initial plants to instanced renderer
    for (const plantData of data.plants) {
      this.plantRenderer.addPlant(plantData);
    }
    this.plantRenderer.finishUpdate();

    console.log(`Worker initialized: ${data.creatures.length} creatures, ${data.plants.length} plants (LOD + instanced)`);
  }

  handleWorkerUpdate(data) {
    this.lastWorkerData = data;

    // Update all creatures using LOD manager (handles LOD, frustum culling, object pooling)
    this.creatureManager.update(data.creatures, data.deadCreatureIds, 0.016);

    // Update plants using instanced renderer (2 draw calls for all plants!)
    for (const plantData of data.plants) {
      this.plantRenderer.updatePlant(plantData, 0.016);
    }

    // Remove dead/eaten plants from instanced renderer
    for (const deadId of data.deadPlantIds) {
      this.plantRenderer.removePlant(deadId);
    }

    // Mark plant instance matrices as updated
    this.plantRenderer.finishUpdate();

    // Update corpses using instanced renderer
    if (data.corpses) {
      for (const corpseData of data.corpses) {
        this.corpseRenderer.updateCorpse(corpseData);
      }
    }

    // Remove decayed/eaten corpses from instanced renderer
    if (data.deadCorpseIds) {
      for (const deadId of data.deadCorpseIds) {
        this.corpseRenderer.removeCorpse(deadId);
      }
    }

    // Mark corpse instance matrices as updated
    this.corpseRenderer.finishUpdate();

    // Update UI with stats
    this.ui.updateStats({
      creatures: this.creatureManager.getAllCreatureData(),
      plants: data.plants,
      corpses: data.corpses || [],
      time: data.stats.time,
      energySources: data.stats.energySources
    });
  }

  initThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87CEEB);
    this.scene.fog = new THREE.Fog(0x87CEEB, 200, 1000);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 2000);
    // Start camera looking at deep water where creatures spawn (z: -200 to -450)
    this.camera.position.set(0, 100, -150);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    // Set initial target to the deep water area
    this.controls.target.set(0, 0, -300);

    // Keyboard controls
    this.keys = {
      ArrowUp: false,
      ArrowDown: false,
      ArrowLeft: false,
      ArrowRight: false
    };

    window.addEventListener('keydown', (e) => {
      if (this.keys.hasOwnProperty(e.key)) {
        this.keys[e.key] = true;
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (this.keys.hasOwnProperty(e.key)) {
        this.keys[e.key] = false;
        e.preventDefault();
      }
    });

    // Lights
    const ambientLight = new THREE.AmbientLight(0x404040);
    this.scene.add(ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xffffff, 1);
    this.sunLight.position.set(100, 200, 100);
    this.sunLight.castShadow = true;
    this.scene.add(this.sunLight);

    // Resize handler
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Click handling for creature selection
    this.renderer.domElement.addEventListener('click', (event) => {
      this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);

      // Get detailed creature meshes from LOD manager and LOD mesh
      const detailedMeshes = Array.from(this.creatureManager.activeRenderers.values()).map(r => r.mesh);
      const allMeshes = [...detailedMeshes, this.creatureManager.lodMesh];
      const intersects = this.raycaster.intersectObjects(allMeshes, true);

      if (intersects.length > 0) {
        const clickedObject = intersects[0].object;

        // Check if clicked on LOD instanced mesh
        if (clickedObject === this.creatureManager.lodMesh) {
          const instanceId = intersects[0].instanceId;
          // Find creature id by instance index
          for (const [id, index] of this.creatureManager.lodCreatureIndices) {
            if (index === instanceId) {
              const data = this.creatureManager.getCreatureData(id);
              if (data) {
                this.selectedCreature = data;
                this.ui.showCreature(data);
              }
              break;
            }
          }
        } else {
          // Clicked on detailed mesh
          const renderer = Array.from(this.creatureManager.activeRenderers.values()).find(r =>
            r.mesh === clickedObject || r.mesh.children.includes(clickedObject) ||
            clickedObject.parent === r.mesh
          );

          if (renderer) {
            this.selectedCreature = renderer.data;
            this.ui.showCreature(renderer.data);
          }
        }
      } else {
        this.selectedCreature = null;
        this.ui.hideCreature();
      }
    });

    // Reset Camera Button
    const resetBtn = document.getElementById('reset-camera-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        // Reset to view deep water where creatures spawn
        this.camera.position.set(0, 100, -150);
        this.controls.target.set(0, 0, -300);
        this.controls.update();
      });
    }
  }

  // Focus camera on a specific creature
  focusOnCreature(creature) {
    if (!creature || !creature.position) return;

    const pos = creature.position;
    // Position camera above and behind the creature
    this.camera.position.set(pos.x, pos.y + 30, pos.z + 50);
    this.controls.target.set(pos.x, pos.y, pos.z);
    this.controls.update();
  }

  initTerrain() {
    const geometry = new THREE.PlaneGeometry(WORLD_SIZE.width, WORLD_SIZE.depth, 100, 100);
    geometry.rotateX(-Math.PI / 2);

    const vertices = geometry.attributes.position.array;
    const colors = [];

    for (let i = 0; i < vertices.length; i += 3) {
      const x = vertices[i];
      const z = vertices[i + 2];

      const y = this.getTerrainHeight(x, z);

      vertices[i + 1] = y;

      // Use Z-based biome for coloring
      const biome = this.getBiomeAt(z);
      const color = new THREE.Color(biome.color);

      colors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      metalness: 0.1
    });

    this.terrain = new THREE.Mesh(geometry, material);
    this.scene.add(this.terrain);

    // Water plane - more transparent to see creatures
    const waterGeo = new THREE.PlaneGeometry(WORLD_SIZE.width, WORLD_SIZE.depth);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x3399ff,
      transparent: true,
      opacity: 0.2,
      roughness: 0.1,
      metalness: 0.3,
      side: THREE.DoubleSide  // Visible from underwater too
    });
    this.water = new THREE.Mesh(waterGeo, waterMat);
    this.water.position.y = 0;
    this.scene.add(this.water);
  }

  getTerrainHeight(x, z) {
    // Small noise for natural variation
    const noise = this.noise2D(x * 0.02, z * 0.02) * 2;

    // Z determines the base terrain height (horizontal bands)
    let baseHeight;

    if (z < -300) {
      // Deep water
      baseHeight = -20;
    } else if (z < -100) {
      // Shoals - gradual slope from deep water to shore
      const t = (z + 300) / 200;
      baseHeight = -20 + t * 20;
    } else if (z < 0) {
      // Beach
      const t = (z + 100) / 100;
      baseHeight = t * 5;
    } else if (z < 200) {
      // Grassland
      const t = z / 200;
      baseHeight = 5 + t * 5;
    } else if (z < 350) {
      // Desert
      const t = (z - 200) / 150;
      baseHeight = 10 + t * 5;
    } else {
      // Tundra
      const t = Math.min(1, (z - 350) / 150);
      baseHeight = 15 + t * 5;
    }

    return baseHeight + noise;
  }

  getBiomeAt(z) {
    if (z < -300) return BIOMES.DEEP_WATER;
    if (z < -100) return BIOMES.SHOALS;
    if (z < 0) return BIOMES.BEACH;
    if (z < 200) return BIOMES.LAND;
    if (z < 350) return BIOMES.DESERT;
    return BIOMES.TUNDRA;
  }

  getBiome(y) {
    // Legacy - kept for compatibility
    if (y < BIOMES.DEEP_WATER.heightMax) return BIOMES.DEEP_WATER;
    if (y < BIOMES.SHOALS.heightMax) return BIOMES.SHOALS;
    if (y < BIOMES.BEACH.heightMax) return BIOMES.BEACH;
    if (y < BIOMES.LAND.heightMax) return BIOMES.LAND;
    if (y < BIOMES.DESERT.heightMax) return BIOMES.DESERT;
    return BIOMES.TUNDRA;
  }

  update(dt) {
    this.time += dt;

    // Camera keyboard controls - move relative to camera direction
    const cameraSpeed = 50 * dt;

    // Get camera's forward direction (projected onto XZ plane)
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    // Get right direction (perpendicular to forward on XZ plane)
    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    // Calculate movement based on arrow keys
    const movement = new THREE.Vector3(0, 0, 0);

    if (this.keys.ArrowUp) {
      movement.add(forward.clone().multiplyScalar(cameraSpeed));
    }
    if (this.keys.ArrowDown) {
      movement.add(forward.clone().multiplyScalar(-cameraSpeed));
    }
    if (this.keys.ArrowLeft) {
      movement.add(right.clone().multiplyScalar(-cameraSpeed));
    }
    if (this.keys.ArrowRight) {
      movement.add(right.clone().multiplyScalar(cameraSpeed));
    }

    // Apply movement to both camera and target
    this.camera.position.add(movement);
    this.controls.target.add(movement);

    // Clamp camera position to scene bounds
    const halfWidth = WORLD_SIZE.width / 2 - 50;  // 450
    const halfDepth = WORLD_SIZE.depth / 2 - 50;  // 450
    const minHeight = -15;  // Allow underwater view
    const maxHeight = 300;

    // Clamp camera position
    this.camera.position.x = Math.max(-halfWidth, Math.min(halfWidth, this.camera.position.x));
    this.camera.position.z = Math.max(-halfDepth, Math.min(halfDepth, this.camera.position.z));
    this.camera.position.y = Math.max(minHeight, Math.min(maxHeight, this.camera.position.y));

    // Clamp target position
    this.controls.target.x = Math.max(-halfWidth, Math.min(halfWidth, this.controls.target.x));
    this.controls.target.z = Math.max(-halfDepth, Math.min(halfDepth, this.controls.target.z));

    this.controls.update();

    // Update plant visibility based on camera position
    this.plantRenderer.updateCulling();

    // Accumulate dt for worker (cap to prevent simulation instability)
    this.accumulatedDt = Math.min(this.accumulatedDt + dt, 0.2);

    // Send accumulated dt to worker if ready and not waiting for response
    if (this.workerReady && !this.pendingUpdate) {
      this.pendingUpdate = true;
      this.worker.postMessage({ type: 'update', data: { dt: this.accumulatedDt } });
      this.accumulatedDt = 0; // Reset after sending
    }

    // Render
    this.renderer.render(this.scene, this.camera);
  }
}
