// Prosedürel araç modelleri: createCarModel(modelId, color) → parça sözlüğü.
//
// Modeller: 'vortex' (Vortex GT), 'raijin' (Raijin RS), 'titan' (Titan V8). Hepsi aynı yerel eksenleri kullanır:
// +Z ileri, +Y yukarı, +X arabanın SOLU (sözleşmedeki right = -X). Zemin y = 0; merkez (0, 0) yol temas noktası.
//
// Geometriler model başına bir kez üretilir ve tüm örnekler arasında paylaşılır; materyaller (cam, aksam,
// farlar, lastik, jant) tüm modeller arasında paylaşılır. Araba başına yalnızca boya materyali klonlanır.
// Araba başına çizim çağrısı ~13 (boya x2, cam, aksam x2, far, stop, 3 tekerlek x2 materyal).
import * as THREE from 'three';
import { getMaterials, shadowGeometry } from './geo.js';
import { DIMS as VORTEX_DIMS, ANCHORS as VORTEX_ANCHORS, buildVortex } from './vortex.js';
import { DIMS as RAIJIN_DIMS, ANCHORS as RAIJIN_ANCHORS, buildRaijin } from './raijin.js';
import { DIMS as TITAN_DIMS, ANCHORS as TITAN_ANCHORS, buildTitan } from './titan.js';

// Vortex GT boyutları (geriye uyumluluk: eski kod bu sabiti içe aktarır).
export const CAR_DIMENSIONS = Object.freeze({ ...VORTEX_DIMS, shadow: [3.0, 6.0] });

export const MODELS = {
  vortex: { dims: CAR_DIMENSIONS, anchors: VORTEX_ANCHORS, build: buildVortex },
  raijin: { dims: RAIJIN_DIMS, anchors: RAIJIN_ANCHORS, build: buildRaijin },
  titan: { dims: TITAN_DIMS, anchors: TITAN_ANCHORS, build: buildTitan },
};

const cache = new Map();

function getShared(id) {
  let sh = cache.get(id);
  if (!sh) {
    const def = MODELS[id];
    sh = { geo: def.build(), shadow: shadowGeometry(def.dims.shadow[0], def.dims.shadow[1]) };
    cache.set(id, sh);
  }
  return sh;
}

// Model için boyutlar (fizik / çarpışma / efektler).
export function getModelDimensions(modelId) {
  return (MODELS[modelId] || MODELS.vortex).dims;
}

/**
 * Hiyerarşi:
 *   root (zemin çerçevesi: konum, yaw, yol eğimi)
 *     └ visual (pivotY'de; takla / spin / wreck dönüşleri)
 *         └ model (-pivotY)
 *             ├ chassis (süspansiyon, yatış, dalış) → boya (gövde + üst), cam, aksam, kanat, farlar, stoplar
 *             ├ frontLeft / frontRight pivot (direksiyon) → tekerlek (dönüş)
 *             └ rearAxle (dönüş)
 *   shadow: sahneye ayrı eklenir (havada yolda kalır)
 *
 * Dönüş: { root, visual, model, chassis, body, paint, tail, frontPivots, frontWheels, rearAxle, shadow,
 *          dims, viewAnchors: { hood: Vector3, bumper: Vector3 }, setBraking(on), setViewMode(view) }
 */
export function createCarModel(modelId, color) {
  if (typeof modelId === 'number') { // eski imza: createCarModel(color)
    color = modelId;
    modelId = 'vortex';
  }
  const id = MODELS[modelId] ? modelId : 'vortex';
  const def = MODELS[id];
  const D = def.dims;
  const { geo: G, shadow: shadowGeo } = getShared(id);
  const M = getMaterials();

  const paint = M.paint.clone();
  paint.color.set(color);

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const visual = new THREE.Group();
  visual.rotation.order = 'YXZ';
  visual.position.y = D.pivotY;
  root.add(visual);
  const model = new THREE.Group();
  model.position.y = -D.pivotY;
  visual.add(model);

  const chassis = new THREE.Group();
  model.add(chassis);

  const bodyMesh = new THREE.Mesh(G.paintBody, paint);
  bodyMesh.castShadow = true;
  const upperMesh = new THREE.Mesh(G.paintUpper, paint);
  upperMesh.castShadow = true;
  const glassMesh = new THREE.Mesh(G.glass, M.glass);
  const trimMesh = new THREE.Mesh(G.trim, M.trim);
  const topMesh = new THREE.Mesh(G.trimTop, M.trim);
  const headMesh = new THREE.Mesh(G.head, M.headlight);
  const tail = new THREE.Mesh(G.tail, M.taillight);
  chassis.add(bodyMesh, upperMesh, glassMesh, trimMesh, topMesh, headMesh, tail);

  const wheelMats = [M.tire, M.rim];
  const makeFront = (x, geo) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, D.wheelRadius, D.frontAxleZ);
    const wheel = new THREE.Mesh(geo, wheelMats);
    pivot.add(wheel);
    model.add(pivot);
    return { pivot, wheel };
  };
  const fl = makeFront(D.frontTrack, G.wheelL);
  const fr = makeFront(-D.frontTrack, G.wheelR);
  const rear = new THREE.Mesh(G.rearAxle, wheelMats);
  rear.position.set(0, D.wheelRadius, D.rearAxleZ);
  model.add(rear);

  let shadow = null;
  if (shadowGeo) {
    shadow = new THREE.Mesh(shadowGeo, M.shadow);
    shadow.rotation.order = 'YXZ';
    shadow.renderOrder = 1;
  }

  const viewAnchors = {
    hood: new THREE.Vector3(...def.anchors.hood),
    bumper: new THREE.Vector3(...def.anchors.bumper),
  };

  // Kamera iç görünümlerinde kameraya giren parçaları gizler.
  //  chase/far: her şey görünür.  hood: kabin/cam/tavan/kanat gizli, kaput + gövde görünür.
  //  bumper: gövde dahil tüm kabuk gizli; yalnızca tekerlekler ve farlar görünür.
  const setViewMode = (view) => {
    const hood = view === 'hood';
    const bumper = view === 'bumper';
    const inside = hood || bumper;
    bodyMesh.visible = !bumper;
    trimMesh.visible = !bumper;
    tail.visible = !bumper;
    upperMesh.visible = !inside;
    glassMesh.visible = !inside;
    topMesh.visible = !inside;
  };

  return {
    root,
    visual,
    model,
    chassis,
    body: bodyMesh,
    paint,
    tail,
    frontPivots: [fl.pivot, fr.pivot],
    frontWheels: [fl.wheel, fr.wheel],
    rearAxle: rear,
    shadow,
    dims: D,
    viewAnchors,
    setViewMode,
    setBraking(on) {
      tail.material = on ? M.taillightBrake : M.taillight;
    },
  };
}
