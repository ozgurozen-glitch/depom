# Nitro Rush

Asphalt 8'den esinlenen, tarayıcıda çalışan bir arcade yarış oyunu (Three.js).
Şu an tek bölüm (**Riviera Sunset**), tek araba (**Vortex GT**) ve 7 bot rakip var.

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
| Duraklat | Esc / P | sağ üstteki II |
| Yeniden başlat | R | duraklatma menüsü |

Gaz otomatiktir. Drift, havada kalma, nitro tüpleri ve takedown'lar nitro barını doldurur.
Nitro patlamasının sonuna doğru tekrar basarsan **perfect nitro** zinciri başlar.

## Geliştirme

- Modüller ve aralarındaki sözleşme: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Test/ekran görüntüsü: `node tools/shot.mjs --query "skipmenu=1&autopilot=1&speed=2" --wait 8 --shots 3`
  (Playwright ve Chromium gerekir; görüntüler `tools/out/` altına yazılır)
- Hata ayıklama parametreleri: `?skipmenu=1`, `?autopilot=1`, `?speed=N`, `?mute=1`
