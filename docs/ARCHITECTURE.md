# Mimari ve modül sözleşmesi

Tarayıcıda çalışan, Asphalt 8'den esinlenen bir arcade yarış oyunu. Derleme adımı yok: düz ES modülleri,
`vendor/three/` altında yerel Three.js r160 (CDN yok, oyun çevrimdışı çalışır).

```
index.html            importmap ('three' → vendor/three/three.module.js, 'three/addons/' → vendor/three/addons/)
src/main.js           önyükleme: renderer + Game
src/config.js         paylaşılan ayarlar (tur sayısı, bot isimleri/renkleri, ödüller)
src/game.js           yarış durum makinesi, modüllerin birbirine bağlanması, tur/sıra, nitro pickup'ları
src/track.js          Track: pist merkez çizgisi, yol/bariyer/rampa mesh'leri, sorgular
src/environment.js    Environment: gökyüzü, ışıklar, sis, mekân (binalar, palmiyeler, deniz, tünel, tribünler)
src/car.js            Car: araba fiziği + prosedürel araba modeli
src/controls.js       Controls: klavye + dokunmatik giriş
src/camera.js         ChaseCamera: takip kamerası ve modları
src/ai.js             BotDriver: bot sürücü (Car'a input üretir)
src/collisions.js     CollisionSystem: araba-araba çarpışması, takedown
src/effects.js        Effects: post-processing (bloom vb.), parçacıklar, iz, hız çizgileri
src/hud.js            HUD: DOM arayüzü (hız, nitro, sıra, tur, minimap, menü, sonuçlar)
src/audio.js          AudioSystem: WebAudio ile sentezlenen sesler
tools/shot.mjs        Playwright ile ekran görüntüsü + durum çıktısı (test aracı)
```

## Ortak kurallar

- Birim: metre, saniye, radyan. Y yukarı.
- **Araba yönü:** `yaw` açısında ileri vektör `forward = (sin(yaw), 0, cos(yaw))`, sağ vektör
  `right = (-cos(yaw), 0, sin(yaw))` (yani `forward × up`). Araba modeli yerel **+Z**'ye bakar
  (`mesh.rotation.y = yaw`).
- **Direksiyon:** `steer > 0` sağa döner (yaw azalır), `steer < 0` sola.
- **Pist yanal konumu:** `lateral > 0` merkez çizgisinin sağı; pistin `right` vektörü `tangent × up`.
- Her modül kendi mesh'lerini `scene`'e kendisi ekler. Geometri ve materyalleri mümkün olduğunca paylaş
  (8 araba, yüzlerce bina). Gölge yalnızca gerekli nesnelerde açık olsun.
- Modüller birbirinin dosyasını düzenlemez; sözleşmede eksik gördüğünü raporda belirt.
- Harici ağ yok: CDN, Google Fonts, uzak doku yok. Dokular gerekiyorsa `CanvasTexture` ile üret.
- `window.__game` test için açıktır; `?autopilot=1` oyuncu arabasını bot sürer, `?skipmenu=1` menüyü atlar,
  `?speed=N` simülasyonu N kat hızlandırır (yalnızca test).

## Olay (event) sistemi

Araba ve çarpışma sistemi olayları `{ type, ...alanlar }` nesneleri olarak üretir. `Game` her karede
tüm olayları toplar ve `effects.update`, `hud.handleEvent`, `audio.handleEvent`'e iletir.
Her olayda `car` alanı (olayın sahibi Car) bulunur.

| type | alanlar | üreten |
|---|---|---|
| `drift_start` | car | Car |
| `drift_end` | car, duration (s) | Car |
| `jump` | car | Car (yerden kesilince) |
| `land` | car, airTime (s), hard (bool) | Car |
| `barrel_roll` | car | Car (rampadan dönüşle fırlayınca) |
| `flat_spin` | car | Car (drift halinde rampadan fırlayınca) |
| `wall_hit` | car, strength (0..1), point (Vector3), side (-1 sol / 1 sağ) | Car |
| `nitro_start` | car, level (`'normal'`/`'perfect'`/`'shockwave'`) | Car |
| `nitro_end` | car | Car |
| `wreck` | car, cause (`'wall'`/`'takedown'`) | Car (`wreck()` içinde) |
| `respawn` | car | Car |
| `bump` | car, other, strength (0..1), point | CollisionSystem |
| `takedown` | car (saldıran), victim | CollisionSystem |
| `near_miss` | car, other | CollisionSystem |
| `pickup` | car, kind (`'nitro'`) | Game |
| `lap` | car, lap (tamamlanan tur no) | Game |
| `final_lap` | car | Game |
| `finish` | car, place | Game |
| `countdown` | car (oyuncu), value (3/2/1) | Game |
| `go` | car (oyuncu) | Game |
| `perfect_start` | car (oyuncu) | Game |

## Input nesnesi

```js
{ throttle: 0..1, brake: 0..1, steer: -1..1, nitro: bool /* basılı tutuluyor */, drift: bool }
```
Asphalt 8 gibi gaz **otomatiktir**: Controls, fren basılı değilken `throttle = 1` döndürür.
Nitro basma kenarlarını (rising edge) Car kendisi algılar.

## Track (`src/track.js`)

```js
export class Track {
  constructor(scene)
  name: string
  length: number            // merkez çizgisi uzunluğu (m), 3-4 km civarı
  width: number             // yol genişliği (m), ~18-22
  ramps: Array<{ s0, s1, height, latMin, latMax, type: 'jump' | 'roll' }>
  pickups: Array<{ s, lateral, kind: 'nitro', mesh: Object3D, active: bool, respawnAt: number }>
  sample(s) → { pos: Vector3, tangent: Vector3, right: Vector3, up: Vector3, width: number }
                             // s metre; length'e göre sarar (wrap). pos yol yüzeyindeki merkez noktası.
  project(pos, hintS?) → { s, lateral, height, onRoad }
                             // hintS verilirse ±60 m'de arar (hızlı). height = pos.y - yol yüzeyi.
  heightAt(s, lateral) → number   // rampalar dahil yol yüzeyi Y'si
  getStartGrid(n) → Array<{ pos: Vector3, yaw: number }>   // [0] en önde (pole). Başlangıç çizgisi s=0.
  update(dt, time)           // pickup animasyonu vb.
}
```
Pist kapalı devredir, kenarlarda bariyer vardır (araba dışarı çıkamaz). Başlangıç/bitiş çizgisi `s = 0`.

## Environment (`src/environment.js`)

```js
export class Environment {
  constructor(scene, renderer, track)   // ışıklar, gökyüzü, sis, scene.background/environment, mekân
  update(dt, focusPos: Vector3)          // gölge kamerasını oyuncuya göre kaydırır, animasyonlar
}
```

## Car (`src/car.js`)

```js
export class Car {
  constructor({ scene, color, name, isPlayer })
  mesh: THREE.Group
  name, color, isPlayer
  position: Vector3, velocity: Vector3, yaw: number
  speed: number              // ileri yöndeki hız (m/s, işaretli)
  get speedKmh()
  nitro: number              // 0..1 bar
  nitroActive: bool, nitroLevel: 'normal'|'perfect'|'shockwave'|null
  nitroBurstProgress: number|null  // aktif nitro patlamasının ilerlemesi 0..1 (perfect nitro penceresi için)
  drifting: bool, airborne: bool, wrecked: bool
  ghost: bool                // respawn sonrası kısa dokunulmazlık; çarpışma sistemi yok sayar
  trackS: number, lateral: number   // update içinde track.project ile güncel tutulur
  // Game'in yönettiği alanlar (Car bunlara dokunmaz):
  raceDistance: number, lap: number, place: number, finished: boolean, finishTime: number|null
  events: Array               // Game her karede boşaltır

  placeAt(pos, yaw)          // ızgaraya yerleştir, hızı sıfırla
  update(dt, input, track)   // fizik adımı; bariyer çarpışması, rampalar, hava, drift, nitro, wreck/respawn
  addNitro(amount)
  wreck(cause)               // takla animasyonu, ~2.5 s sonra kendini piste geri koyar (respawn olayı)
  applyImpulse(vec3)         // çarpışma sisteminin kullandığı itme
  getRearWheelPositions() → [Vector3, Vector3]   // dünya koordinatı, yol temas noktaları
  getExhaustPositions() → [Vector3, Vector3]
  radius: number             // çarpışma yarıçapı (~2.2), halfLength, halfWidth
}
```

## Controls (`src/controls.js`)

```js
export class Controls {
  constructor(domElement)
  getInput() → Input
  consumePause() → bool      // Esc / P
  consumeRestart() → bool    // R
  isTouch: bool
  setTouchVisible(bool)      // dokunmatik düğmeler yarışta görünür
}
```
Dokunmatik düğmeler ekranın **alt-sol** (direksiyon) ve **alt-sağ** (nitro, fren/drift) köşelerini, duraklat
düğmesi **üst-sağ köşeyi** (48 px) kullanır. Duraklat düğmesine dokunmak `consumePause()`'u true yapar.

## ChaseCamera (`src/camera.js`)

```js
export class ChaseCamera {
  constructor(camera)
  setMode(mode)              // 'menu' (yavaş yörünge) | 'countdown' | 'race' | 'finish'
  update(dt, car, track)
  shake(intensity 0..1)
}
```

## BotDriver (`src/ai.js`)

```js
export class BotDriver {
  constructor(car, track, { skill: 0..1, aggression: 0..1, preferredLane: -1..1 })
  getInput(dt, ctx) → Input  // ctx = { cars: Car[], player: Car, raceStarted: bool }
}
```

## CollisionSystem (`src/collisions.js`)

```js
export class CollisionSystem {
  constructor()
  update(dt, cars, track) → events[]   // araba-araba çözümü, bump/takedown/near_miss
}
```

## Effects (`src/effects.js`)

```js
export class Effects {
  constructor(renderer, scene, camera)
  update(dt, cars, player, events)
  render()                   // composer ile çizer
  resize(w, h)
}
```

## HUD (`src/hud.js`)

```js
export class HUD {
  constructor(rootEl)
  setTrack(track)            // minimap'i hazırlar
  showMenu({ trackName, carName, onStart })
  hideMenu()
  showCountdown(text)        // '3','2','1','GO!'; null gizler
  update(state)              // aşağıya bak
  handleEvent(evt)           // TAKEDOWN!, DRIFT, AIR TIME, BARREL ROLL, PERFECT NITRO, WRECKED, SON TUR...
  showPause(visible, { onResume, onRestart })
  showResults(rows, onRestart)   // rows: [{ place, name, time|null, bestLap|null, isPlayer }]
}
// state = { state ('menu'|'countdown'|'racing'|'finished'), paused, speedKmh, nitro, nitroActive, nitroLevel,
//           nitroBurstProgress, place, totalCars, lap, totalLaps, raceTime, lapTime, bestLap, wrecked,
//           cars: [{ x, z, color, isPlayer }] }
```
Yerleşim: üst-sol sıra + tur, üst-orta süre, üst-sağ minimap (üstten 64 px boşluk bırakır; köşede
dokunmatik duraklat düğmesi var), alt-orta hız + nitro barı, ekran ortası bildirimler.
Alt köşeler dokunmatik düğmelere ayrılmıştır.

## AudioSystem (`src/audio.js`)

```js
export class AudioSystem {
  constructor()
  resume()                   // kullanıcı etkileşimiyle çağrılır
  update(dt, player, state)  // motor sesi (vites hissi), rüzgâr, nitro
  handleEvent(evt)
  setMuted(bool)
}
```
