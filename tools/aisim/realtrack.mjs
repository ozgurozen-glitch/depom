// Gerçek oyun pistini (src/track.js) Node'da yükler: canvas dokuları için en küçük bir document/ctx taklidi kullanılır.
// Yalnızca test aracı; sim.mjs `--track riviera` ile bunu çağırır.
import * as THREE from 'three';

function fakeCtx() {
  const noop = () => {};
  const grad = { addColorStop: noop };
  return new Proxy({}, {
    get(_t, prop) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => grad;
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) });
      if (prop === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) });
      return noop;
    },
    set() { return true; },
  });
}

export function installFakeDom() {
  if (globalThis.document) return;
  globalThis.document = {
    createElement(tag) {
      if (tag === 'canvas') return { width: 2, height: 2, getContext: () => fakeCtx(), style: {} };
      return { style: {}, appendChild() {}, setAttribute() {} };
    },
    createElementNS() { return { style: {} }; },
  };
  globalThis.window = globalThis.window || { devicePixelRatio: 1, addEventListener() {} };
}

export async function makeRealTrack(id = 'riviera') {
  installFakeDom();
  // Environment (sky bake) renderer gerektirir; yalnızca pist yeterli. Pist modülü `Track` sınıfını dışa aktarır.
  const { Track } = await import('../../src/track.js');
  void id;
  return new Track(new THREE.Scene());
}
