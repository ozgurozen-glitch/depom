// YER TUTUCU: kutu araba + basit kinematik. Gerçek fizik ve model bunun yerini alacak.
import * as THREE from 'three';

export class Car {
  constructor({ scene, color, name, isPlayer }) {
    this.name = name;
    this.color = color;
    this.isPlayer = isPlayer;
    this.radius = 2.2;
    this.halfLength = 2.3;
    this.halfWidth = 1.0;

    this.mesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2, 1, 4.6),
      new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.3 }),
    );
    body.position.y = 0.6;
    body.castShadow = true;
    this.mesh.add(body);
    scene.add(this.mesh);

    this.position = this.mesh.position;
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.nitro = 0;
    this.nitroActive = false;
    this.nitroLevel = null;
    this.drifting = false;
    this.airborne = false;
    this.wrecked = false;
    this.trackS = 0;
    this.lateral = 0;
    this.raceDistance = 0;
    this.lap = 0;
    this.place = 1;
    this.finished = false;
    this.finishTime = null;
    this.events = [];
    this.prevNitroInput = false;
  }

  get speedKmh() {
    return Math.abs(this.speed) * 3.6;
  }

  placeAt(pos, yaw) {
    this.position.copy(pos);
    this.yaw = yaw;
    this.speed = 0;
    this.velocity.set(0, 0, 0);
    this.nitroActive = false;
    this.nitroLevel = null;
    this.wrecked = false;
    this.mesh.rotation.set(0, yaw, 0);
  }

  update(dt, input, track) {
    if (input.nitro && !this.prevNitroInput && !this.nitroActive && this.nitro > 0.1) {
      this.nitroActive = true;
      this.nitroLevel = 'normal';
      this.events.push({ type: 'nitro_start', car: this, level: 'normal' });
    }
    this.prevNitroInput = input.nitro;
    if (this.nitroActive) {
      this.nitro -= dt * 0.25;
      if (this.nitro <= 0) {
        this.nitro = 0;
        this.nitroActive = false;
        this.nitroLevel = null;
        this.events.push({ type: 'nitro_end', car: this });
      }
    }

    const max = this.nitroActive ? 95 : 75;
    this.speed += (input.throttle * 22 - input.brake * 40) * dt;
    this.speed = THREE.MathUtils.clamp(this.speed - this.speed * 0.05 * dt, -15, max);
    this.yaw -= input.steer * 1.4 * dt * Math.min(1, Math.abs(this.speed) / 15);

    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.velocity.copy(fwd).multiplyScalar(this.speed);
    this.position.addScaledVector(this.velocity, dt);

    const pr = track.project(this.position, this.trackS);
    this.trackS = pr.s;
    this.lateral = pr.lateral;
    const limit = track.width / 2 - this.halfWidth;
    if (Math.abs(pr.lateral) > limit) {
      const smp = track.sample(pr.s);
      const side = Math.sign(pr.lateral);
      this.position.addScaledVector(smp.right, (limit - Math.abs(pr.lateral)) * side);
      this.speed *= 0.97;
      this.events.push({ type: 'wall_hit', car: this, strength: 0.2, point: this.position.clone(), side });
    }
    this.position.y = track.heightAt(pr.s, pr.lateral);
    this.mesh.rotation.set(0, this.yaw, 0);
  }

  addNitro(amount) {
    this.nitro = Math.min(1, this.nitro + amount);
  }

  wreck(cause) {
    this.events.push({ type: 'wreck', car: this, cause });
  }

  applyImpulse(vec) {
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.speed += vec.dot(fwd);
  }

  getRearWheelPositions() {
    return [this.position.clone(), this.position.clone()];
  }

  getExhaustPositions() {
    return [this.position.clone(), this.position.clone()];
  }
}
