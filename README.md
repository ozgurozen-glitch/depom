# Nitro Rush

Asphalt 8'den esinlenen, tarayıcıda çalışan bir arcade yarış oyunu (Three.js).
İki pist (**Riviera Sunset**, **Bangkok Nights**), üç araç (**Vortex GT**, **Raijin RS**, **Titan V8**),
7 bot rakip ve üç zorluk seviyesi var. Pist, araç, boya ve zorluk garajdan seçilir; pist rekorları tarayıcıda saklanır.

## Çalıştırma

Derleme gerekmez; dosyaları herhangi bir statik sunucuyla açman yeterli:

```bash
npx serve .            # veya: python3 -m http.server 8000
```

Sonra tarayıcıda `http://localhost:3000` (ya da `:8000`) adresini aç.
`index.html`'i doğrudan dosya olarak açmak çalışmaz; ES modülleri bir sunucu ister.

## Kontroller

| Eylem | Klavye | Dokunmatik |
|---|---|---|
| Direksiyon | ← → / A D | sol alttaki ◀ ▶ |
| Fren / drift | ↓ / S / Space | DRIFT düğmesi |
| Nitro | ↑ / W / Shift / N | NITRO düğmesi |
| Shockwave nitro | bar doluyken nitroya çift bas | NITRO'ya çift dokun |
| Kamera görünümü (takip/uzak/kaput/tampon) | C | sağ üstteki kamera düğmesi |
| Duraklat | Esc / P | sağ üstteki II |
| Yeniden başlat | R | duraklatma menüsü |

Gaz otomatiktir. Drift, havada kalma, nitro tüpleri ve takedown'lar nitro barını doldurur.
Nitro patlamasının sonuna doğru tekrar basarsan **perfect nitro** zinciri başlar.

## Geliştirme

- Modüller ve aralarındaki sözleşme: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Test/ekran görüntüsü: `node tools/shot.mjs --query "skipmenu=1&autopilot=1&speed=6&fxq=low" --wait 20 --shots 3 --interval 15`
  (Playwright ve Chromium gerekir; görüntüler `tools/out/` altına yazılır)
- Hata ayıklama parametreleri: `?skipmenu=1`, `?autopilot=1`, `?speed=N`, `?mute=1`, `?fxq=low|medium|high`,
  `?track=riviera|bangkok`, `?car=vortex|raijin|titan`, `?difficulty=easy|normal|hard`
- Tek dosyalık yayın sürümü: `node tools/build-artifact.mjs [çıktı.html] --check`
- Bot simülasyonu ve testleri: `tools/aisim/` (ör. `node --import ./tools/aisim/register.mjs tools/aisim/collisions.test.mjs`)
- Diğer araçlar: `tools/trackview.mjs` (pistten sabit kamera görüntüleri), `tools/cartest/` (araba fiziği testleri:
  `node --import ./tools/cartest/register.mjs tools/cartest/physics.mjs`)
