# Blok Tahsis Simülatörü

Dosya Sistemlerinde Blok Tahsis Algoritmaları projesi için yazdığım simülatör. Bitişik, bağlı liste (ve FAT), indeksli ve extent tabanlı tahsisi aynı disk üzerinde karşılaştırıyor.

## Nasıl açılır

`simulator.html` dosyasına çift tıklamak yeterli (Chrome, Edge veya Firefox). Kurulum gerekmiyor. En iyi tam ekranda (F11) görünüyor.

Kullanımı:

- Üstteki sekmelerden yöntem seçilir. Her işlem dört yönteme birlikte uygulanır, sekme sadece hangisinin gösterileceğini seçer.
- "Dosya oluştur" ile ad ve boyut girilip dosya oluşturulur.
- Bir dosya seçilince büyütülebilir, silinebilir veya okunabilir. "Oku" bir bloğa erişim yolunu, "Sıralı oku" bütün dosyanın okunmasını gösterir.
- "Rastgele iş yükü" çok sayıda işlemi otomatik çalıştırır.
- "Karşılaştır" dört yöntemi yan yana gösterir.
- Alttaki "Adım günlüğü" her adımda ne yapıldığını yazar.

## Dosyalar

- `simulator.html`: tarayıcıda açılan simülatör
- `sim-core.js`: tahsis yöntemlerinin kodu
- `deney.js`: rapordaki deneyleri çalıştırır, `sonuclar.json` ve `sonuclar.md` dosyalarını üretir
- `sonuclar.json`, `sonuclar.md`: deney sonuçları
- `test.js`, `audit.test.js`: testler
- `simulator.src.html`, `build.js`: simülatörün kaynağı; `node build.js` ile `simulator.html` yeniden oluşturulur

## Deneyleri ve testleri çalıştırmak

Node.js 18 veya üstü gerekiyor, başka paket yok.

```
node deney.js
node test.js
node audit.test.js
node audit.test.js --sonuclar
```

`deney.js` aynı tohumlarla çalıştığı için her seferinde aynı sonuçları verir.

## Deney ayarları

- Disk 8192 blok, blok boyutu 4096 bayt, blok adresi 4 bayt.
- Hedef doluluk %50, %70 ve %90; her biri için 30 farklı tohum.
- Önce disk hedef doluluğa kadar doldurulur, sonra 5000 işlem yapılır: %45 oluşturma, %35 silme, %20 büyütme.
- Dosya boyutları: %70'i 1–8 blok, %25'i 9–64 blok, %5'i 65–400 blok.
- Bitişik tahsis için ilk uygun ve en uygun boşluk ayrıca karşılaştırıldı.
