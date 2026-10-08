class Cell {
  constructor(x, y, grid) {
    this.x = x;
    this.y = y;
    this.grid = grid;
    this.entitiesHere = [];
  }

  insert(entity) {
    this.entitiesHere.push(entity);
  }

  remove(entity) {
    this.entitiesHere = this.entitiesHere.filter((e) => e !== entity);
  }

  empty() {
    this.entitiesHere = [];
  }

  getNeighbors(cellCount = 1) {
    let cells = [];

    for (let i = -cellCount; i <= cellCount; i++) {
      for (let j = -cellCount; j <= cellCount; j++) {
        if (i == 0 && j == 0) continue;
        let cell = this.grid.getCellAtGrid(this.x + i, this.y + j);
        if (cell) cells.push(cell);
      }
    }

    return cells;
  }

  getEntitiesHereAndInNeighbors(cellRadius = 1) {
    let entities = [];
    let neighbors = this.getNeighbors(cellRadius);
    for (let i = 0; i < neighbors.length; i++) {
      let cell = neighbors[i];
      entities.push(...cell.entitiesHere);
    }

    entities.push(...this.entitiesHere);
    return entities;
  }

  getObjectAt(x, y) {
    // Query this cell and its neighbors (up to 2 cells away) to find any overlapping sprites
    const entities = this.getEntitiesHereAndInNeighbors(2);

    for (let i = 0; i < entities.length; i++) {
      let entity = entities[i];
      if (entity.sprite) {
        const sprite = entity.sprite;
        const width = sprite.texture.width * sprite.scale.x;
        const height = sprite.texture.height * sprite.scale.y;
        const anchorX = sprite.anchor ? sprite.anchor.x : 0;
        const anchorY = sprite.anchor ? sprite.anchor.y : 0;

        const left = entity.position.x - anchorX * width;
        const right = entity.position.x + (1 - anchorX) * width;
        const top = entity.position.y - anchorY * height;
        const bottom = entity.position.y + (1 - anchorY) * height;

        if (x >= left && x <= right && y >= top && y <= bottom) {
          return entity;
        }
      }
    }
    return null;
  }
}
