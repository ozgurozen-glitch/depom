import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const THREE = pathToFileURL(path.join(ROOT, 'vendor/three/three.module.js')).href;
const ADDONS = pathToFileURL(path.join(ROOT, 'vendor/three/addons/')).href;

export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: THREE, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) {
    return { url: ADDONS + specifier.slice('three/addons/'.length), shortCircuit: true };
  }
  return next(specifier, context);
}
