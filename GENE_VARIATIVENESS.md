# Gene Variativeness System

## Overview
The gene variativeness system adds a second dimension to genetic evolution. Each gene now has two properties:
- **Value** (0-1): How much of that trait the creature has
- **Variativeness** (0-1): How that trait is expressed physically

## How It Works

### Gene Structure
Each gene can now mutate in two ways:
1. **Value mutation**: Changes how much of the trait exists (e.g., more/less limbs)
2. **Variativeness mutation**: Changes how the trait is physically expressed (e.g., long thin limbs vs short stubby limbs)

### Phenotype Expression

#### Limbs
- **High variativeness**: Long, thin limbs
  - Better for running on land
  - Better for swimming (when adapted)
  - More drag in water if not adapted
- **Low variativeness**: Short, sturdy limbs
  - Better stability
  - Less drag in water
  - Less efficient for running

#### Body Shape
- **High maneuverability variativeness**: Streamlined body
  - Better for swimming
  - Higher top speed
  - Better turning
- **Low maneuverability variativeness**: Compact, round body
  - More stable
  - Better for bottom-dwelling

#### Fins
- **High maneuverability variativeness**: Large fins
  - Excellent swimming efficiency
  - High drag on land
  - Better turning in water
- **Low maneuverability variativeness**: Small or no fins
  - Less efficient swimming
  - Can move on land more easily

#### Jaws
- **High jaws variativeness**: Large, powerful jaws
  - Higher bite force
  - More teeth
  - Better for predation
- **Low jaws variativeness**: Smaller, more efficient jaws
  - Lower maintenance cost
  - Still functional for eating

#### Armor
- **High armor variativeness**: Thick, heavy armor
  - Better protection
  - Higher mass penalty
  - More spikes
- **Low armor variativeness**: Light, flexible armor
  - Less protection
  - Lower mass penalty
  - More mobility

## Evolutionary Implications

### Specialization
Creatures can now evolve specialized body forms:
- **Swimmers**: High maneuverability + high variativeness → streamlined body with large fins
- **Runners**: High limbs + high variativeness → long legs for fast land movement
- **Climbers**: High limbs + low variativeness → short, sturdy legs for stability
- **Predators**: High jaws + high variativeness → large jaws with many teeth
- **Tanks**: High armor + high variativeness → thick armor with many spikes

### Trade-offs
The system creates natural trade-offs:
- Long limbs are great on land but create drag in water
- Large fins are great in water but hinder land movement
- Thick armor provides protection but reduces speed
- Streamlined bodies are fast but may be fragile

## Implementation Details

### Constants
Phenotype weights are defined in `Constants.js` under `DEFAULT_GENE_WEIGHTS.phenotype`

### Calculation
Phenotypes are calculated in `Creature.calculatePhenotype()` based on:
- Gene values (how much of the trait)
- Gene variativeness (how it's expressed)
- Phenotype weight constants

### Visual Representation
- Limb count, length, and width vary based on genes
- Fin size and count vary based on maneuverability
- Jaw size and tooth count vary based on jaws gene
- Armor spike count and height vary based on armor gene

### Physics Impact
- Movement costs affected by limb/fin phenotypes
- Speed affected by body streamlining
- Turning affected by body flexibility
- Mass affected by armor thickness
