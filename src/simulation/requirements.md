Evolutionary Simulator: Final Technical Specification
This document specifies the core algorithms, genetic structure, and phenotypic features required for the 3D Evolutionary Simulator. The goal is to model complex natural selection based on energy balance, trade-offs, and dynamic environmental interaction.
I. Genetic Algorithm Mechanics (The "DNA" System)
The simulation will use the following biological mechanics to drive evolution:
A. Core Inheritance and Reproduction
1. Asexual Reproduction (Default): When a creature's energy reaches a high threshold, it clones itself. The parent's energy is split (e.g., 50/50) between parent and offspring.
2. Genome Representation: Each trait is stored as a floating-point value (a "gene") between 0.0 and 1.0, representing the strength/level of that feature. The final Phenotype (e.g., actual speed) is a function of the gene and environmental factors.
B. Mutation (The Engine of Change)
1. Random Point Mutation: Every reproduction event has a defined Mutation Rate (e.g., 10%). If a mutation occurs, a random subset of genes (1-3) is selected.
2. Gaussian Noise (Normal Distribution): The selected gene value is adjusted by adding a random number drawn from a Gaussian (normal) distribution, centered at 0. This ensures that most mutations are small nudges, but occasionally, a large, sudden shift (a beneficial or detrimental 'jump') occurs.
3. Lethal Mutation Check: If the mutation causes the initial metabolic cost to exceed the available starting energy, the creature is instantly aborted (simulating a non-viable zygote).
C. Selection and Fitness (The Driving Force)
1. Survival of the Fittest (Energy-Based): The only selection rule is the Energy Balance. Creatures whose total energy cost (Metabolism + Trait Costs) exceeds their total energy gain (Food + Sunlight) will die.
2. Sexual Selection (Optional Extension): Creatures with high visual traits (e.g., brighter color, complex crests, or larger size) will have a higher Reproduction Threshold. This means they need more energy to reproduce, but their genetic line might be preferred for future complexity.
II. Expanded DNA Structure and Phenotype Features
The creature's DNA will contain a float value (0.0 to 1.0) for each of the following 15 features (Predatory Instinct added). The resulting phenotype must have distinct BONUS and CON trade-offs.
Gene	Phenotype Description	BONUS (Advantage)	CON (Disadvantage/Cost)
Size	Overall body mass.	Higher energy from meat (hunting), higher defense against predators.	Greatly increases Basal Metabolism (Energy Drain).
Speed	Maximum movement velocity.	Faster escape from predators, faster pursuit of prey/food.	Greatly increases movement energy cost (Metabolic Cost).
Sense Radius	Distance at which non-hostile entities (food, plants) are detected.	Higher chance of finding scarce resources before competitors.	High constant energy consumption (Brain Power).
Camouflage Index	How well creature color blends with the current biome.	Lower detection chance by predators; higher success rate for ambush predators.	Must spend metabolic energy to adjust/maintain pigment color.
Armor/Shell	Thickness of external plating/shell.	High protection against physical attacks and environmental friction/damage.	Massively reduces movement speed (slows creature down).
Metabolic Efficiency	Efficiency in converting energy (food) into survival time.	Lower Basal Metabolism (less energy wasted as heat).	Requires longer digestion time, making the creature vulnerable after eating.
Toxicity/Venom	Ability to deter predators or paralyze prey.	Predators get sick/take damage upon consumption; better attack success.	High energy cost to synthesize and store toxins.
Cold Resistance (Fur/Blubber)	Ability to maintain core temperature in low-temp biomes (Tundra/Deep Water).	Minimal energy drain in cold regions; access to cold biomes food.	Reduces efficiency in warm biomes (overheating, increased water loss).
Heat Resistance (Skin)	Ability to withstand high ambient temperatures (Desert/Dry Land).	Minimal energy drain in hot, dry regions; access to land resources.	Reduces efficiency in cold biomes (rapid energy loss from cooling).
Lung Capacity	Time the creature can survive out of water.	Colonize land biomes, escape aquatic predators, access sunnier spots.	Lungs/breathing mechanism consumes significant energy and water reserves.
Scavenging Efficiency	Ability to safely digest rotting/dead matter (Corpses).	Can utilize a food source predators and herbivores ignore; low-risk feeding.	Lower energy gain from fresh/living food sources.
Parasitic Instinct	Tendency to seek and attach to large hosts.	Low-risk, continuous food source; avoids direct combat.	High defense cost, as the host often tries to 'shake' the parasite off.
Reproduction Urgency	Lower energy threshold required to trigger reproduction.	Faster population growth/recovery after disasters.	Offspring have lower starting energy (lower survival odds).
Maneuverability	Hydrodynamic body shape (finer control over movement).	High turning speed and fine spatial control (easier to navigate tight areas).	Lowers top forward velocity (less straight-line speed).
Predatory Instinct (NEW)	NEW: Drive to actively hunt other creatures.	Grants a damage multiplier and a higher chase priority. Crucial for Carnivore role.	High stress/aggression causes increased Basal Metabolism even when not moving.
III. Environmental Biomes & Interactions
The simulation must feature a 3D terrain generated using Perlin Noise, with creature interactions dependent on their location:
Biome Feature	Environmental Effect	Creature Interaction
Solar/Hydrothermal Energy Field	NEW: A third Perlin Noise layer representing light intensity (Sun) or heat vents (Volcanic). Plants consume this energy to multiply faster in high-intensity areas.	High energy areas accelerate the food chain and competition.
Deep Water / Ponds	Global current vector applied. Acts as a barrier due to high drag and limited air access.	Best for aquatic movement. Primitive creatures are trapped here until they evolve Speed and Lung Capacity to overcome the drag and air constraint.
Dry Land / Desert	High Temperature drain applied; movement drastically slowed (high friction).	Creatures must utilize Lung Capacity gene to survive and Heat Resistance to limit energy drain.
Tundra / Ice	Extreme Cold Temperature drain applied.	Creatures must utilize Cold Resistance gene to limit energy drain.
Corpses (Dead Creatures)	Remain in the world for a set time, slowly decaying.	Targeted by Scavengers; provides high energy gain only with high Scavenging Efficiency gene.
Plants / Plankton	Entities that drift with the current in water biomes. Life Cycle (NEW): Plants must consume external energy (Sun/Hydrothermal field) to grow and multiply. They also have a natural decay rate, dying off if not consumed.	Primary food source for Herbivores. Creatures in range (Sense Radius) can "filter feed" (gain a small amount of passive energy).
Hunting/Attack Mechanics (NEW)	Collision-based combat.	Carnivores (high Predatory Instinct) attack creatures smaller than them. Damage is calculated based on Attacker's Predatory Instinct and Toxicity, minus Defender's Armor/Shell and Size.
IV. Visualization, Initial State, and Entity Modeling
A. Initial World State
1. Initial Population Placement: All initial creatures must spawn exclusively within the Deep Water / Ponds biomes.
2. Initial Creature State: Creatures start with low Speed and high Armor/Shell (representing a primitive, passive state). Their primary action is Filter Feeding (consuming nearby static 'Plant' entities within their Sense Radius).
3. Plant Entity: A new entity type, 'Plant/Plankton', must be generated and drift with the currents. Plants are the base energy source.
B. Three.js Visualization Requirements
1. Camera Controls: The 3D environment must be controllable using OrbitControls, enabling the user to freely rotate and zoom the entire world.
2. Creature Scale: Creatures must be sufficiently large relative to the map (e.g., using a minimum base scale factor) to ensure they are visually distinct and observable.
3. Phenotypic Visualization (MANDATORY): Every feature must have a visible consequence on the creature's 3D appearance. This requires combining multiple geometries or materials on a single creature mesh:
    * Size: Controls the overall mesh scale.
    * Armor/Shell: Adds a visible external plating or spiked geometry layer to the mesh.
    * Cold Resistance (Fur/Blubber): Adds a fuzzy texture (Fur) or a thick, translucent white/blue layer (Blubber) to the mesh surface.
    * Toxicity/Venom: Results in highly contrasting, warning colors (e.g., high saturation Red/Yellow stripes) on the mesh.
    * Camouflage Index: The creature's base material color must dynamically shift to closely match the dominant hue of the terrain it is currently over (green over pond, brown over land).
    * Maneuverability: Higher values result in a sleek, elongated, hydrodynamic shape; lower values result in a more spherical or blocky shape.
    * Predatory Instinct: Gives the creature a visible aggressive feature, such as sharp vertices or a pointed head/mouth.
    * Environment Visual Diversity (NEW): The terrain must be clearly differentiated by color based on biomes: Deep Water (dark blue), Shoals/Ponds (light green/cyan), Dry Land/Desert (brown/tan), Tundra/Ice (white/light gray).
V. Simulation Configuration & Dimensions
1. World Dimensions (UPDATED): The simulation space will be a 3D box of 1000 units (Length) x 1000 units (Width) x 200 units (Height). The terrain plane will sit within this volume.
2. Seasonal Cycle: Implement a global temperature variable controlled by a simple sine wave over time.
    * Winter: Low point of the cycle. Increases temperature-related energy costs (Cold Drain) and reduces Plant/Plankton spawn rate.
    * Summer: High point of the cycle. Increases Plant/Plankton spawn rate and reduces energy efficiency for non-Heat Resistant creatures.
This comprehensive prompt covers the necessary algorithms and deep feature complexity required to build a sophisticated simulation.
offs.
Gene	Phenotype Description	BONUS (Advantage)	CON (Disadvantage/Cost)
Size	Overall body mass.	Higher energy from meat (hunting), higher defense against predators.	Greatly increases Basal Metabolism (Energy Drain).
Speed	Maximum movement velocity.	Faster escape from predators, faster pursuit of prey/food.	Greatly increases movement energy cost (Metabolic Cost).
Sense Radius	Distance at which non-hostile entities (food, plants) are detected.	Higher chance of finding scarce resources before competitors.	High constant energy consumption (Brain Power).
Camouflage Index	How well creature color blends with the current biome.	Lower detection chance by predators; higher success rate for ambush predators.	Must spend metabolic energy to adjust/maintain pigment color.
Armor/Shell	Thickness of external plating/shell.	High protection against physical attacks and environmental friction/damage.	Massively reduces movement speed (slows creature down).
Metabolic Efficiency	Efficiency in converting energy (food) into survival time.	Lower Basal Metabolism (less energy wasted as heat).	Requires longer digestion time, making the creature vulnerable after eating.
Toxicity/Venom	Ability to deter predators or paralyze prey.	Predators get sick/take damage upon consumption; better attack success.	High energy cost to synthesize and store toxins.
Cold Resistance (Fur/Blubber)	Ability to maintain core temperature in low-temp biomes (Tundra/Deep Water).	Minimal energy drain in cold regions; access to cold biomes food.	Reduces efficiency in warm biomes (overheating, increased water loss).
Heat Resistance (Skin)	Ability to withstand high ambient temperatures (Desert/Dry Land).	Minimal energy drain in hot, dry regions; access to land resources.	Reduces efficiency in cold biomes (rapid energy loss from cooling).
Lung Capacity	Time the creature can survive out of water.	Colonize land biomes, escape aquatic predators, access sunnier spots.	Lungs/breathing mechanism consumes significant energy and water reserves.
Scavenging Efficiency	Ability to safely digest rotting/dead matter (Corpses).	Can utilize a food source predators and herbivores ignore; low-risk feeding.	Lower energy gain from fresh/living food sources.
Parasitic Instinct	Tendency to seek and attach to large hosts.	Low-risk, continuous food source; avoids direct combat.	High defense cost, as the host often tries to 'shake' the parasite off.
Reproduction Urgency	Lower energy threshold required to trigger reproduction.	Faster population growth/recovery after disasters.	Offspring have lower starting energy (lower survival odds).
Maneuverability	Hydrodynamic body shape (finer control over movement).	High turning speed and fine spatial control (easier to navigate tight areas).	Lowers top forward velocity (less straight-line speed).