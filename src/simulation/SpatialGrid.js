export class SpatialGrid {
  constructor(worldWidth, worldDepth, cellSize = 50) {
    this.worldWidth = worldWidth;
    this.worldDepth = worldDepth;
    this.cellSize = cellSize;
    
    // Calculate grid dimensions
    this.cols = Math.ceil(worldWidth / cellSize);
    this.rows = Math.ceil(worldDepth / cellSize);
    
    // Offset for negative coordinates (world centered at 0,0)
    this.offsetX = worldWidth / 2;
    this.offsetZ = worldDepth / 2;
    
    this.clear();
  }

  clear() {
    // Create 2D grid of empty arrays
    this.grid = Array(this.rows).fill(null).map(() => 
      Array(this.cols).fill(null).map(() => [])
    );
  }

  // Convert world coordinates to grid cell indices
  getCellIndices(x, z) {
    const col = Math.floor((x + this.offsetX) / this.cellSize);
    const row = Math.floor((z + this.offsetZ) / this.cellSize);
    
    // Clamp to grid bounds
    const clampedCol = Math.max(0, Math.min(this.cols - 1, col));
    const clampedRow = Math.max(0, Math.min(this.rows - 1, row));
    
    return { row: clampedRow, col: clampedCol };
  }

  // Add entity to grid
  insert(entity) {
    const { row, col } = this.getCellIndices(entity.position.x, entity.position.z);
    this.grid[row][col].push(entity);
  }

  // Get all entities in the same cell and neighboring cells
  getNearby(x, z, range = 1) {
    const { row, col } = this.getCellIndices(x, z);
    const nearby = [];
    
    // Check neighboring cells within range
    for (let r = Math.max(0, row - range); r <= Math.min(this.rows - 1, row + range); r++) {
      for (let c = Math.max(0, col - range); c <= Math.min(this.cols - 1, col + range); c++) {
        nearby.push(...this.grid[r][c]);
      }
    }
    
    return nearby;
  }

  // Get entities in a specific cell
  getCell(x, z) {
    const { row, col } = this.getCellIndices(x, z);
    return this.grid[row][col];
  }

  // Debug: Get grid statistics
  getStats() {
    let totalEntities = 0;
    let maxInCell = 0;
    let nonEmptyCells = 0;
    
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const count = this.grid[r][c].length;
        if (count > 0) {
          nonEmptyCells++;
          totalEntities += count;
          if (count > maxInCell) maxInCell = count;
        }
      }
    }
    
    return {
      totalEntities,
      maxInCell,
      nonEmptyCells,
      totalCells: this.rows * this.cols,
      avgPerCell: totalEntities / Math.max(1, nonEmptyCells)
    };
  }
}
