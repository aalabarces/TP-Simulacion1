class GameConfig {
  constructor(data) {
    this.data = data;
  }

  static async load(url = "config/gameDesign.json") {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `[GameConfig] Failed to load ${url}: HTTP ${response.status}`,
      );
    }
    const data = await response.json();
    GameConfig._validate(data);
    console.log("[GameConfig] Config loaded from ", url);
    return new GameConfig(data);
  }

  static _validate(data) {
    const missing = [];

    const requerir = (path, value) => {
      if (value === undefined || value === null) {
        missing.push(path);
      }
    };

    if (missing.length > 0) {
      throw new Error(
        `[GameConfig] gameDesign.json incomplete. Missing: ${missing.join(", ")}`,
      );
    }
  }

}

window.GameConfig = GameConfig;
