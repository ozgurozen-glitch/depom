// Zorluk profilleri: BotDriver'ın zorluk (`difficulty`) seçeneğine göre davranış katsayıları.
//
// `skill` (0..1) Game tarafından sıraya ve zorluğa göre zaten kaydırılarak verilir; profil bunun üstüne
// davranış biçimini (hata, fren payı, nitro verimi, saldırganlık, savunma, rubber band) belirler.
// Her alan sayısal olduğundan sürücü başına bir kez türetilir; sıcak yolda yalnızca okunur.

export const PROFILES = {
  easy: {
    // hız ve viraj
    skillPull: 0, // etkin yetenek = lerp(skill, 1, skillPull)
    speedRatio: [0.8, 0.9], // yetenek 0/1'de azami hızın oranı
    latAccelMul: 0.85, // sabit yanal ivme tabanı çarpanı
    capacityUse: [0.62, 0.7], // öğrenilen dönüş kapasitesinin kullanılan oranı (yetenek 0/1)
    brakeMargin: 0.52, // fren yavaşlamasının planlamada kullanılan oranı (düşük = erken fren)
    brakeReaction: 0.32, // s, fren tepki gecikmesi eklentisi
    lineFollow: [0.45, 0.75], // yarış çizgisini izleme oranı (düşük = daha az kesme)
    wanderMul: 1.9,
    steerNoiseMul: 1.9,
    // hatalar
    lapseRate: 1 / 14, // 1/s
    lapseDur: [0.7, 1.5],
    // takedown / savunma / sollama
    attackMul: 0.25,
    attackNeedsPin: false,
    defend: 0,
    slip: 0.25, // slipstream için bilinçli arkaya girme olasılığı
    swingSpeed: 0.8,
    // nitro
    nitroThreshold: 0.55, // bar bunun üstündeyse kullan
    nitroNeed: [1.0, 40], // en az (a·v + b) m serbest mesafe (yalnızca zeki mod)
    nitroSmart: false,
    nitroChain: 0.25, // perfect zincirini deneme olasılığı
    nitroChainAim: [0.55, 1.05], // basış zamanı aralığı (ilerleme)
    shock: 0,
    pickup: 0.15, // nitro pickup'ına yönelme olasılığı
    // lastik bant
    rubberBehind: [120, 150],
    rubberAhead: [180, 200],
    rubberBoostMul: 0.6,
    rubberSlowMul: 1.4,
    // drift
    avoidMargin: 1.4,
  },
  normal: {
    skillPull: 0,
    speedRatio: [0.88, 1.0],
    latAccelMul: 1.0,
    capacityUse: [0.78, 0.92],
    brakeMargin: 0.75,
    brakeReaction: 0,
    lineFollow: [0.55, 1.0],
    wanderMul: 1.0,
    steerNoiseMul: 1.0,
    lapseRate: 0,
    lapseDur: [0.6, 1.0],
    attackMul: 1.0,
    attackNeedsPin: false,
    defend: 0.45,
    slip: 0.6,
    swingSpeed: 1.0,
    nitroThreshold: 0.3,
    nitroNeed: [1.0, 60],
    nitroSmart: false,
    nitroChain: 1,
    nitroChainAim: [0.77, 0.86],
    shock: 0,
    pickup: 0.6,
    rubberBehind: [150, 150],
    rubberAhead: [250, 200],
    rubberBoostMul: 1.0,
    rubberSlowMul: 1.0,
    avoidMargin: 0.9,
  },
  hard: {
    skillPull: 0.6,
    speedRatio: [0.97, 1.0],
    latAccelMul: 1.6,
    capacityUse: [0.92, 0.98],
    brakeMargin: 0.95,
    brakeReaction: -0.1,
    lineFollow: [0.9, 1.0],
    wanderMul: 0.35,
    steerNoiseMul: 0.4,
    lapseRate: 0,
    lapseDur: [0.6, 1.0],
    attackMul: 1.8,
    attackNeedsPin: true,
    defend: 1,
    slip: 1,
    swingSpeed: 1.15,
    nitroThreshold: 0.12,
    nitroNeed: [0.55, 15],
    nitroSmart: true,
    nitroChain: 1,
    nitroChainAim: [0.775, 0.83],
    shock: 1,
    pickup: 1,
    rubberBehind: [150, 150],
    rubberAhead: [380, 250],
    rubberBoostMul: 1.0,
    rubberSlowMul: 0.3,
    avoidMargin: 0.8,
  },
};

export function getProfile(difficulty) {
  return PROFILES[difficulty] || PROFILES.normal;
}
