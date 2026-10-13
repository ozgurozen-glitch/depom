---
name: orkestra
description: Bir görevi alt görevlere böler, her alt görevi en uygun ajan türüne (Explore, Plan, general-purpose, claude-code-guide, projeye özel ajanlar) otomatik atar, bağımsız işleri paralel çalıştırır, sonuçları birleştirip doğrular. Kullanıcı "/orkestra <görev>" yazdığında ya da işi ajanlara dağıtmamı, ekip gibi paralel çalışmamı açıkça istediğinde kullan. Use when the user explicitly asks to orchestrate, delegate or split work across multiple subagents.
argument-hint: <görev açıklaması>
---

# Orkestra: ajanlara otomatik görev dağıtımı

**Görev:** $ARGUMENTS

Görev boşsa kullanıcıya ne yapılacağını sor ve dur.

Amaç: her alt görevi en iyi yaptığı işe göre seçilen ajana vermek, bağımsız işleri aynı anda yürütmek, toplam maliyeti ve süreyi en aza indirmek.

## 0. Bölmeye değer mi?

Her ajan sıfırdan başlar ve bağlamı yeniden kurar; bu pahalıdır. Önce karar ver:

- **Kendin yap:** tek dosyalık değişiklik, tek bir soru, bağlamı zaten sende olan birkaç dakikalık iş. Kullanıcıya tek satırla "bu iş için ajan gereksizdi, doğrudan yaptım" de.
- **Orkestra kur:** birbirinden bağımsız birden çok parça, geniş kod taraması, paralel yürütülebilecek araştırmalar, ayrı modüllerde değişiklikler.

## 1. Hızlı keşif (kendin)

- Proje yapısını ve görevle ilgili dosyaları 1-3 hızlı Glob/Grep/Read ile anla. Geniş tarama gerekiyorsa bu adımı Explore ajanına ver.
- Kullanılabilir ajanları belirle: sistem mesajındaki "Available agent types" listesi, ayrıca `.claude/agents/*.md` ve `~/.claude/agents/*.md` (özel ajanlar). Listede olmayan bir ajan türüne asla atama yapma.

## 2. Ayrıştır

Görevi alt görevlere böl. Her alt görev için şunları yaz:

- **id** (A, B, C…) ve tek cümlelik hedef
- **tür:** arama, plan, uygulama, araştırma, doğrulama, Claude Code sorusu…
- **dosyalar:** yazacaksa dokunacağı dosyalar
- **bağımlılık:** hangi alt görevin çıktısına ihtiyaç duyduğu

Kurallar:
- Alt görevler örtüşmesin. Aynı dosyaya yazan iki alt görev ya birleştirilir ya sıraya konur.
- İdeal sayı 2-5'tir, 6'yı geçme. Sırf paralellik olsun diye parçalama.

## 3. Ata (yönlendirme tablosu)

| Alt görev türü | Ajan | Not |
|---|---|---|
| Açıklaması alt görevle doğrudan eşleşen projeye özel ajan | o ajan | Genel ajanlardan önce gelir |
| "X nerede / nasıl kullanılıyor", çok dosyada tarama, sadece sonuç lazım | `Explore` | Salt okunur. Prompt'ta derinlik belirt: quick, medium, very thorough |
| Uygulama planı, mimari, trade-off, kritik dosyaların tespiti | `Plan` | Salt okunur, kod yazmaz |
| Kod yazma/değiştirme, çok adımlı yürütme, test çalıştırma, belirsiz arama, web araştırması | `general-purpose` | Paralel yazıcılarda `isolation: "worktree"` |
| Claude Code, Agent SDK, Claude API, hook, MCP, ayar soruları | `claude-code-guide` | Önceden açılmışsa yenisini açma, SendMessage ile devam et |
| Status line yapılandırması | `statusline-setup` | |
| Hiçbirine uymayan | `claude` (yoksa `general-purpose`) | Genel amaçlı yedek |
| Çok küçük, bağlamı zaten sende olan iş | ajan yok, kendin yap | Bağlam aktarmak işin kendisinden pahalı |

Ek atama kuralları:
- Salt okunur işleri salt okunur ajanlara (Explore, Plan) ver. Yazma yetkisini yalnızca yazması gereken ajana ver.
- Model: varsayılanı bırak. Basit, mekanik salt okunur aramalarda maliyeti düşürmek için `model: "haiku"` seçilebilir; zor akıl yürütme gerektiren işlerde değiştirme.
- `effort` parametresini yalnızca kullanıcı açıkça isterse ayarla.

## 4. Dağıtım planını göster

Ajanları başlatmadan önce kullanıcıya kısa bir tablo göster:

| # | Alt görev | Ajan | Bağımlılık | Dalga |
|---|---|---|---|---|

Kullanıcı `/orkestra` ile zaten istediği için onay beklemeden başla. Tek istisna: plan geri alınması zor bir adım içeriyorsa (push, silme, deploy, dış servise yazma) önce sor.

## 5. Dalgalar halinde çalıştır

- **Dalga 1:** bağımlılığı olmayan tüm alt görevler. Hepsini **tek mesajda birden çok Agent çağrısı** olarak, arka planda (varsayılan) başlat. Her çağrıya 3-5 kelimelik bir `description` ver.
- **Beklerken boş durma:** sana kalan küçük işleri yap, sonraki dalganın prompt'larını hazırla. `sleep` ya da polling kullanma; ajan bitince bildirim gelir.
- **Sonuç uydurma:** bildirim gelmeden bir ajanın sonucunu tahmin etme, "bitti" deme.
- **Sonraki dalgalar:** bir ajanın çıktısı geldiğinde ona bağlı alt görevleri başlat ve gereken özeti prompt'a ekle.
- **Çakışma önleme:** aynı dosyalara yazabilecek paralel uygulama ajanlarına `isolation: "worktree"` ver ya da dosya kümelerini kesin olarak ayır.
- **Devam işleri:** bir ajanın işine ek gerekiyorsa yeni ajan açma, SendMessage ile aynı ajana yaz; bağlamı korunur.

## 6. Ajan prompt şablonu

Ajan senin konuşmanı görmez. Her prompt kendi başına anlaşılır olmalı:

```
## Bağlam
<proje, ana görev, bu alt görevin büyük resimdeki yeri,
 bildiğin ilgili dosya yolları ve önceki ajanlardan gelen bulgular>

## Görevin
<tek, net hedef>

## Kapsam
- Dokunabileceğin dosyalar: …
- Dokunmaman gerekenler: … (başka ajanların alanı)
- (Explore için) tarama derinliği: quick | medium | very thorough

## Kısıtlar
- Commit, push yapma, PR açma; bunları orkestratör yapar.
- Kapsam dışına çıkma; gerekli gördüğün ek işi raporda öner.

## Teslim formatı
- 5-15 satırlık özet
- Değiştirilen dosyalar (yol:satır)
- Doğrulama: çalıştırdığın komutlar ve sonuçları
- Açık sorular ve riskler
```

## 7. Birleştir ve doğrula

- Ajan raporları kullanıcıya görünmez; önemli olanı sen aktar.
- Raporları birbirine karşı kontrol et: çelişki, örtüşen değişiklik, eksik parça var mı?
- Worktree'de çalışan ajanların değişikliklerini ana çalışma ağacına al (merge veya cherry-pick) ve çakışmaları çöz.
- Projenin kendi kontrollerini çalıştır (lint, format, typecheck, test). Hata küçükse kendin düzelt, büyükse SendMessage ile ilgili ajana geri gönder.
- Ajan "yaptım" dese bile kritik değişiklikleri diff üzerinden kendin gözden geçir.

## 8. Final raporu

Kısa bir tabloyla bitir:

| # | Alt görev | Ajan | Sonuç |
|---|---|---|---|

Altına şunları yaz: neyi doğruladın (komut ve sonuç), neyi doğrulayamadın, kullanıcıdan beklenen karar. Commit ve push'u yalnızca kullanıcı istediyse ya da oturum talimatları gerektiriyorsa yap.

## Örnek

`/orkestra kullanıcı girişine şifre sıfırlama ekle ve testlerini yaz`

| # | Alt görev | Ajan | Bağımlılık | Dalga |
|---|---|---|---|---|
| A | Mevcut auth akışını ve e-posta servisini bul (medium) | Explore | - | 1 |
| B | Şifre sıfırlama için uygulama planı | Plan | A | 2 |
| C | Backend endpoint + token mantığı | general-purpose (worktree) | B | 3 |
| D | Birim ve entegrasyon testleri | general-purpose (worktree) | B | 3 |
| E | Birleştirme, test çalıştırma, gözden geçirme | orkestratör (sen) | C, D | 4 |

## Verimlilik kuralları (özet)

1. Gereksiz ajan açma; her ajan bağlamı sıfırdan kurar.
2. Bağımsız işleri tek mesajda paralel başlat, bağımlıları sıraya koy.
3. Aynı dosyaya iki yazıcı koyma.
4. Salt okunur işler salt okunur ajanlara gider.
5. Devam işleri için SendMessage kullan, yeni ajan açma.
6. Bekleme süresini kendi işinle doldur; polling yapma.
7. Sonuç uydurma; doğrulanmamış bir şeyi doğrulanmış gibi sunma.
