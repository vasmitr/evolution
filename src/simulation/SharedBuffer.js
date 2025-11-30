/**
 * SharedBuffer - Zero-copy data transfer between worker and main thread
 *
 * Uses SharedArrayBuffer for direct memory access without serialization overhead.
 * This eliminates the ~2MB/frame postMessage serialization bottleneck.
 *
 * Memory Layout:
 * - Header: metadata (counts, flags)
 * - Creatures: position, velocity, energy, age, flags
 * - Plants: position, energy, flags
 * - Corpses: position, energy, size, toxicity, flags
 */

// Field counts per entity type (for stride calculation)
export const CREATURE_FLOATS = 12;  // id, posX, posY, posZ, velX, velY, velZ, energy, age, developmentProgress, flags (dead|mature packed), padding
export const PLANT_FLOATS = 6;      // id, posX, posY, posZ, energy, flags (dead|isOnLand|mature packed)
export const CORPSE_FLOATS = 8;     // id, posX, posY, posZ, energy, size, toxicity, flags (dead packed)

// Header layout (Int32)
export const HEADER_SIZE = 16;  // 16 int32s = 64 bytes
export const HEADER = {
  CREATURE_COUNT: 0,
  PLANT_COUNT: 1,
  CORPSE_COUNT: 2,
  FRAME_READY: 3,      // Atomics flag: 0 = worker writing, 1 = main can read
  FRAME_NUMBER: 4,
  // Reserved for future use
};

// Maximum entity counts (determines buffer size)
export const MAX_CREATURES = 15000;
export const MAX_PLANTS = 30000;
export const MAX_CORPSES = 5000;

// Calculate buffer offsets (in bytes)
const HEADER_BYTES = HEADER_SIZE * 4;
const CREATURES_OFFSET = HEADER_BYTES;
const CREATURES_BYTES = MAX_CREATURES * CREATURE_FLOATS * 4;
const PLANTS_OFFSET = CREATURES_OFFSET + CREATURES_BYTES;
const PLANTS_BYTES = MAX_PLANTS * PLANT_FLOATS * 4;
const CORPSES_OFFSET = PLANTS_OFFSET + PLANTS_BYTES;
const CORPSES_BYTES = MAX_CORPSES * CORPSE_FLOATS * 4;
const TOTAL_BYTES = CORPSES_OFFSET + CORPSES_BYTES;

/**
 * Create the SharedArrayBuffer with all views
 */
export function createSharedBuffer() {
  const sab = new SharedArrayBuffer(TOTAL_BYTES);

  return {
    buffer: sab,
    header: new Int32Array(sab, 0, HEADER_SIZE),
    creatures: new Float32Array(sab, CREATURES_OFFSET, MAX_CREATURES * CREATURE_FLOATS),
    plants: new Float32Array(sab, PLANTS_OFFSET, MAX_PLANTS * PLANT_FLOATS),
    corpses: new Float32Array(sab, CORPSES_OFFSET, MAX_CORPSES * CORPSE_FLOATS),
  };
}

/**
 * Attach views to an existing SharedArrayBuffer (for worker side)
 */
export function attachSharedBuffer(sab) {
  return {
    buffer: sab,
    header: new Int32Array(sab, 0, HEADER_SIZE),
    creatures: new Float32Array(sab, CREATURES_OFFSET, MAX_CREATURES * CREATURE_FLOATS),
    plants: new Float32Array(sab, PLANTS_OFFSET, MAX_PLANTS * PLANT_FLOATS),
    corpses: new Float32Array(sab, CORPSES_OFFSET, MAX_CORPSES * CORPSE_FLOATS),
  };
}

/**
 * Pack boolean flags into a single float
 * Bit 0: dead
 * Bit 1: mature
 * Bit 2: isOnLand (plants only)
 */
export function packFlags(dead, mature = false, isOnLand = false) {
  return (dead ? 1 : 0) | (mature ? 2 : 0) | (isOnLand ? 4 : 0);
}

export function unpackFlags(flags) {
  const f = Math.floor(flags);
  return {
    dead: (f & 1) !== 0,
    mature: (f & 2) !== 0,
    isOnLand: (f & 4) !== 0,
  };
}

/**
 * Worker-side: Write creature data to shared buffer
 */
export function writeCreature(creatures, index, creature) {
  const offset = index * CREATURE_FLOATS;
  creatures[offset + 0] = creature.id;
  creatures[offset + 1] = creature.position.x;
  creatures[offset + 2] = creature.position.y;
  creatures[offset + 3] = creature.position.z;
  creatures[offset + 4] = creature.velocity.x;
  creatures[offset + 5] = creature.velocity.y;
  creatures[offset + 6] = creature.velocity.z;
  creatures[offset + 7] = creature.energy;
  creatures[offset + 8] = creature.age;
  creatures[offset + 9] = creature.developmentProgress;
  creatures[offset + 10] = packFlags(creature.dead, creature.mature);
  creatures[offset + 11] = 0; // padding for alignment
}

/**
 * Main thread: Read creature data from shared buffer
 */
export function readCreature(creatures, index) {
  const offset = index * CREATURE_FLOATS;
  const flags = unpackFlags(creatures[offset + 10]);
  return {
    id: creatures[offset + 0],
    position: {
      x: creatures[offset + 1],
      y: creatures[offset + 2],
      z: creatures[offset + 3],
    },
    velocity: {
      x: creatures[offset + 4],
      y: creatures[offset + 5],
      z: creatures[offset + 6],
    },
    energy: creatures[offset + 7],
    age: creatures[offset + 8],
    developmentProgress: creatures[offset + 9],
    dead: flags.dead,
    mature: flags.mature,
  };
}

/**
 * Worker-side: Write plant data to shared buffer
 */
export function writePlant(plants, index, plant) {
  const offset = index * PLANT_FLOATS;
  plants[offset + 0] = plant.id;
  plants[offset + 1] = plant.position.x;
  plants[offset + 2] = plant.position.y;
  plants[offset + 3] = plant.position.z;
  plants[offset + 4] = plant.energy;
  plants[offset + 5] = packFlags(plant.dead, plant.mature, plant.isOnLand);
}

/**
 * Main thread: Read plant data from shared buffer
 */
export function readPlant(plants, index) {
  const offset = index * PLANT_FLOATS;
  const flags = unpackFlags(plants[offset + 5]);
  return {
    id: plants[offset + 0],
    position: {
      x: plants[offset + 1],
      y: plants[offset + 2],
      z: plants[offset + 3],
    },
    energy: plants[offset + 4],
    dead: flags.dead,
    mature: flags.mature,
    isOnLand: flags.isOnLand,
  };
}

/**
 * Worker-side: Write corpse data to shared buffer
 */
export function writeCorpse(corpses, index, corpse) {
  const offset = index * CORPSE_FLOATS;
  corpses[offset + 0] = corpse.id;
  corpses[offset + 1] = corpse.position.x;
  corpses[offset + 2] = corpse.position.y;
  corpses[offset + 3] = corpse.position.z;
  corpses[offset + 4] = corpse.energy;
  corpses[offset + 5] = corpse.size;
  corpses[offset + 6] = corpse.toxicity;
  corpses[offset + 7] = packFlags(corpse.dead);
}

/**
 * Main thread: Read corpse data from shared buffer
 */
export function readCorpse(corpses, index) {
  const offset = index * CORPSE_FLOATS;
  const flags = unpackFlags(corpses[offset + 7]);
  return {
    id: corpses[offset + 0],
    position: {
      x: corpses[offset + 1],
      y: corpses[offset + 2],
      z: corpses[offset + 3],
    },
    energy: corpses[offset + 4],
    size: corpses[offset + 5],
    toxicity: corpses[offset + 6],
    dead: flags.dead,
    isCorpse: true,
  };
}

/**
 * Worker-side: Write all entities to shared buffer
 * Call this at end of update() instead of creating objects
 */
export function writeAllToBuffer(shared, creatures, plants, corpses) {
  // Mark buffer as being written (main thread should wait)
  Atomics.store(shared.header, HEADER.FRAME_READY, 0);

  // Write counts
  const creatureCount = Math.min(creatures.length, MAX_CREATURES);
  const plantCount = Math.min(plants.length, MAX_PLANTS);
  const corpseCount = Math.min(corpses.length, MAX_CORPSES);

  shared.header[HEADER.CREATURE_COUNT] = creatureCount;
  shared.header[HEADER.PLANT_COUNT] = plantCount;
  shared.header[HEADER.CORPSE_COUNT] = corpseCount;

  // Write creatures
  for (let i = 0; i < creatureCount; i++) {
    writeCreature(shared.creatures, i, creatures[i]);
  }

  // Write plants
  for (let i = 0; i < plantCount; i++) {
    writePlant(shared.plants, i, plants[i]);
  }

  // Write corpses
  for (let i = 0; i < corpseCount; i++) {
    writeCorpse(shared.corpses, i, corpses[i]);
  }

  // Increment frame number and signal ready
  shared.header[HEADER.FRAME_NUMBER]++;
  Atomics.store(shared.header, HEADER.FRAME_READY, 1);
  Atomics.notify(shared.header, HEADER.FRAME_READY);
}

/**
 * Main thread: Read all entities from shared buffer
 * Returns arrays of entity data (creates objects only for what's needed)
 */
export function readAllFromBuffer(shared) {
  // Wait for worker to finish writing (with timeout)
  const result = Atomics.wait(shared.header, HEADER.FRAME_READY, 0, 16); // 16ms timeout
  if (result === 'timed-out') {
    // Return null to indicate no new data available
    return null;
  }

  const creatureCount = shared.header[HEADER.CREATURE_COUNT];
  const plantCount = shared.header[HEADER.PLANT_COUNT];
  const corpseCount = shared.header[HEADER.CORPSE_COUNT];

  return {
    creatureCount,
    plantCount,
    corpseCount,
    frameNumber: shared.header[HEADER.FRAME_NUMBER],
    // Don't read all entities - provide accessor for on-demand reading
    // This avoids creating thousands of objects if not needed
  };
}

/**
 * Iterate creatures without allocating objects (for distance culling)
 * Calls callback with (id, x, y, z, index) - only allocate full object if needed
 */
export function forEachCreaturePosition(shared, callback) {
  const count = shared.header[HEADER.CREATURE_COUNT];
  for (let i = 0; i < count; i++) {
    const offset = i * CREATURE_FLOATS;
    const id = shared.creatures[offset + 0];
    const x = shared.creatures[offset + 1];
    const y = shared.creatures[offset + 2];
    const z = shared.creatures[offset + 3];
    callback(id, x, y, z, i);
  }
}

/**
 * Iterate plants without allocating objects
 */
export function forEachPlantPosition(shared, callback) {
  const count = shared.header[HEADER.PLANT_COUNT];
  for (let i = 0; i < count; i++) {
    const offset = i * PLANT_FLOATS;
    const id = shared.plants[offset + 0];
    const x = shared.plants[offset + 1];
    const y = shared.plants[offset + 2];
    const z = shared.plants[offset + 3];
    const flags = unpackFlags(shared.plants[offset + 5]);
    callback(id, x, y, z, i, flags.isOnLand);
  }
}

/**
 * Iterate corpses without allocating objects
 */
export function forEachCorpsePosition(shared, callback) {
  const count = shared.header[HEADER.CORPSE_COUNT];
  for (let i = 0; i < count; i++) {
    const offset = i * CORPSE_FLOATS;
    const id = shared.corpses[offset + 0];
    const x = shared.corpses[offset + 1];
    const y = shared.corpses[offset + 2];
    const z = shared.corpses[offset + 3];
    callback(id, x, y, z, i);
  }
}

// Export buffer size for debugging
export const BUFFER_SIZE_MB = (TOTAL_BYTES / (1024 * 1024)).toFixed(2);
