import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Game } from './game.js';

function showBootError(message) {
  const el = document.getElementById('boot-error');
  el.textContent = message;
  el.style.display = 'flex';
}

function boot() {
  const container = document.getElementById('game');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    showBootError('WebGL başlatılamadı. Tarayıcın WebGL desteklemiyor olabilir.');
    throw err;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.pixelRatioMax));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const params = new URLSearchParams(window.location.search);
  const game = new Game({
    renderer,
    hudRoot: document.getElementById('hud'),
    options: {
      autopilot: params.has('autopilot'),
      skipMenu: params.has('skipmenu'),
      speed: Math.max(1, Number(params.get('speed')) || 1),
      muted: params.has('mute'),
    },
  });
  window.__game = game;
  game.start();
}

window.addEventListener('error', (e) => {
  if (!window.__game) showBootError(`Oyun yüklenemedi: ${e.message}`);
});

boot();
