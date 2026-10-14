// Node'da 'three' çıplak belirtecini vendor/ altına yönlendirir ve src/car.js'in ayarlanabilir (araç modeli
// başına ayrı örnek) sürümlerini üretir. Kullanım: node --import ./tools/aisim/register.mjs tools/aisim/run.mjs
import { register } from 'node:module';

register(new URL('./hooks.mjs', import.meta.url).href, import.meta.url);
