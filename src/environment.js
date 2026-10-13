// YER TUTUCU: ışık ve zemin. Gerçek mekân tasarımı bunun yerini alacak.
import * as THREE from 'three';

export class Environment {
  constructor(scene) {
    scene.background = new THREE.Color(0x87a8d8);
    scene.fog = new THREE.Fog(0x87a8d8, 200, 1500);
    scene.add(new THREE.HemisphereLight(0xdde8ff, 0x445533, 1.2));
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.position.set(200, 300, 100);
    scene.add(this.sun);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshStandardMaterial({ color: 0x4a7a3a }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    scene.add(ground);
  }

  update() {}
}
