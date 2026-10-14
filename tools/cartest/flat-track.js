// Sonsuz düz pist (ivme/direksiyon/drift ölçümleri için). Başsız testlerde kullanılır.
import * as THREE from 'three';

export class FlatTrack {
  constructor(width = 200) {
    this.name = 'flat';
    this.width = width;
    this.length = 1e6;
    this.ramps = [];
    this.pickups = [];
  }
  sample(s) {
    return { pos: new THREE.Vector3(0, 0, s), tangent: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0), width: this.width };
  }
  project(pos) {
    return { s: pos.z, lateral: -pos.x, height: pos.y, onRoad: Math.abs(pos.x) < this.width / 2 };
  }
  heightAt() { return 0; }
  update() {}
}
