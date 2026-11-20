# Blok tahsis yöntemleri: deney sonuçları

Bu dosya `node deney.js` ile üretilmiştir; elle düzenlemeyin. Ham değerler `sonuclar.json` içindedir.

## Deney düzeni

| Parametre | Değer |
|---|---|
| Disk | N = 8192 blok, B = 4096 bayt, blok adresi P = 4 bayt |
| Hedef doluluk (u) | 0,50; 0,70; 0,90 |
| Tohumlar | 1–30 (30 bağımsız iz), PRNG: mulberry32 |
| Dosya boyutu dağılımı | %70 1–8 blok; %25 9–64 blok; %5 65–400 blok; son blok içinde rastgele kuyruk |
| Aşama 1 | referans doluluk u olana dek yalnızca oluşturma |
| Aşama 2 (yaşlandırma) | 5000 işlem: %45 oluşturma, %35 silme, %20 büyütme (1–32 blok); referans doluluk u ± 0,05 dışına çıkınca zorunlu silme / oluşturma |
| Ölçüm | durum ölçütleri iz sonunda; ret, taşıma ve atlama sayıları tüm iz boyunca |
| Hücre biçimi | ortalama ± örneklem standart sapması (30 tohum) |

Aynı işlem izi beş sütunun hepsine uygulanır. İz hiçbir yöntemin durumuna bakmaz: referans doluluk, canlı mantıksal dosyaların istenen veri bloklarından (⌈bayt / B⌉) hesaplanır. Bir yöntem bir dosyayı oluşturamadıysa o dosyaya gelen sonraki işlemler o yöntem için atlanır ve sayılır.

### İz istatistikleri (yöntemden bağımsız)

| u | Toplam işlem | Aşama 1 oluşturma | Oluşturma | Silme | Büyütme | Zorunlu silme | Zorunlu oluşturma | Son referans doluluk | En yüksek referans doluluk |
|---|---|---|---|---|---|---|---|---|---|
| 0,50 | 5174,7 | 174,7 | 2227,4 | 2086,5 | 860,7 | 564,0 | 91,3 | 0,524 ± 0,030 | 0,594 (en çok 0,598) |
| 0,70 | 5239,3 | 239,3 | 2289,7 | 2091,1 | 858,5 | 574,4 | 108,0 | 0,707 ± 0,031 | 0,794 (en çok 0,798) |
| 0,90 | 5304,7 | 304,7 | 2342,4 | 2102,3 | 859,9 | 587,5 | 92,5 | 0,925 ± 0,029 | 0,994 (en çok 0,998) |

## Hedef doluluk u = 0,50

| Ölçüt | Bitişik | Bağlı liste | İndeksli | Extent | FAT |
|---|---:|---:|---:|---:|---:|
| Doluluk (kullanılan blok / N) | 0,524 ± 0,030 | 0,525 ± 0,030 | 0,542 ± 0,029 | 0,524 ± 0,030 | 0,524 ± 0,030 |
| Canlı dosya sayısı | 140,9 ± 21,4 | 140,9 ± 21,4 | 140,9 ± 21,4 | 140,9 ± 21,4 | 140,9 ± 21,4 |
| Boşluk sayısı | 56,2 ± 6,9 | 47,1 ± 32,6 | 48,8 ± 34,2 | 61,7 ± 8,1 | 46,7 ± 32,1 |
| En büyük boşluk (blok) | 2392,6 ± 433,8 | 3516,7 ± 132,5 | 3368,5 ± 123,1 | 2528,5 ± 396,3 | 3521,3 ± 132,1 |
| Dış parçalanma indeksi | 0,388 ± 0,098 | 0,094 ± 0,050 | 0,100 ± 0,052 | 0,352 ± 0,089 | 0,094 ± 0,050 |
| Dosya başına ortalama parça sayısı | 1,00 ± 0,00 | 9,18 ± 1,37 | 8,90 ± 1,23 | 1,36 ± 0,05 | 9,18 ± 1,33 |
| Sıralı okuma maliyeti / veri bloğu | 1,000 ± 0,000 | 1,262 ± 0,015 | 1,299 ± 0,022 | 1,012 ± 0,002 | 1,263 ± 0,017 |
| Sıralı okuma maliyeti / dosya (okuma + konumlanma) | 31,3 ± 6,1 | 39,5 ± 7,4 | 40,6 ± 7,3 | 31,7 ± 6,2 | 39,5 ± 7,4 |
| Dosya başına konumlanma sayısı | 0,00 ± 0,00 | 8,18 ± 1,37 | 8,26 ± 1,23 | 0,37 ± 0,05 | 8,18 ± 1,33 |
| Ortalama konumlanma uzaklığı (blok) | 0,0 ± 0,0 | 164,4 ± 25,7 | 167,5 ± 24,5 | 992,9 ± 127,4 | 163,9 ± 25,0 |
| Rastgele erişim maliyeti (okuma) | 1,00 ± 0,00 | 63,95 ± 13,27 | 2,00 ± 0,00 | 1,01 ± 0,02 | 1,00 ± 0,00 |
| Üstveri yükü (%) | 0,000 ± 0,000 | 0,051 ± 0,003 | 1,720 ± 0,262 | 0,006 ± 0,009 | 0,098 ± 0,000 |
| İç parçalanma (%) | 0,846 ± 0,139 | 0,842 ± 0,139 | 0,846 ± 0,139 | 0,846 ± 0,139 | 0,846 ± 0,139 |
| Taşınan blok (tüm iz) | 16106,2 ± 1242,5 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 |
| Reddedilen oluşturma (tüm iz) | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 |
| Reddedilen büyütme (tüm iz) | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 |
| — dış parçalanma kaynaklı ret | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 |
| — boş blok yetersizliğinden ret | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 |
| — üstveri bloğuna yer kalmadığından ret | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 |
| Atlanan işlem (dosya o yöntemde yok) | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 |

## Hedef doluluk u = 0,70

| Ölçüt | Bitişik | Bağlı liste | İndeksli | Extent | FAT |
|---|---:|---:|---:|---:|---:|
| Doluluk (kullanılan blok / N) | 0,694 ± 0,043 | 0,708 ± 0,031 | 0,731 ± 0,032 | 0,707 ± 0,031 | 0,707 ± 0,031 |
| Canlı dosya sayısı | 198,3 ± 25,4 | 198,6 ± 25,2 | 198,6 ± 25,2 | 198,6 ± 25,2 | 198,6 ± 25,2 |
| Boşluk sayısı | 74,5 ± 11,9 | 71,6 ± 49,5 | 72,4 ± 47,6 | 76,9 ± 15,7 | 72,2 ± 48,2 |
| En büyük boşluk (blok) | 789,4 ± 358,4 | 1847,3 ± 145,6 | 1647,5 ± 129,6 | 861,7 ± 501,5 | 1853,5 ± 145,3 |
| Dış parçalanma indeksi | 0,683 ± 0,141 | 0,220 ± 0,102 | 0,242 ± 0,106 | 0,642 ± 0,201 | 0,220 ± 0,102 |
| Dosya başına ortalama parça sayısı | 1,00 ± 0,00 | 8,30 ± 1,05 | 8,07 ± 1,01 | 1,38 ± 0,06 | 8,28 ± 1,01 |
| Sıralı okuma maliyeti / veri bloğu | 1,000 ± 0,000 | 1,246 ± 0,012 | 1,284 ± 0,014 | 1,013 ± 0,003 | 1,246 ± 0,012 |
| Sıralı okuma maliyeti / dosya (okuma + konumlanma) | 29,1 ± 3,8 | 36,9 ± 5,0 | 38,0 ± 4,9 | 30,0 ± 4,0 | 36,9 ± 4,9 |
| Dosya başına konumlanma sayısı | 0,00 ± 0,00 | 7,30 ± 1,05 | 7,38 ± 1,01 | 0,38 ± 0,07 | 7,28 ± 1,01 |
| Ortalama konumlanma uzaklığı (blok) | 0,0 ± 0,0 | 237,8 ± 34,3 | 243,7 ± 35,3 | 1358,1 ± 197,9 | 238,2 ± 34,2 |
| Rastgele erişim maliyeti (okuma) | 1,00 ± 0,00 | 63,39 ± 11,28 | 2,00 ± 0,00 | 1,02 ± 0,02 | 1,00 ± 0,00 |
| Üstveri yükü (%) | 0,000 ± 0,000 | 0,069 ± 0,003 | 2,424 ± 0,308 | 0,013 ± 0,013 | 0,098 ± 0,000 |
| İç parçalanma (%) | 1,209 ± 0,150 | 1,207 ± 0,152 | 1,211 ± 0,149 | 1,211 ± 0,149 | 1,211 ± 0,149 |
| Taşınan blok (tüm iz) | 16267,2 ± 1254,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 |
| Reddedilen oluşturma (tüm iz) | 4,5 ± 1,4 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 |
| Reddedilen büyütme (tüm iz) | 0,9 ± 1,1 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 |
| — dış parçalanma kaynaklı ret | 5,4 ± 1,9 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 |
| — boş blok yetersizliğinden ret | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 |
| — üstveri bloğuna yer kalmadığından ret | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 |
| Atlanan işlem (dosya o yöntemde yok) | 6,6 ± 3,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 |

## Hedef doluluk u = 0,90

| Ölçüt | Bitişik | Bağlı liste | İndeksli | Extent | FAT |
|---|---:|---:|---:|---:|---:|
| Doluluk (kullanılan blok / N) | 0,760 ± 0,045 | 0,926 ± 0,029 | 0,925 ± 0,032 | 0,927 ± 0,029 | 0,925 ± 0,029 |
| Canlı dosya sayısı | 235,8 ± 33,3 | 240,1 ± 33,0 | 239,3 ± 32,9 | 240,1 ± 33,0 | 240,1 ± 33,0 |
| Boşluk sayısı | 87,9 ± 12,6 | 51,0 ± 23,9 | 50,4 ± 25,8 | 97,5 ± 18,9 | 51,6 ± 24,4 |
| En büyük boşluk (blok) | 352,1 ± 208,6 | 174,5 ± 108,7 | 183,4 ± 112,8 | 40,3 ± 24,2 | 177,3 ± 110,0 |
| Dış parçalanma indeksi | 0,821 ± 0,085 | 0,693 ± 0,190 | 0,682 ± 0,196 | 0,930 ± 0,036 | 0,690 ± 0,192 |
| Dosya başına ortalama parça sayısı | 1,00 ± 0,00 | 8,30 ± 1,09 | 8,03 ± 1,04 | 2,24 ± 0,34 | 8,31 ± 1,10 |
| Sıralı okuma maliyeti / veri bloğu | 1,000 ± 0,000 | 1,227 ± 0,010 | 1,266 ± 0,010 | 1,042 ± 0,006 | 1,227 ± 0,010 |
| Sıralı okuma maliyeti / dosya (okuma + konumlanma) | 26,9 ± 3,5 | 39,5 ± 5,6 | 39,5 ± 5,4 | 33,5 ± 4,9 | 39,5 ± 5,6 |
| Dosya başına konumlanma sayısı | 0,00 ± 0,00 | 7,30 ± 1,09 | 7,29 ± 1,04 | 1,30 ± 0,35 | 7,31 ± 1,10 |
| Ortalama konumlanma uzaklığı (blok) | 0,0 ± 0,0 | 309,2 ± 43,5 | 317,4 ± 42,8 | 2082,2 ± 147,7 | 308,6 ± 42,5 |
| Rastgele erişim maliyeti (okuma) | 1,00 ± 0,00 | 71,38 ± 10,89 | 2,00 ± 0,00 | 1,40 ± 0,08 | 1,00 ± 0,00 |
| Üstveri yükü (%) | 0,000 ± 0,000 | 0,090 ± 0,003 | 2,922 ± 0,402 | 0,171 ± 0,033 | 0,098 ± 0,000 |
| İç parçalanma (%) | 1,442 ± 0,214 | 1,457 ± 0,212 | 1,463 ± 0,211 | 1,468 ± 0,211 | 1,468 ± 0,211 |
| Taşınan blok (tüm iz) | 13572,9 ± 1058,2 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 |
| Reddedilen oluşturma (tüm iz) | 38,2 ± 5,8 | 0,0 ± 0,0 | 6,5 ± 2,0 | 0,0 ± 0,2 | 0,0 ± 0,0 |
| Reddedilen büyütme (tüm iz) | 7,1 ± 3,4 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 |
| — dış parçalanma kaynaklı ret | 45,3 ± 7,8 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 |
| — boş blok yetersizliğinden ret | 0,0 ± 0,0 | 0,0 ± 0,0 | 6,5 ± 2,0 | 0,0 ± 0,2 | 0,0 ± 0,0 |
| — üstveri bloğuna yer kalmadığından ret | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 |
| Atlanan işlem (dosya o yöntemde yok) | 46,1 ± 6,2 | 0,0 ± 0,0 | 7,9 ± 2,4 | 0,0 ± 0,2 | 0,0 ± 0,0 |

## Duyarlılık: bitişik tahsiste ilk uygun ve en uygun

Aynı 30 iz, yalnızca yerleştirme politikası değişir. İlk uygun sütunları yukarıdaki "Bitişik" sütunlarıyla aynıdır.

| Ölçüt | İlk uygun (first-fit), u = 0,70 | En uygun (best-fit), u = 0,70 | İlk uygun (first-fit), u = 0,90 | En uygun (best-fit), u = 0,90 |
|---|---:|---:|---:|---:|
| Doluluk (kullanılan blok / N) | 0,694 ± 0,043 | 0,695 ± 0,037 | 0,760 ± 0,045 | 0,751 ± 0,047 |
| Canlı dosya sayısı | 198,3 ± 25,4 | 198,3 ± 25,3 | 235,8 ± 33,3 | 235,8 ± 33,4 |
| Boşluk sayısı | 74,5 ± 11,9 | 52,1 ± 9,8 | 87,9 ± 12,6 | 62,8 ± 8,6 |
| En büyük boşluk (blok) | 789,4 ± 358,4 | 620,4 ± 291,6 | 352,1 ± 208,6 | 295,2 ± 100,6 |
| Dış parçalanma indeksi | 0,683 ± 0,141 | 0,751 ± 0,117 | 0,821 ± 0,085 | 0,853 ± 0,050 |
| Taşınan blok (tüm iz) | 16267,2 ± 1254,0 | 19521,1 ± 1427,5 | 13572,9 ± 1058,2 | 16552,4 ± 1559,2 |
| Reddedilen oluşturma (tüm iz) | 4,5 ± 1,4 | 4,2 ± 1,7 | 38,2 ± 5,8 | 33,4 ± 5,2 |
| Reddedilen büyütme (tüm iz) | 0,9 ± 1,1 | 1,7 ± 1,8 | 7,1 ± 3,4 | 6,8 ± 3,6 |
| — dış parçalanma kaynaklı ret | 5,4 ± 1,9 | 5,9 ± 2,5 | 45,3 ± 7,8 | 40,3 ± 7,6 |
| — boş blok yetersizliğinden ret | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 | 0,0 ± 0,0 |
| Atlanan işlem (dosya o yöntemde yok) | 6,6 ± 3,0 | 5,5 ± 3,0 | 46,1 ± 6,2 | 40,3 ± 5,3 |

### Eşleştirilmiş fark (en uygun − ilk uygun, aynı iz)

Hücre: farkın ortalaması ± standart sapması; parantez içinde en uygunun daha düşük / eşit / daha yüksek çıktığı tohum sayısı.

| Ölçüt | u = 0,70 | u = 0,90 |
|---|---:|---:|
| Reddedilen istek (oluşturma + büyütme) | +0,5 ± 2,6 (13 / 3 / 14) | −5,0 ± 7,3 (21 / 1 / 8) |
| Dış parçalanma kaynaklı ret | +0,5 ± 2,6 (13 / 3 / 14) | −5,0 ± 7,3 (21 / 1 / 8) |
| Boşluk sayısı | −22,4 ± 6,9 (30 / 0 / 0) | −25,1 ± 8,9 (30 / 0 / 0) |
| En büyük boşluk (blok) | −169,0 ± 300,3 (22 / 0 / 8) | −57,0 ± 161,6 (19 / 1 / 10) |
| Dış parçalanma indeksi | +0,068 ± 0,119 (8 / 0 / 22) | +0,032 ± 0,075 (7 / 0 / 23) |
| Taşınan blok | +3254,0 ± 1310,3 (0 / 0 / 30) | +2979,4 ± 964,4 (0 / 0 / 30) |

## Kuramsal tutarlılık denetimleri

| Denetim | Sonuç | Ayrıntı |
|---|---|---|
| Bitişik: rastgele erişim maliyeti tam 1,0 | tamam | u = 0,50 / 0,70 / 0,90 için ortalama 1,000 / 1,000 / 1,000 |
| Bitişik: dosya başına parça sayısı tam 1 | tamam | ortalama 1,000 / 1,000 / 1,000 |
| FAT: rastgele erişim maliyeti tam 1,0 | tamam | ortalama 1,000 / 1,000 / 1,000 |
| İndeksli: tüm dosyalar tek indeks bloğuna sığdığında rastgele erişim tam 2,0 | tamam | ortalama 2,000 / 2,000 / 2,000 (en parçalı dosyada 114 parça) |
| Extent: rastgele erişim 1 ile 2 arasında | tamam | ortalama 1,011 / 1,019 / 1,405 |
| Bağlı liste: rastgele erişim maliyeti dosya uzunluğuyla büyür (>> 2) | tamam | ortalama 63,951 / 63,391 / 71,383 |
| Dış parçalanma kaynaklı ret yalnızca bitişik yöntemde | tamam | bitişik: 0,000 / 5,400 / 45,300; diğerleri: 0 |
| Extent parça sayısı bitişik (1) ile bağlı liste arasında | tamam | extent 1,363 / 1,378 / 2,244; bağlı liste 9,183 / 8,299 / 8,297 |
| Bitişik: sıralı okuma maliyeti / blok tam 1,0 | tamam | ortalama 1,000 / 1,000 / 1,000 |
| Taşıma yalnızca bitişik yöntemde | tamam | bitişik: 16106,2 / 16267,2 / 13572,9 blok |
| FAT üstveri yükü sabit P/B | tamam | 0,0977 % |
| Bağlı liste üstveri yükü = veri bloğu × P / (N × B) | tamam | ortalama 0,0513 / 0,0691 / 0,0904 % |
| İndeksli üstveri = dosya başına 1 indeks bloğu | tamam | indeks bloğu sayısı = canlı dosya sayısı |
| İz, referans diskin kapasitesini hiç aşmadı | tamam | en yüksek referans doluluk 0,598 / 0,798 / 0,998 |
| Duyarlılık çalışmasındaki ilk uygun sonuçları ana deneyle aynı | tamam | aynı tohumlar, aynı izler |

## Ölçüt tanımları

- **Doluluk**: (veri + üstveri blokları) / N.
- **Dış parçalanma indeksi**: 1 − en büyük boşluk / toplam boş blok (boş alan yoksa 0).
- **Parça sayısı**: dosyanın veri bloklarının mantıksal sıradaki azami ardışık koşu sayısı.
- **Sıralı okuma maliyeti**: dosyayı baştan sona okumak için disk okuması + konumlanma sayısı; okunan blok bir önceki okunan blok + 1 değilse bir konumlanma sayılır, üstveri okumaları yola dahildir, ilk konumlanma sayılmaz. "/ veri bloğu" satırı tüm dosyalar üzerinden havuzlanmış orandır (ideal değer 1).
- **Rastgele erişim maliyeti**: tüm dosyaların tüm mantıksal blokları üzerinden ortalama erişim yolu uzunluğu (disk okuması).
- **Üstveri yükü**: (üstveri blokları × B + veri blokları içindeki işaretçi baytları [+ FAT için N × P]) / (N × B).
- **İç parçalanma**: ayrılan veri bloklarındaki kullanılmayan yük baytları / (N × B).
- **Dış parçalanma kaynaklı ret**: gereken blok sayısı kadar boş blok bulunduğu halde yöntemin kuralı sağlanamadığı için reddedilen istek.
