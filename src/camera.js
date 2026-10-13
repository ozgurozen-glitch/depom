// YER TUTUCU: sabit ofsetli takip kamerası. Gerçek kamera bunun yerini alacak.
import * as THREE from 'three';

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'race';
  }

  setMode(mode) {
    this.mode = mode;
  }

  update(dt, car) {
    const back = new THREE.Vector3(-Math.sin(car.yaw), 0, -Math.cos(car.yaw));
    this.camera.position.copy(car.position).addScaledVector(back, 9).add(new THREE.Vector3(0, 3.5, 0));
    this.camera.lookAt(car.position.x, car.position.y + 1.2, car.position.z);
  }

  shake() {}
}
