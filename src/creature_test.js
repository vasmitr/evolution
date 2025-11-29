import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as dat from 'dat.gui';
import { GENE_DEFINITIONS } from './simulation/Constants.js';

// Import CreatureRenderer from World.js - we need to export it first
// For now, we'll create a compatible data structure that matches what CreatureRenderer expects

// Shared geometries (same as World.js)
const SharedGeometries = {
  body: {
    sphere: new THREE.IcosahedronGeometry(1, 2),
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
  horn: new THREE.ConeGeometry(0.08, 0.4, 6),
  tailSegment: new THREE.CylinderGeometry(0.06, 0.04, 0.2, 6),
};

// CreatureRenderer class - copied from World.js to test creatures identically
class CreatureRenderer {
  constructor(data) {
    this.id = data.id;
    this.data = data;
    this.animTime = 0;
    this.isEating = false;
    this.isAttacking = false;
    this.eatingTimer = 0;

    this.mesh = new THREE.Group();
    this.createMesh(data);
  }

  createMesh(data) {
    const bodyColor = this.getBodyColor(data);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.6,
      metalness: 0.05
    });

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
      this.bodyMesh.rotation.x = Math.PI / 2;
    }
    this.mesh.add(this.bodyMesh);

    const scale = 0.8 + data.size * 1.2;
    const lengthRatio = 1.0 + data.speed * 0.3;
    this.mesh.scale.set(scale, scale * 0.9, scale * lengthRatio);

    this.eyesGroup = new THREE.Group();
    this.limbsGroup = new THREE.Group();
    this.finsGroup = new THREE.Group();
    this.jawsGroup = new THREE.Group();
    this.armorGroup = new THREE.Group();
    this.emergentGroup = new THREE.Group();

    this.mesh.add(this.eyesGroup);
    this.mesh.add(this.limbsGroup);
    this.mesh.add(this.finsGroup);
    this.mesh.add(this.jawsGroup);
    this.mesh.add(this.armorGroup);
    this.mesh.add(this.emergentGroup);

    this.bodyColor = bodyColor;

    this.buildEyes(data);
    this.buildLimbs(data, bodyColor);
    this.buildFins(data);
    this.buildJaws(data);
    this.buildArmor(data);
    this.buildSpecialFeatures(data);
    this.buildEmergentFeatures(data, bodyColor);
  }

  getBodyColor(data) {
    if (data.toxicity > 0.4) {
      return new THREE.Color(0xff3333);
    }
    if (data.predatory > 0.4) {
      return new THREE.Color(0xdd6622);
    }
    if (data.parasitic > 0.3) {
      return new THREE.Color(0x9944aa);
    }
    if (data.scavenging > 0.4) {
      return new THREE.Color(0x886644);
    }
    if (data.coldResistance > 0.4) {
      return new THREE.Color(0x88aacc);
    }
    if (data.heatResistance > 0.4) {
      return new THREE.Color(0xcc8844);
    }
    // HSL hue: 0.0=red, 0.33=green, 0.66=blue
    // Low predatory = more green (hue ~0.33), high predatory = more yellow/orange (hue ~0.1)
    const greenness = 0.33 - data.predatory * 0.2; // 0.33 (green) to 0.13 (yellow-orange)
    return new THREE.Color().setHSL(greenness, 0.6, 0.45);
  }

  buildEyes(data) {
    if (data.sight < 0.15) return;

    const eyeScale = 0.7 + data.sight * 0.5;
    const eyeSpacing = 0.35;
    const eyeForward = 0.92;
    const eyeHeight = 0.25;

    const eyeWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xf8f8f5,
      roughness: 0.2,
      metalness: 0.1
    });

    const irisHue = Math.random() * 0.2 + 0.05;
    const irisMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(irisHue, 0.7, 0.4),
      roughness: 0.3
    });

    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x050505 });
    const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    [-1, 1].forEach((side) => {
      const eyeX = side * eyeSpacing;
      const eyeY = eyeHeight;
      const eyeZ = eyeForward;

      const len = Math.sqrt(eyeX*eyeX + eyeY*eyeY + eyeZ*eyeZ);
      const surfaceX = eyeX / len * 1.02;
      const surfaceY = eyeY / len * 1.02;
      const surfaceZ = eyeZ / len * 1.02;

      const eye = new THREE.Mesh(SharedGeometries.eye, eyeWhiteMat);
      eye.position.set(surfaceX, surfaceY, surfaceZ);
      eye.scale.setScalar(eyeScale);
      this.eyesGroup.add(eye);

      const iris = new THREE.Mesh(SharedGeometries.iris, irisMat);
      iris.position.set(surfaceX, surfaceY, surfaceZ + 0.1 * eyeScale);
      iris.scale.setScalar(eyeScale);
      this.eyesGroup.add(iris);

      const pupil = new THREE.Mesh(SharedGeometries.pupil, pupilMat);
      pupil.position.set(surfaceX, surfaceY, surfaceZ + 0.105 * eyeScale);
      pupil.scale.setScalar(eyeScale);
      pupil.userData.baseX = surfaceX;
      this.eyesGroup.add(pupil);

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
    const limbValue = data.limbs;
    const limbVariativeness = data.limbsVariativeness || 0.5;

    if (limbValue < 0.15) return;

    const limbScale = 0.3 + limbValue * 1.0;
    const limbLength = 0.25 + limbValue * 0.4;
    const limbCount = limbValue > 0.7 ? 6 : (limbValue > 0.4 ? 4 : 2);

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
        const finMat = new THREE.MeshStandardMaterial({
          color: limbColor,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85,
          roughness: 0.5
        });

        const fin = new THREE.Mesh(SharedGeometries.fin, finMat);
        fin.scale.set(1, limbScale * 1.5, limbScale * 1.2);
        limbGroup.add(fin);

        limbGroup.position.set(side * 0.9, 0, zOffset);
        limbGroup.rotation.z = side * 0.8;
        limbGroup.rotation.y = side * 0.3;

      } else if (limbType === 'claw') {
        const socket = new THREE.Mesh(SharedGeometries.joint, limbMat);
        socket.scale.setScalar(limbScale * 1.2);
        limbGroup.add(socket);

        const upperArm = new THREE.Mesh(SharedGeometries.limb, limbMat);
        upperArm.scale.set(limbScale * 1.1, limbLength * 1.2, limbScale * 1.1);
        upperArm.position.y = -limbLength * 0.2;
        limbGroup.add(upperArm);

        const forearm = new THREE.Mesh(SharedGeometries.limb, limbMat);
        forearm.scale.set(limbScale * 0.9, limbLength * 1.0, limbScale * 0.9);
        forearm.position.y = -limbLength * 0.55;
        limbGroup.add(forearm);

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

        const attachX = side * 0.95;
        const attachY = -0.25;
        const len = Math.sqrt(attachX*attachX + attachY*attachY + zOffset*zOffset);
        limbGroup.position.set(attachX / len, attachY / len, zOffset / len);
        limbGroup.rotation.z = side * 0.5;
        limbGroup.rotation.x = 0.2;

      } else {
        const socket = new THREE.Mesh(SharedGeometries.joint, limbMat);
        socket.scale.set(limbScale * 1.1, limbScale * 0.9, limbScale * 1.1);
        limbGroup.add(socket);

        const thigh = new THREE.Mesh(SharedGeometries.limb, limbMat);
        thigh.scale.set(limbScale * 1.1, limbLength * 1.4, limbScale * 1.1);
        thigh.position.y = -limbLength * 0.2;
        limbGroup.add(thigh);

        const knee = new THREE.Mesh(SharedGeometries.joint, limbMat);
        knee.scale.setScalar(limbScale * 0.85);
        knee.position.y = -limbLength * 0.42;
        limbGroup.add(knee);

        const shin = new THREE.Mesh(SharedGeometries.limb, limbMat);
        shin.scale.set(limbScale * 0.85, limbLength * 1.3, limbScale * 0.85);
        shin.position.y = -limbLength * 0.65;
        limbGroup.add(shin);

        const foot = new THREE.Mesh(SharedGeometries.foot, limbMat);
        foot.position.y = -limbLength * 0.9;
        foot.scale.set(limbScale * 1.3, limbScale * 0.5, limbScale * 1.5);
        limbGroup.add(foot);

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
    if (data.speed < 0.25 || data.limbs > 0.5) return;

    const finMat = new THREE.MeshStandardMaterial({
      color: this.bodyColor.clone().multiplyScalar(0.8),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });

    // Dorsal fin
    const dorsalFin = new THREE.Mesh(SharedGeometries.tailFin, finMat);
    dorsalFin.position.set(0, 0.8, 0);
    dorsalFin.rotation.x = -0.2;
    dorsalFin.scale.set(1, 0.8, 1.5);
    this.finsGroup.add(dorsalFin);

    // Tail fin
    const tailFin = new THREE.Mesh(SharedGeometries.tailFin, finMat);
    tailFin.position.set(0, 0, -1.1);
    tailFin.rotation.x = Math.PI / 2;
    tailFin.scale.set(1, 1.2, 1);
    tailFin.userData.isTailFin = true;
    this.finsGroup.add(tailFin);

    // Side fins
    [-1, 1].forEach(side => {
      const sideFin = new THREE.Mesh(SharedGeometries.fin, finMat);
      sideFin.position.set(side * 0.9, -0.1, 0.2);
      sideFin.rotation.z = side * 0.8;
      sideFin.scale.set(1, 0.6, 1.2);
      this.finsGroup.add(sideFin);
    });
  }

  buildJaws(data) {
    if (data.jaws < 0.2) return;

    const jawValue = data.jaws;
    const jawVariativeness = data.jawsVariativeness || 0.5;

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
      const mouthMat = new THREE.MeshStandardMaterial({
        color: 0x554433,
        roughness: 0.6
      });

      const mouthGeo = new THREE.TorusGeometry(0.15 * jawScale, 0.04 * jawScale, 8, 12, Math.PI);
      const mouth = new THREE.Mesh(mouthGeo, mouthMat);
      mouth.position.set(0, -0.15, 0.95);
      mouth.rotation.x = Math.PI / 2;
      mouth.rotation.z = Math.PI;
      this.jawsGroup.add(mouth);

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

      this.jawsGroup.userData.isFilter = true;

    } else if (jawType === 'fangs') {
      const jawBoneMat = new THREE.MeshStandardMaterial({
        color: 0x443322,
        roughness: 0.5
      });
      const toothMat = new THREE.MeshStandardMaterial({
        color: 0xeeeedd,
        roughness: 0.3
      });

      const upperJawGeo = new THREE.BoxGeometry(0.25 * jawScale, 0.06 * jawScale, 0.15 * jawScale);
      const upperJaw = new THREE.Mesh(upperJawGeo, jawBoneMat);
      upperJaw.position.set(0, 0.05, 0.95);
      upperJaw.userData.isUpperJaw = true;
      upperJaw.userData.baseY = 0.05;
      this.jawsGroup.add(upperJaw);

      const lowerJawGeo = new THREE.BoxGeometry(0.22 * jawScale, 0.05 * jawScale, 0.14 * jawScale);
      const lowerJaw = new THREE.Mesh(lowerJawGeo, jawBoneMat);
      lowerJaw.position.set(0, -0.12, 0.93);
      lowerJaw.userData.isLowerJaw = true;
      lowerJaw.userData.baseY = -0.12;
      lowerJaw.userData.baseRotX = 0;
      this.jawsGroup.add(lowerJaw);

      const upperToothCount = Math.floor(3 + jawValue * 4);
      for (let i = 0; i < upperToothCount; i++) {
        const tooth = new THREE.Mesh(SharedGeometries.tooth, toothMat);
        const t = (i / (upperToothCount - 1)) - 0.5;
        tooth.position.set(t * 0.2 * jawScale, -0.04 * jawScale, 0.05 * jawScale);
        tooth.rotation.x = Math.PI;
        tooth.scale.setScalar(0.8 + jawValue * 0.4);
        if (Math.abs(t) < 0.2) tooth.scale.y *= 1.5;
        upperJaw.add(tooth);
      }

      const lowerToothCount = Math.floor(2 + jawValue * 3);
      for (let i = 0; i < lowerToothCount; i++) {
        const tooth = new THREE.Mesh(SharedGeometries.tooth, toothMat);
        const t = (i / (lowerToothCount - 1)) - 0.5;
        tooth.position.set(t * 0.18 * jawScale, 0.03 * jawScale, 0.04 * jawScale);
        tooth.scale.setScalar(0.6 + jawValue * 0.3);
        lowerJaw.add(tooth);
      }

      this.jawsGroup.userData.upperJaw = upperJaw;
      this.jawsGroup.userData.lowerJaw = lowerJaw;
      this.jawsGroup.userData.isFangs = true;

    } else if (jawType === 'proboscis') {
      const proboscisMat = new THREE.MeshStandardMaterial({
        color: 0x662266,
        roughness: 0.3,
        metalness: 0.2
      });

      const tubeLength = 0.4 + jawValue * 0.4;
      const tubeGeo = new THREE.CylinderGeometry(0.015, 0.04, tubeLength, 8);
      const tube = new THREE.Mesh(tubeGeo, proboscisMat);
      tube.position.set(0, -0.1, 0.9);
      tube.rotation.x = Math.PI * 0.35;
      tube.userData.isProboscis = true;
      tube.userData.baseRotX = tube.rotation.x;
      tube.userData.baseZ = tube.position.z;
      this.jawsGroup.add(tube);

      const sheathMat = new THREE.MeshStandardMaterial({
        color: 0x553355,
        roughness: 0.5
      });
      const sheathGeo = new THREE.CylinderGeometry(0.06, 0.04, 0.12, 8);
      const sheath = new THREE.Mesh(sheathGeo, sheathMat);
      sheath.position.set(0, -0.05, 0.85);
      sheath.rotation.x = Math.PI * 0.3;
      this.jawsGroup.add(sheath);

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

      this.jawsGroup.userData.proboscis = tube;
      this.jawsGroup.userData.isProboscis = true;

    } else if (jawType === 'carrion') {
      const jawBoneMat = new THREE.MeshStandardMaterial({
        color: 0x553311,
        roughness: 0.6,
        metalness: 0.1
      });
      const toothMat = new THREE.MeshStandardMaterial({
        color: 0xccbb99,
        roughness: 0.5
      });

      const upperJawGeo = new THREE.BoxGeometry(0.3 * jawScale, 0.08 * jawScale, 0.18 * jawScale);
      const upperJaw = new THREE.Mesh(upperJawGeo, jawBoneMat);
      upperJaw.position.set(0, 0.03, 0.92);
      upperJaw.userData.isUpperJaw = true;
      upperJaw.userData.baseY = 0.03;
      this.jawsGroup.add(upperJaw);

      const lowerJawGeo = new THREE.BoxGeometry(0.28 * jawScale, 0.1 * jawScale, 0.16 * jawScale);
      const lowerJaw = new THREE.Mesh(lowerJawGeo, jawBoneMat);
      lowerJaw.position.set(0, -0.15, 0.9);
      lowerJaw.userData.isLowerJaw = true;
      lowerJaw.userData.baseY = -0.15;
      lowerJaw.userData.baseRotX = 0;
      this.jawsGroup.add(lowerJaw);

      const upperToothCount = Math.floor(4 + jawValue * 3);
      for (let i = 0; i < upperToothCount; i++) {
        const isBlunt = i % 2 === 0;
        let toothGeo;
        if (isBlunt) {
          toothGeo = new THREE.BoxGeometry(0.035, 0.04 * jawScale, 0.03);
        } else {
          toothGeo = new THREE.ConeGeometry(0.02, 0.05 * jawScale, 4);
        }
        const tooth = new THREE.Mesh(toothGeo, toothMat);
        const t = (i / (upperToothCount - 1)) - 0.5;
        tooth.position.set(t * 0.24 * jawScale, -0.05 * jawScale, 0.06 * jawScale);
        if (!isBlunt) tooth.rotation.x = Math.PI;
        upperJaw.add(tooth);
      }

      const lowerToothCount = Math.floor(3 + jawValue * 3);
      for (let i = 0; i < lowerToothCount; i++) {
        const isBlunt = i % 2 === 1;
        let toothGeo;
        if (isBlunt) {
          toothGeo = new THREE.BoxGeometry(0.04, 0.035 * jawScale, 0.035);
        } else {
          toothGeo = new THREE.ConeGeometry(0.018, 0.04 * jawScale, 4);
        }
        const tooth = new THREE.Mesh(toothGeo, toothMat);
        const t = (i / (lowerToothCount - 1)) - 0.5;
        tooth.position.set(t * 0.22 * jawScale, 0.055 * jawScale, 0.05 * jawScale);
        lowerJaw.add(tooth);
      }

      this.jawsGroup.userData.upperJaw = upperJaw;
      this.jawsGroup.userData.lowerJaw = lowerJaw;
      this.jawsGroup.userData.isCarrion = true;

    } else {
      // Mandibles (default)
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

      this.jawsGroup.userData.left = this.jawsGroup.children[0];
      this.jawsGroup.userData.right = this.jawsGroup.children[1];
      this.jawsGroup.userData.isMandible = true;
    }
  }

  buildArmor(data) {
    if (data.armor < 0.3) return;

    // Segmented armor plates along the back (like an armadillo or trilobite)
    const plateMat = new THREE.MeshStandardMaterial({
      color: 0x3d2817,
      roughness: 0.4,
      metalness: 0.15
    });

    const plateCount = 3 + Math.floor(data.armor * 3); // 3-6 plates based on armor
    const plateSize = 0.25 + data.armor * 0.1;

    for (let i = 0; i < plateCount; i++) {
      const t = (i / (plateCount - 1)) - 0.5; // -0.5 to 0.5
      const zPos = t * 0.8; // Spread along body length

      const plateGeo = new THREE.CylinderGeometry(plateSize, plateSize * 0.9, 0.08, 8);
      const plate = new THREE.Mesh(plateGeo, plateMat);
      plate.rotation.x = Math.PI / 2;
      plate.position.set(0, 0.35, zPos); // On top of body, not covering sides
      plate.scale.set(1, 1, 0.7);
      this.armorGroup.add(plate);
    }
  }

  buildSpecialFeatures(data) {
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

    if (ef.wings > 0.1) {
      const wingSize = 0.3 + ef.wings * 0.8;
      const wingMat = new THREE.MeshStandardMaterial({
        color: bodyColor.clone().multiplyScalar(0.9),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.7 + ef.wings * 0.2,
        roughness: 0.3
      });

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

    if (ef.bioluminescence > 0.15) {
      const glowIntensity = ef.bioluminescence;
      const glowColor = new THREE.Color().setHSL(
        0.5 + Math.random() * 0.3,
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

        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI * 0.5;
        const r = 0.95;
        spike.position.set(
          Math.sin(theta) * Math.cos(phi) * r,
          Math.sin(phi) * r + 0.2,
          Math.cos(theta) * Math.cos(phi) * r
        );

        spike.lookAt(spike.position.clone().multiplyScalar(2));
        this.emergentGroup.add(spike);
      }
    }

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

  update(dt) {
    this.animTime += dt;

    // Jaw animations
    const jawData = this.jawsGroup.userData;

    if (jawData.isMandible && jawData.left && jawData.right) {
      const left = jawData.left;
      const right = jawData.right;
      const idle = Math.sin(this.animTime * 2) * 0.1;
      left.rotation.z = left.userData.baseRotationZ - idle;
      right.rotation.z = right.userData.baseRotationZ + idle;

    } else if ((jawData.isFangs || jawData.isCarrion) && jawData.upperJaw && jawData.lowerJaw) {
      const upper = jawData.upperJaw;
      const lower = jawData.lowerJaw;
      const idle = Math.sin(this.animTime * 1.5) * 0.02;
      upper.position.y = upper.userData.baseY + idle;
      lower.position.y = lower.userData.baseY - idle;

    } else if (jawData.isProboscis && jawData.proboscis) {
      const prob = jawData.proboscis;
      prob.rotation.x = prob.userData.baseRotX + Math.sin(this.animTime * 2) * 0.05;
      prob.rotation.y = Math.sin(this.animTime * 1.5) * 0.05;

    } else if (jawData.isFilter) {
      this.jawsGroup.children.forEach(child => {
        if (child.userData.plateIndex !== undefined) {
          const platePhase = child.userData.plateIndex * 0.5;
          const wave = Math.sin(this.animTime * 2 + platePhase) * 0.05;
          child.rotation.x = wave;
        }
      });
    }

    // Limb animations
    if (this.limbsGroup.children.length > 0) {
      this.limbsGroup.children.forEach((child) => {
        if (child.userData.side === undefined) return;

        const side = child.userData.side;
        const pairIndex = child.userData.pairIndex || 0;
        const limbType = child.userData.limbType || 'leg';
        const phase = this.animTime * 3 + pairIndex * Math.PI;

        if (limbType === 'fin') {
          const paddle = Math.sin(phase) * 0.2;
          child.rotation.z = child.userData.initialRotation.z + paddle * side;
        } else if (limbType === 'claw') {
          const reach = Math.sin(phase) * 0.15;
          child.rotation.x = (child.userData.initialRotation?.x || 0.2) + reach;

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
          const swing = Math.sin(phase) * 0.2;
          child.rotation.x = (child.userData.initialRotation?.x || 0.25) + swing;
        }
      });
    }

    // Wing flapping
    if (this.emergentGroup.children.length > 0) {
      this.emergentGroup.children.forEach(child => {
        if (child.userData.isWing) {
          const side = child.userData.side;
          const flap = Math.sin(this.animTime * 3) * 0.15;
          child.rotation.z = flap * side;
        }

        if (child.userData.glowPhase !== undefined && child.material) {
          const pulse = 0.5 + Math.sin(this.animTime * 2 + child.userData.glowPhase) * 0.5;
          child.material.emissiveIntensity = pulse * 2;
        }

        if (child.userData.tailIndex !== undefined && child.userData.basePos) {
          const idx = child.userData.tailIndex;
          const sway = Math.sin(this.animTime * 3 + idx * 0.5) * 0.1 * (idx + 1);
          child.position.x = child.userData.basePos.x + sway;
        }
      });
    }

    // Antennae twitching
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

    // Breathing
    const breathe = 1 + Math.sin(this.animTime * 1.5) * 0.015;
    this.bodyMesh.scale.setScalar(breathe);
  }

  dispose() {
    this.mesh.traverse((child) => {
      if (child.material) child.material.dispose();
    });
  }
}

// Setup Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x333333);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(5, 5, 5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(5, 10, 7);
scene.add(dirLight);

const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
backLight.position.set(-5, 5, -5);
scene.add(backLight);

// Grid
const gridHelper = new THREE.GridHelper(20, 20);
scene.add(gridHelper);

const axesHelper = new THREE.AxesHelper(2);
scene.add(axesHelper);

// Creature data (same format as simulation)
let creatureData = {
  id: 1,
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  size: 0.5,
  speed: 0.5,
  sight: 0.5,
  smell: 0.3,
  hearing: 0.3,
  limbs: 0.5,
  limbsVariativeness: 0.5,
  jaws: 0.5,
  jawsVariativeness: 0.5,
  armor: 0.3,
  toxicity: 0.0,
  predatory: 0.3,
  scavenging: 0.0,
  parasitic: 0.0,
  filterFeeding: 0.2,
  coldResistance: 0.2,
  heatResistance: 0.2,
  maneuverability: 0.5,
  lungCapacity: 0.3,
  emergentFeatures: {
    wings: 0,
    bioluminescence: 0,
    spikes: 0,
    tail: 0,
    horn: 0,
    shell: 0
  }
};

let creature = null;

function createCreature() {
  try {
    if (creature) {
      scene.remove(creature.mesh);
      creature.dispose();
    }

    creature = new CreatureRenderer(creatureData);
    scene.add(creature.mesh);
    document.getElementById('info').innerHTML = "Creature Gene Tester (Simulation Renderer)<br>Use controls to modify genes";
  } catch (e) {
    console.error("Error creating creature:", e);
    document.getElementById('info').innerHTML = `Error creating creature: ${e.message}`;
  }
}

createCreature();

// GUI
const gui = new dat.GUI();

// Main genes folder
const geneFolder = gui.addFolder('Genes');
geneFolder.open();

// Add sliders for each gene
const geneParams = ['size', 'speed', 'sight', 'smell', 'hearing', 'limbs', 'jaws', 'armor',
                    'toxicity', 'predatory', 'scavenging', 'parasitic', 'filterFeeding',
                    'coldResistance', 'heatResistance', 'maneuverability', 'lungCapacity'];

geneParams.forEach(key => {
  geneFolder.add(creatureData, key, 0, 1).name(GENE_DEFINITIONS[key]?.name || key).onChange(() => {
    createCreature();
  });
});

// Variativeness folder (controls TYPE of features)
const varFolder = gui.addFolder('Variativeness (TYPE)');
varFolder.open();

varFolder.add(creatureData, 'limbsVariativeness', 0, 1).name('Limbs Type').onChange(() => {
  createCreature();
});
varFolder.add(creatureData, 'jawsVariativeness', 0, 1).name('Jaws Type').onChange(() => {
  createCreature();
});

// Emergent features folder
const emergentFolder = gui.addFolder('Emergent Features');
emergentFolder.open();

['wings', 'bioluminescence', 'spikes', 'tail', 'horn', 'shell'].forEach(key => {
  emergentFolder.add(creatureData.emergentFeatures, key, 0, 1).name(key).onChange(() => {
    createCreature();
  });
});

// Actions
const actions = {
  randomize: () => {
    geneParams.forEach(key => {
      creatureData[key] = Math.random();
    });
    creatureData.limbsVariativeness = Math.random();
    creatureData.jawsVariativeness = Math.random();
    ['wings', 'bioluminescence', 'spikes', 'tail', 'horn', 'shell'].forEach(key => {
      creatureData.emergentFeatures[key] = Math.random() * 0.5; // Lower values for emergent
    });
    gui.updateDisplay();
    createCreature();
  },

  presetPredator: () => {
    creatureData.size = 0.8;
    creatureData.speed = 0.7;
    creatureData.sight = 0.8;
    creatureData.predatory = 0.8;
    creatureData.jaws = 0.9;
    creatureData.jawsVariativeness = 0.9; // Fangs
    creatureData.limbs = 0.6;
    creatureData.limbsVariativeness = 0.8; // Claws
    creatureData.armor = 0.2;
    creatureData.toxicity = 0;
    creatureData.parasitic = 0;
    creatureData.scavenging = 0;
    gui.updateDisplay();
    createCreature();
  },

  presetParasite: () => {
    creatureData.size = 0.3;
    creatureData.speed = 0.4;
    creatureData.sight = 0.3;
    creatureData.predatory = 0.2;
    creatureData.parasitic = 0.8;
    creatureData.jaws = 0.6;
    creatureData.limbs = 0.4;
    creatureData.limbsVariativeness = 0.8; // Claws for gripping
    creatureData.toxicity = 0.3;
    creatureData.scavenging = 0;
    gui.updateDisplay();
    createCreature();
  },

  presetScavenger: () => {
    creatureData.size = 0.5;
    creatureData.speed = 0.4;
    creatureData.smell = 0.9;
    creatureData.scavenging = 0.8;
    creatureData.jaws = 0.8;
    creatureData.limbs = 0.5;
    creatureData.limbsVariativeness = 0.5; // Legs
    creatureData.predatory = 0.2;
    creatureData.parasitic = 0;
    gui.updateDisplay();
    createCreature();
  },

  presetFilterFeeder: () => {
    creatureData.size = 0.6;
    creatureData.speed = 0.3;
    creatureData.filterFeeding = 0.9;
    creatureData.jaws = 0.6;
    creatureData.jawsVariativeness = 0.1; // Filter mouth
    creatureData.limbs = 0.3;
    creatureData.limbsVariativeness = 0.1; // Fins
    creatureData.predatory = 0;
    creatureData.parasitic = 0;
    creatureData.scavenging = 0;
    gui.updateDisplay();
    createCreature();
  },

  presetAquatic: () => {
    creatureData.speed = 0.8;
    creatureData.limbs = 0.7;
    creatureData.limbsVariativeness = 0.15; // Fins
    creatureData.lungCapacity = 0.9;
    creatureData.maneuverability = 0.7;
    creatureData.jaws = 0.5;
    creatureData.jawsVariativeness = 0.5; // Mandibles
    gui.updateDisplay();
    createCreature();
  },

  presetLandPredator: () => {
    creatureData.size = 0.9;
    creatureData.speed = 0.6;
    creatureData.sight = 0.7;
    creatureData.predatory = 0.9;
    creatureData.jaws = 0.95;
    creatureData.jawsVariativeness = 0.95; // Big fangs
    creatureData.limbs = 0.8;
    creatureData.limbsVariativeness = 0.5; // Legs
    creatureData.armor = 0.4;
    creatureData.lungCapacity = 0.2;
    gui.updateDisplay();
    createCreature();
  }
};

gui.add(actions, 'randomize').name('Randomize');
gui.add(actions, 'presetPredator').name('Preset: Predator');
gui.add(actions, 'presetParasite').name('Preset: Parasite');
gui.add(actions, 'presetScavenger').name('Preset: Scavenger');
gui.add(actions, 'presetFilterFeeder').name('Preset: Filter Feeder');
gui.add(actions, 'presetAquatic').name('Preset: Aquatic');
gui.add(actions, 'presetLandPredator').name('Preset: Land Predator');

// Animation Loop
function animate() {
  requestAnimationFrame(animate);

  controls.update();

  if (creature) {
    creature.mesh.rotation.y += 0.005;
    creature.update(0.016);
  }

  renderer.render(scene, camera);
}

animate();

// Handle resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
