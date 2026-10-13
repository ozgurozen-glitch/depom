// YER TUTUCU: merkez çizgisini takip eden basit bot. Gerçek yapay zekâ bunun yerini alacak.
export class BotDriver {
  constructor(car, track, { skill = 0.8, preferredLane = 0 } = {}) {
    this.car = car;
    this.track = track;
    this.skill = skill;
    this.lane = preferredLane;
  }

  getInput() {
    const car = this.car;
    const target = this.track.sample(car.trackS + 25);
    const p = target.pos.clone().addScaledVector(target.right, this.lane * 5);
    const dx = p.x - car.position.x;
    const dz = p.z - car.position.z;
    const want = Math.atan2(dx, dz);
    let diff = want - car.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return {
      throttle: 0.75 + this.skill * 0.25,
      brake: 0,
      steer: Math.max(-1, Math.min(1, -diff * 2.5)),
      nitro: false,
      drift: false,
    };
  }
}
