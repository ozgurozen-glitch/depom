// Pist kataloğu. Her giriş sahneye kendi pistini ve mekânını kurar; Game pist değiştirirken bu çağrının
// sahneye eklediği her şeyi kaldırıp GPU kaynaklarını serbest bırakır (bkz. Game.loadTrack).
import { Track } from './track.js';
import { Environment } from './environment.js';
import { BangkokTrack } from './tracks/bangkok/track.js';
import { BangkokEnvironment } from './tracks/bangkok/environment.js';

export const TRACKS = [
  {
    id: 'riviera',
    name: 'Riviera Sunset',
    subtitle: 'Akdeniz kıyısı · gün batımı',
    laps: 2,
    create(scene, renderer) {
      const track = new Track(scene);
      const environment = new Environment(scene, renderer, track);
      return { track, environment };
    },
  },
  {
    id: 'bangkok',
    name: 'Bangkok Nights',
    subtitle: 'Gece · neon · ıslak asfalt',
    laps: 2,
    create(scene, renderer) {
      const track = new BangkokTrack(scene);
      const environment = new BangkokEnvironment(scene, renderer, track);
      return { track, environment };
    },
  },
];

export function getTrackDef(id) {
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}
