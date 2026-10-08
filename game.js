const WORLD_WIDTH = 3500;
const WORLD_HEIGHT = 2350;
const CELL_WIDTH = 100;

class Game {
  constructor() {
    
    this.app = null;
    this.mainContainer = null;
    this.grid = new Grid(WORLD_WIDTH, WORLD_HEIGHT, CELL_WIDTH, this);
    this.pixiStarted = false;

  }
  async init() {
    if (this.pixiStarted) {
      console.log("Can't start pixi app twice");
      return;
    }

    await this.startPixiApp();
    this.config = await GameConfig.load("config/gameDesign.json");
    
    this.pixiStarted = true;
  }

  async startPixiApp() {
    this.app = new PIXI.Application();
    await this.app.init(this.getPixiStartingConfig());
  }

  getPixiStartingConfig() {
    return {
      background: "#000000",
      width: window.innerWidth,
      height: window.innerHeight,
      pixelArt: true,
      resolution: 1,
      autoDensity: true,
      powerPreference: "high-performance",
      backgroundAlpha: 0,
      antialias: false,
      resizeTo: window,
      backgroundColor: 0x1099bb,
    };
  }

}