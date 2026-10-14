// BangkokTrack: Track'in "Bangkok Nights" yerleşimiyle kurulmuş hâli. Yol ıslak asfalt (düşük pürüzlülük +
// ortam haritası yansıması, su birikintileri), bariyerler bölüme göre boyalı ve gece ışık yansıtıcılı.
import * as THREE from 'three';
import { Track } from '../../track.js';
import { BANGKOK_LAYOUT } from './layout.js';
import { wetAsphaltTextures, barrierTextures } from './textures.js';

export class BangkokTrack extends Track {
  constructor(scene) {
    super(scene, BANGKOK_LAYOUT);
  }

  createRoadMaterial() {
    const { map, roughnessMap } = wetAsphaltTextures({ widthM: this.width, lengthM: 24 });
    // Pürüzlülük dokusu 48 m'de bir tekrarlar (yol dokusunun iki katı); pist uzunluğu ikisini de tam böler.
    const tiles = Math.round(this.length / this.roadTile);
    roughnessMap.repeat.set(1, tiles % 2 === 0 ? 0.5 : 1);
    return new THREE.MeshStandardMaterial({
      map, roughnessMap, roughness: 1, metalness: 0.0, vertexColors: true, envMapIntensity: 1.25,
    });
  }

  createBarrierMaterial() {
    const { map, emissiveMap } = barrierTextures();
    return new THREE.MeshLambertMaterial({
      map, vertexColors: true, emissive: 0xffffff, emissiveMap, emissiveIntensity: 2.2,
    });
  }

  /** Bariyer atlas satırı: 0 şehir, 1 otoyol, 2 nehir, 3 Chinatown. */
  barrierRow(s) {
    const id = this.sectionAt(s);
    if (id === 'expressway' || id === 'bridge') return 1;
    if (id === 'river' || id === 'lumpini') return 2;
    if (id === 'chinatown') return 3;
    return 0;
  }
}
