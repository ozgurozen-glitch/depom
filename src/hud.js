// YER TUTUCU: düz metin HUD. Gerçek arayüz bunun yerini alacak.
export class HUD {
  constructor(root) {
    this.root = root;
    this.info = document.createElement('div');
    this.info.style.cssText = 'position:absolute;top:10px;left:10px;font:16px monospace;white-space:pre';
    root.appendChild(this.info);
    this.center = document.createElement('div');
    this.center.style.cssText = 'position:absolute;top:40%;width:100%;text-align:center;font:bold 48px sans-serif';
    root.appendChild(this.center);
  }

  setTrack() {}

  showMenu({ trackName, carName, onStart }) {
    this.menu = document.createElement('button');
    this.menu.className = 'interactive';
    this.menu.textContent = `${trackName} / ${carName} — BAŞLA`;
    this.menu.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:24px;padding:16px';
    this.menu.onclick = onStart;
    this.root.appendChild(this.menu);
  }

  hideMenu() {
    if (this.menu) this.menu.remove();
  }

  showCountdown(text) {
    this.center.textContent = text || '';
  }

  update(s) {
    this.info.textContent = `${s.place}/${s.totalCars}  Tur ${s.lap}/${s.totalLaps}\n${Math.round(s.speedKmh)} km/h  nitro ${Math.round(s.nitro * 100)}%\n${s.raceTime.toFixed(1)} s`;
  }

  handleEvent() {}

  showPause() {}

  showResults(rows) {
    if (!rows) return;
    this.center.textContent = rows.map((r) => `${r.place}. ${r.name}`).join('  ');
  }
}
