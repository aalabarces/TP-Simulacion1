class Input {
  constructor(game) {
    this.game = game;
    this.keys = {};
    this.pressedKeys = {};
    this.mouse = { x: 0, y: 0 };
    this.selectedObject = null;
    window.addEventListener("keydown", this.onKeyDown.bind(this));
    window.addEventListener("keyup", this.onKeyUp.bind(this));
    window.addEventListener("mousedown", this.onMouseDown.bind(this));
    window.addEventListener("mousemove", this.onMouseMove.bind(this));
    window.addEventListener("click", this.onClick.bind(this));
    window.addEventListener("wheel", this.onWheel.bind(this), {
      passive: false,
    });
    window.addEventListener("contextmenu", this.onRightClick.bind(this));

    this.isTouchActive = false;
    this.isTouchDevice = false;
    this.lastTouchPos = null;

    window.addEventListener("pointerdown", this.onPointerDown.bind(this));
    window.addEventListener("pointermove", this.onPointerMove.bind(this));
    window.addEventListener("pointerup", this.onPointerUp.bind(this));
    window.addEventListener("pointercancel", this.onPointerUp.bind(this));
  }

  onKeyDown(event) {
    const key = event.key.toLowerCase();

    if (!this.keys[key]) {
      this.pressedKeys[key] = true;
    }

    this.keys[key] = true;
  }

  onMouseDown(event) {
    // do stuff
  }

  onMouseMove(event) {
    if (!this.game.mainContainer) return;
    const zoom = this.game.mainContainer.scale.x;
    const worldX = (event.clientX - this.game.mainContainer.x) / zoom;
    const worldY = (event.clientY - this.game.mainContainer.y) / zoom;

    this.mouse = { x: worldX, y: worldY };

    if (this.game.paused) return;
    // do stuff
  }

  onKeyUp(event) {
    const key = event.key.toLowerCase();

    this.keys[key] = false;
  }

  update() {
    // pause/restart
    if (this.wasPressed("escape")) {
      if (this.game.paused) {
        console.log("restart game");
        this.game.restart();
      } else {
        console.log("pause game");
        this.game.pause();
      }
    }
    // debug
    if (this.isPressed("shift") && this.wasPressed("d")) {
      this.game.toggleDebug();
    }
    // limpiar al final del frame
    this.pressedKeys = {};
  }

  isPressed(key) {
    // this.keys[key] may be undefined, so we convert it to a boolean
    return !!this.keys[key];
  }

  wasPressed(key) {
    return !!this.pressedKeys[key];
  }

  onClick(event) {
    // do stuff
  }

  onWheel(event) {
    event.preventDefault();
    this.game.zoom(event.deltaY, event.clientX, event.clientY);
  }

  onRightClick(event) {
    event.preventDefault();
    // do stuff
  }

  updateMousePosition(clientX, clientY) {
    if (!this.game.mainContainer) return;
    const zoom = this.game.mainContainer.scale.x;
    const worldX = (clientX - this.game.mainContainer.x) / zoom;
    const worldY = (clientY - this.game.mainContainer.y) / zoom;
    this.mouse = { x: worldX, y: worldY };
  }

  onPointerDown(event) {
    if (event.pointerType === "touch") {
      this.isTouchDevice = true;
      this.isTouchActive = true;
      this.lastTouchPos = { x: event.clientX, y: event.clientY };
      
      this.updateMousePosition(event.clientX, event.clientY);
    }
  }

  onPointerMove(event) {
    if (event.pointerType === "touch" && this.isTouchActive) {
      // Move camera on touch drag
      const deltaX = event.clientX - this.lastTouchPos.x;
      const deltaY = event.clientY - this.lastTouchPos.y;
      if (this.game.mainContainer) {
        this.game.mainContainer.x += deltaX;
        this.game.mainContainer.y += deltaY;
        this.game.clampCamaraAlMundo();
      }
      this.lastTouchPos = { x: event.clientX, y: event.clientY };
    }
  }

  onPointerUp(event) {
    if (event.pointerType === "touch") {
      this.isTouchActive = false;
    }
    // do stuff?
  }
}
