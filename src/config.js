// Oyun genelindeki ayarlar. Modüller kendi iç ayarlarını kendi dosyalarında tutar;
// burada yalnızca birden çok modülün paylaştığı değerler bulunur.
export const CONFIG = {
  trackName: 'Riviera Sunset',
  carName: 'Vortex GT',
  laps: 2,
  botCount: 7,

  playerName: 'SEN',
  playerColor: 0x1677ff,
  botNames: ['Viper', 'Blaze', 'Kaito', 'Nova', 'Raven', 'Diesel', 'Luna'],
  botColors: [0xe8101a, 0xffb000, 0xf5f5f5, 0x18c060, 0x8a2be2, 0x222428, 0xff4fa0],

  // Fizik sabit adımı (saniye) ve kare başına en fazla adım sayısı.
  fixedDt: 1 / 60,
  maxStepsPerFrame: 5,

  pixelRatioMax: 1.5,

  // Nitro ödülleri (0..1 bar oranı).
  nitroReward: {
    takedown: 0.35,
    pickup: 0.25,
    nearMiss: 0.05,
    perfectStart: 0.15,
  },
};
