class Grid {
  constructor(width, height, cellWidth, game) {
    this.width = width;
    this.height = height;
    this.cellWidth = cellWidth;
    this.game = game;

    this.createCells();
  }

  createCells() {
    this.cells = [];
    for (let i = 0; i < Math.floor(this.width / this.cellWidth); i++) {
      this.cells[i] = [];
      for (let j = 0; j < Math.floor(this.height / this.cellWidth); j++) {
        this.cells[i][j] = new Cell(i, j, this);
      }
    }
  }

  getCellAt(x, y) {
    let col = this.cells[Math.floor(x / this.cellWidth)];
    if (!col) return null;
    return col[Math.floor(y / this.cellWidth)];
  }

  reset() {
    for (let i = 0; i < Math.floor(this.width / this.cellWidth); i++) {
      for (let j = 0; j < Math.floor(this.height / this.cellWidth); j++) {
        let cell = this.getCellAtGrid(i, j);
        if (cell) cell.vaciar();
      }
    }

    for (let gameObject of this.game.gameObjects) {
      if (gameObject.isPreview) continue;
      gameObject.putMeInGrid();
    }
  }

  getCellAtGrid(x, y) {
    let col = this.cells[x];
    if (!col) return null;

    return col[y];
  }

  insert(entity) {
    let cell = this.getCellInPosition(entity.position.x, entity.position.y);
    if (!cell) return;
    cell.insert(entity);
  }

  remove(entity) {
    let cell = this.getCellInPosition(entity.position.x, entity.position.y);
    if (!cell) return;
    cell.remove(entity);
  }

  query(x, y, radioPx = CELL_WIDTH) {
    let cell = this.getcellInPosition(x, y);
    if (!cell) return [];
    return cell.getEntitiesHereAndInNeighbors(
      Math.ceil(radioPx / CELL_WIDTH),
    );
  }
}
