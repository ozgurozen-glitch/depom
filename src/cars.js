// Araç kataloğu. stats: menüde gösterilen 0..1 değerler — gerçek ayarlardan türetilir ve
// tools/cartest/physics.mjs tarafından doğrulanır (speed: azami hız, accel: 0-200 km/s süresi,
// handling: 150 km/s'de sabit viraj yarıçapı, nitro: itiş gücü ve drift ile dolum).
// tuning: Car'ın CAR_TUNING değerlerinin üzerine yazılan alanlar (nitro seviyeleri tek tek birleşir).
// model: src/car/model.js'teki model kimliği. color: varsayılan boya.
const KMH = 1 / 3.6;
const DEG = Math.PI / 180;

export const CARS = [
  {
    id: 'vortex',
    name: 'Vortex GT',
    class: 'Hiper',
    model: 'vortex',
    color: 0x1677ff,
    stats: { speed: 0.7, accel: 0.64, handling: 0.61, nitro: 0.61 },
    tuning: {},
  },
  {
    id: 'raijin',
    name: 'Raijin RS',
    class: 'Tuner',
    model: 'raijin',
    color: 0xff5a1f,
    stats: { speed: 0.5, accel: 0.89, handling: 0.85, nitro: 0.5 },
    // Hafif kupe: en iyi ivme ve tutuş, hızlı yön değiştirir; drift'e yatkın (geniş açı, kolay giriş, hızlı dolum).
    tuning: {
      maxSpeed: 270 * KMH,
      accel: 15.6,
      accelExponent: 3.2,
      brakeDecel: 28,
      minTurnRadius: 5.7,
      yawRateLow: 2.6,
      yawRateHigh: 1.4,
      yawRateNitro: 1.15,
      yawResponse: 15,
      gripLow: 17,
      gripHigh: 10.5,
      nitro: {
        normal: { speedMul: 1.16, thrust: 9.5 },
        perfect: { speedMul: 1.25, thrust: 12.5 },
        shockwave: { speedMul: 1.34, thrust: 15.5 },
      },
      driftSteerThreshold: 0.2,
      driftAngleMin: 26 * DEG,
      driftAngleMax: 44 * DEG,
      driftSlipOmega: 14.5,
      driftSlipOmegaFlip: 7.5,
      driftNitroRate: 0.16,
      gripRecoverTime: 0.5,
    },
  },
  {
    id: 'titan',
    name: 'Titan V8',
    class: 'Muscle GT',
    model: 'titan',
    color: 0xe8101a,
    stats: { speed: 0.85, accel: 0.29, handling: 0.28, nitro: 0.82 },
    // Ağır muscle GT: en yüksek azami hız ve en güçlü nitro; yavaş ivme, ağır direksiyon, geniş viraj.
    tuning: {
      maxSpeed: 305 * KMH,
      accel: 9.8,
      accelExponent: 3.0,
      brakeDecel: 24,
      minTurnRadius: 7.6,
      yawRateLow: 1.6,
      yawRateHigh: 0.9,
      yawRateNitro: 0.78,
      yawResponse: 9,
      gripLow: 13,
      gripHigh: 7.6,
      nitro: {
        normal: { speedMul: 1.25, thrust: 15 },
        perfect: { speedMul: 1.36, thrust: 19 },
        shockwave: { speedMul: 1.48, thrust: 23 },
      },
      driftAngleMin: 22 * DEG,
      driftAngleMax: 37 * DEG,
      driftSlipOmega: 12.8,
      driftSlipOmegaFlip: 5.5,
      driftPathResponse: 5.5,
      driftDecelAngle: 2.6,
      gripRecoverTime: 0.7,
    },
  },
];

export const PAINT_COLORS = [0x1677ff, 0xe8101a, 0xffb000, 0xf5f5f5, 0x18c060, 0x8a2be2, 0x16181c, 0xff4fa0];

export function getCarDef(id) {
  return CARS.find((c) => c.id === id) || CARS[0];
}
