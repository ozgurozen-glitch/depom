// Araç kataloğu. stats: menüde gösterilen 0..1 değerler. tuning: Car'ın CAR_TUNING değerlerinin üzerine
// yazılan alanlar. model: src/car/model.js'teki model kimliği. color: varsayılan boya.
export const CARS = [
  {
    id: 'vortex',
    name: 'Vortex GT',
    class: 'Hiper',
    model: 'vortex',
    color: 0x1677ff,
    stats: { speed: 0.8, accel: 0.75, handling: 0.72, nitro: 0.7 },
    tuning: {},
  },
];

export const PAINT_COLORS = [0x1677ff, 0xe8101a, 0xffb000, 0xf5f5f5, 0x18c060, 0x8a2be2, 0x16181c, 0xff4fa0];

export function getCarDef(id) {
  return CARS.find((c) => c.id === id) || CARS[0];
}
