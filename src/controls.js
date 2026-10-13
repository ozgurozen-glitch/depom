// YER TUTUCU: yalnızca klavye. Gerçek kontroller (dokunmatik dahil) bunun yerini alacak.
export class Controls {
  constructor() {
    this.keys = new Set();
    this.pauseQueued = false;
    this.restartQueued = false;
    this.isTouch = false;
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Escape' || e.code === 'KeyP') this.pauseQueued = true;
      if (e.code === 'KeyR') this.restartQueued = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  getInput() {
    const k = this.keys;
    const brake = k.has('ArrowDown') || k.has('KeyS') || k.has('Space') ? 1 : 0;
    const left = k.has('ArrowLeft') || k.has('KeyA');
    const right = k.has('ArrowRight') || k.has('KeyD');
    return {
      throttle: brake ? 0 : 1,
      brake,
      steer: (right ? 1 : 0) - (left ? 1 : 0),
      nitro: k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyN') || k.has('ArrowUp') || k.has('KeyW'),
      drift: Boolean(brake),
    };
  }

  consumePause() {
    const v = this.pauseQueued;
    this.pauseQueued = false;
    return v;
  }

  consumeRestart() {
    const v = this.restartQueued;
    this.restartQueued = false;
    return v;
  }

  setTouchVisible() {}
}
