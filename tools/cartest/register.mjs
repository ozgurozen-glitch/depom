// Node'da 'three' ve 'three/addons/' çıplak belirteçlerini vendor/ altına yönlendirir.
// Kullanım: node --import ./tools/cartest/register.mjs tools/cartest/physics.mjs
import { register } from 'node:module';

register(new URL('./hooks.mjs', import.meta.url).href, import.meta.url);
