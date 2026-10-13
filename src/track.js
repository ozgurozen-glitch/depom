// YER TUTUCU: sözleşmeyi (docs/ARCHITECTURE.md) karşılayan en basit pist. Gerçek pist bunun yerini alacak.
import * as THREE from 'three';

export class Track {
  constructor(scene) {
    this.name = 'Riviera Sunset';
    this.width = 20;
    this.ramps = [];
    this.pickups = [];

    const ctrl = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctrl.push(new THREE.Vector3(Math.cos(a) * 450, 0, Math.sin(a) * 280));
    }
    const curve = new THREE.CatmullRomCurve3(ctrl, true);
    this.length = curve.getLength();
    this.N = 2000;
    this.points = curve.getSpacedPoints(this.N);
    this.tangents = this.points.map((_, i) => {
      const a = this.points[(i - 1 + this.N) % this.N];
      const b = this.points[(i + 1) % this.N];
      return b.clone().sub(a).normalize();
    });

    const positions = [];
    const indices = [];
    for (let i = 0; i <= this.N; i++) {
      const p = this.points[i % this.N];
      const r = new THREE.Vector3().crossVectors(this.tangents[i % this.N], UP).normalize();
      const l = p.clone().addScaledVector(r, -this.width / 2);
      const rr = p.clone().addScaledVector(r, this.width / 2);
      positions.push(l.x, l.y + 0.02, l.z, rr.x, rr.y + 0.02, rr.z);
      if (i < this.N) {
        const k = i * 2;
        indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x33363d, side: THREE.DoubleSide }));
    road.receiveShadow = true;
    scene.add(road);
  }

  wrap(s) {
    return ((s % this.length) + this.length) % this.length;
  }

  sample(s) {
    const u = (this.wrap(s) / this.length) * this.N;
    const i = Math.floor(u) % this.N;
    const f = u - Math.floor(u);
    const j = (i + 1) % this.N;
    const pos = this.points[i].clone().lerp(this.points[j], f);
    const tangent = this.tangents[i].clone().lerp(this.tangents[j], f).normalize();
    const right = new THREE.Vector3().crossVectors(tangent, UP).normalize();
    return { pos, tangent, right, up: UP.clone(), width: this.width };
  }

  project(pos, hintS) {
    const seg = this.length / this.N;
    let from = 0;
    let count = this.N;
    if (hintS !== undefined) {
      const w = Math.ceil(60 / seg);
      from = Math.floor(this.wrap(hintS) / seg) - w;
      count = w * 2;
    }
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < count; k++) {
      const i = (((from + k) % this.N) + this.N) % this.N;
      const p = this.points[i];
      const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    const p = this.points[best];
    const t = this.tangents[best];
    const dx = pos.x - p.x;
    const dz = pos.z - p.z;
    const along = dx * t.x + dz * t.z;
    const s = this.wrap(best * seg + along);
    const smp = this.sample(s);
    const lateral = (pos.x - smp.pos.x) * smp.right.x + (pos.z - smp.pos.z) * smp.right.z;
    return { s, lateral, height: pos.y - this.heightAt(s, lateral), onRoad: Math.abs(lateral) <= this.width / 2 };
  }

  heightAt(s) {
    return this.sample(s).pos.y;
  }

  getStartGrid(n) {
    const grid = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 2);
      const smp = this.sample(this.length - 10 - row * 9);
      const pos = smp.pos.clone().addScaledVector(smp.right, i % 2 === 0 ? -4 : 4);
      grid.push({ pos, yaw: Math.atan2(smp.tangent.x, smp.tangent.z) });
    }
    return grid;
  }

  update() {}
}

const UP = new THREE.Vector3(0, 1, 0);
