'use strict';
const fs = require('fs');
const path = require('path');
const Sim = require('./sim-core.js');

const PARAMS = {
  N: 8192,
  B: 4096,
  P: 4,
  utilizations: [0.50, 0.70, 0.90],
  seeds: Array.from({ length: 30 }, (_, i) => i + 1),
  agingOps: 5000,
  classes: Sim.DEFAULT_CLASSES,
  mix: Sim.DEFAULT_MIX,
  extendMax: 32,
  band: 0.05,
  sensitivityUtilizations: [0.70, 0.90]
};

const VARIANTS = [
  { key: 'contiguous', label: 'Bitişik', opts: { method: 'contiguous', policy: 'first-fit' } },
  { key: 'linked', label: 'Bağlı liste', opts: { method: 'linked' } },
  { key: 'indexed', label: 'İndeksli', opts: { method: 'indexed' } },
  { key: 'extent', label: 'Extent', opts: { method: 'extent' } },
  { key: 'fat', label: 'FAT', opts: { method: 'linked', fat: true } }
];
const SENS_VARIANTS = [
  { key: 'first-fit', label: 'İlk uygun (first-fit)', opts: { method: 'contiguous', policy: 'first-fit' } },
  { key: 'best-fit', label: 'En uygun (best-fit)', opts: { method: 'contiguous', policy: 'best-fit' } }
];

const METRICS = [
  { key: 'utilization', label: 'Doluluk (kullanılan blok / N)', d: 3 },
  { key: 'fileCount', label: 'Canlı dosya sayısı', d: 1 },
  { key: 'freeRuns', label: 'Boşluk sayısı', d: 1 },
  { key: 'largestFreeRun', label: 'En büyük boşluk (blok)', d: 1 },
  { key: 'extFragIndex', label: 'Dış parçalanma indeksi', d: 3 },
  { key: 'meanFragments', label: 'Dosya başına ortalama parça sayısı', d: 2 },
  { key: 'seqCostPerBlock', label: 'Sıralı okuma maliyeti / veri bloğu', d: 3 },
  { key: 'seqCostMean', label: 'Sıralı okuma maliyeti / dosya (okuma + konumlanma)', d: 1 },
  { key: 'seqSeeksMean', label: 'Dosya başına konumlanma sayısı', d: 2 },
  { key: 'meanSeekDistance', label: 'Ortalama konumlanma uzaklığı (blok)', d: 1 },
  { key: 'randomAccessCost', label: 'Rastgele erişim maliyeti (okuma)', d: 2 },
  { key: 'metaOverhead', label: 'Üstveri yükü (%)', d: 3, scale: 100 },
  { key: 'internalWaste', label: 'İç parçalanma (%)', d: 3, scale: 100 },
  { key: 'movedBlocks', label: 'Taşınan blok (tüm iz)', d: 1 },
  { key: 'failedCreates', label: 'Reddedilen oluşturma (tüm iz)', d: 1 },
  { key: 'failedExtends', label: 'Reddedilen büyütme (tüm iz)', d: 1 },
  { key: 'fragFailures', label: '— dış parçalanma kaynaklı ret', d: 1 },
  { key: 'noSpaceFailures', label: '— boş blok yetersizliğinden ret', d: 1 },
  { key: 'metaFailures', label: '— üstveri bloğuna yer kalmadığından ret', d: 1 },
  { key: 'skipped', label: 'Atlanan işlem (dosya o yöntemde yok)', d: 1 }
];
const SENS_METRICS = ['utilization', 'fileCount', 'freeRuns', 'largestFreeRun', 'extFragIndex', 'movedBlocks',
  'failedCreates', 'failedExtends', 'fragFailures', 'noSpaceFailures', 'skipped'];

const PAIRED_METRICS = ['failedTotal', 'fragFailures', 'freeRuns', 'largestFreeRun', 'extFragIndex', 'movedBlocks'];
const PAIRED_LABELS = {
  failedTotal: 'Reddedilen istek (oluşturma + büyütme)', fragFailures: 'Dış parçalanma kaynaklı ret', freeRuns: 'Boşluk sayısı',
  largestFreeRun: 'En büyük boşluk (blok)', extFragIndex: 'Dış parçalanma indeksi', movedBlocks: 'Taşınan blok'
};
const PAIRED_DECIMALS = { failedTotal: 1, fragFailures: 1, freeRuns: 1, largestFreeRun: 1, extFragIndex: 3, movedBlocks: 1 };

function stats(xs) {
  const n = xs.length;
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (n - 1)) : 0;
  return { mean: mean, sd: sd, min: Math.min.apply(null, xs), max: Math.max.apply(null, xs), n: n };
}
function uKey(u) { return u.toFixed(2); }
function fmt(x, d) { return x.toFixed(d).replace('.', ','); }
function cell(s, m) {
  const k = m.scale || 1;
  return fmt(s.mean * k, m.d) + ' ± ' + fmt(s.sd * k, m.d);
}

function runCell(variants, u, metricKeys) {
  const raw = {}, traceStats = [];
  variants.forEach((v) => { raw[v.key] = {}; metricKeys.forEach((k) => { raw[v.key][k] = []; }); });
  for (const seed of PARAMS.seeds) {
    const trace = Sim.generateTrace({
      N: PARAMS.N, B: PARAMS.B, u: u, seed: seed, agingOps: PARAMS.agingOps,
      classes: PARAMS.classes, extendMax: PARAMS.extendMax, band: PARAMS.band, mix: PARAMS.mix
    });
    traceStats.push(trace.stats);
    for (const v of variants) {
      const a = Sim.createAllocator(Object.assign({ N: PARAMS.N, B: PARAMS.B, P: PARAMS.P, log: false }, v.opts));
      Sim.runTrace(a, trace);
      const errs = a.checkInvariants();
      if (errs.length) throw new Error('Değişmez ihlali (' + v.key + ', u=' + u + ', tohum=' + seed + '): ' + errs.join('; '));
      const m = a.metrics();
      metricKeys.forEach((k) => raw[v.key][k].push(m[k]));
    }
  }
  const agg = {};
  variants.forEach((v) => { agg[v.key] = {}; metricKeys.forEach((k) => { agg[v.key][k] = stats(raw[v.key][k]); }); });
  return { raw: raw, agg: agg, traceStats: traceStats };
}

const t0 = Date.now();
const metricKeys = METRICS.map((m) => m.key).concat(['maxFragments', 'dataBlocks', 'metaBlocks', 'relocations', 'failedTotal']);
const out = {
  aciklama: 'Blok tahsis yöntemleri deneyi: aynı işlem izi her yönteme uygulanır; ölçütler iz sonunda, ret sayıları tüm iz boyunca ölçülür.',
  simCoreVersion: Sim.VERSION,
  parameters: Object.assign({}, PARAMS, {
    prng: 'mulberry32',
    variants: VARIANTS.map((v) => ({ key: v.key, label: v.label, options: v.opts })),
    statistics: 'mean, örneklem standart sapması (n-1), min, max; n = tohum sayısı'
  }),
  metricLabels: METRICS.reduce((o, m) => { o[m.key] = m.label; return o; }, {}),
  trace: {},
  aggregates: {},
  raw: {},
  sensitivity: { description: 'Bitişik tahsis: ilk uygun ve en uygun yerleştirme, aynı izler', aggregates: {}, raw: {}, paired: {} },
  sanityChecks: []
};

for (const u of PARAMS.utilizations) {
  const r = runCell(VARIANTS, u, metricKeys);
  out.aggregates[uKey(u)] = r.agg;
  out.raw[uKey(u)] = r.raw;
  const ts = {};
  ['totalOps', 'phase1Ops', 'creates', 'deletes', 'extends', 'forcedCreates', 'forcedDeletes', 'capacityForced', 'finalRefUtil', 'peakRefUtil', 'finalLiveFiles']
    .forEach((k) => { ts[k] = stats(r.traceStats.map((s) => s[k])); });
  out.trace[uKey(u)] = ts;
  console.log('u = ' + uKey(u) + ' tamamlandı (' + PARAMS.seeds.length + ' tohum × ' + VARIANTS.length + ' yöntem)');
}
for (const u of PARAMS.sensitivityUtilizations) {
  const r = runCell(SENS_VARIANTS, u, metricKeys);
  out.sensitivity.aggregates[uKey(u)] = r.agg;
  out.sensitivity.raw[uKey(u)] = r.raw;
  const paired = {};
  PAIRED_METRICS.forEach((k) => {
    const d = r.raw['best-fit'][k].map((x, i) => x - r.raw['first-fit'][k][i]);
    const s = stats(d);
    paired[k] = { meanDiff: s.mean, sdDiff: s.sd, bestLower: d.filter((x) => x < 0).length, equal: d.filter((x) => x === 0).length, bestHigher: d.filter((x) => x > 0).length };
  });
  out.sensitivity.paired[uKey(u)] = paired;
  console.log('duyarlılık u = ' + uKey(u) + ' tamamlandı');
}

function check(name, ok, detail) {
  out.sanityChecks.push({ name: name, ok: !!ok, detail: detail });
  console.log((ok ? '  [tamam] ' : '  [UYARI] ') + name + ' — ' + detail);
}
console.log('\nKuramsal tutarlılık denetimleri');
(function () {
  const us = PARAMS.utilizations.map(uKey);
  const all = (key, metric, pred) => us.every((u) => out.raw[u][key][metric].every(pred));
  const means = (key, metric) => us.map((u) => fmt(out.aggregates[u][key][metric].mean, 3)).join(' / ');

  check('Bitişik: rastgele erişim maliyeti tam 1,0', all('contiguous', 'randomAccessCost', (x) => x === 1),
    'u = 0,50 / 0,70 / 0,90 için ortalama ' + means('contiguous', 'randomAccessCost'));
  check('Bitişik: dosya başına parça sayısı tam 1', all('contiguous', 'meanFragments', (x) => x === 1),
    'ortalama ' + means('contiguous', 'meanFragments'));
  check('FAT: rastgele erişim maliyeti tam 1,0', all('fat', 'randomAccessCost', (x) => x === 1),
    'ortalama ' + means('fat', 'randomAccessCost'));
  const maxFile = Math.max.apply(null, us.map((u) => Math.max.apply(null, out.raw[u].indexed.maxFragments)));
  const bigData = us.some((u) => out.raw[u].indexed.randomAccessCost.some((x) => x !== 2));
  check('İndeksli: tüm dosyalar tek indeks bloğuna sığdığında rastgele erişim tam 2,0', !bigData,
    'ortalama ' + means('indexed', 'randomAccessCost') + ' (en parçalı dosyada ' + maxFile + ' parça)');
  check('Extent: rastgele erişim 1 ile 2 arasında', all('extent', 'randomAccessCost', (x) => x >= 1 && x <= 2),
    'ortalama ' + means('extent', 'randomAccessCost'));
  check('Bağlı liste: rastgele erişim maliyeti dosya uzunluğuyla büyür (>> 2)', all('linked', 'randomAccessCost', (x) => x > 10),
    'ortalama ' + means('linked', 'randomAccessCost'));
  check('Dış parçalanma kaynaklı ret yalnızca bitişik yöntemde',
    ['linked', 'indexed', 'extent', 'fat'].every((k) => all(k, 'fragFailures', (x) => x === 0)) &&
    out.aggregates['0.90'].contiguous.fragFailures.mean > 0,
    'bitişik: ' + means('contiguous', 'fragFailures') + '; diğerleri: 0');
  check('Extent parça sayısı bitişik (1) ile bağlı liste arasında',
    us.every((u) => out.aggregates[u].extent.meanFragments.mean >= 1 &&
      out.aggregates[u].extent.meanFragments.mean <= out.aggregates[u].linked.meanFragments.mean),
    'extent ' + means('extent', 'meanFragments') + '; bağlı liste ' + means('linked', 'meanFragments'));
  check('Bitişik: sıralı okuma maliyeti / blok tam 1,0', all('contiguous', 'seqCostPerBlock', (x) => x === 1),
    'ortalama ' + means('contiguous', 'seqCostPerBlock'));
  check('Taşıma yalnızca bitişik yöntemde', ['linked', 'indexed', 'extent', 'fat'].every((k) => all(k, 'movedBlocks', (x) => x === 0)),
    'bitişik: ' + us.map((u) => fmt(out.aggregates[u].contiguous.movedBlocks.mean, 1)).join(' / ') + ' blok');
  check('FAT üstveri yükü sabit P/B', all('fat', 'metaOverhead', (x) => x === PARAMS.P / PARAMS.B),
    fmt(100 * PARAMS.P / PARAMS.B, 4) + ' %');
  check('Bağlı liste üstveri yükü = veri bloğu × P / (N × B)',
    us.every((u) => out.raw[u].linked.metaOverhead.every((x, i) => x === out.raw[u].linked.dataBlocks[i] * PARAMS.P / (PARAMS.N * PARAMS.B))),
    'ortalama ' + us.map((u) => fmt(100 * out.aggregates[u].linked.metaOverhead.mean, 4)).join(' / ') + ' %');
  check('İndeksli üstveri = dosya başına 1 indeks bloğu',
    us.every((u) => out.raw[u].indexed.metaBlocks.every((x, i) => x === out.raw[u].indexed.fileCount[i])),
    'indeks bloğu sayısı = canlı dosya sayısı');
  check('İz, referans diskin kapasitesini hiç aşmadı', us.every((u) => out.trace[u].capacityForced.max === 0 && out.trace[u].peakRefUtil.max < 1),
    'en yüksek referans doluluk ' + us.map((u) => fmt(out.trace[u].peakRefUtil.max, 3)).join(' / '));
  const s70 = out.sensitivity.raw['0.70'], s90 = out.sensitivity.raw['0.90'];
  check('Duyarlılık çalışmasındaki ilk uygun sonuçları ana deneyle aynı',
    JSON.stringify(s70['first-fit'].fragFailures) === JSON.stringify(out.raw['0.70'].contiguous.fragFailures) &&
    JSON.stringify(s90['first-fit'].utilization) === JSON.stringify(out.raw['0.90'].contiguous.utilization),
    'aynı tohumlar, aynı izler');
})();

const md = [];
md.push('# Blok tahsis yöntemleri: deney sonuçları');
md.push('');
md.push('Bu dosya `node deney.js` ile üretilmiştir; elle düzenlemeyin. Ham değerler `sonuclar.json` içindedir.');
md.push('');
md.push('## Deney düzeni');
md.push('');
md.push('| Parametre | Değer |');
md.push('|---|---|');
md.push('| Disk | N = ' + PARAMS.N + ' blok, B = ' + PARAMS.B + ' bayt, blok adresi P = ' + PARAMS.P + ' bayt |');
md.push('| Hedef doluluk (u) | ' + PARAMS.utilizations.map((u) => fmt(u, 2)).join('; ') + ' |');
md.push('| Tohumlar | ' + PARAMS.seeds[0] + '–' + PARAMS.seeds[PARAMS.seeds.length - 1] + ' (' + PARAMS.seeds.length + ' bağımsız iz), PRNG: mulberry32 |');
md.push('| Dosya boyutu dağılımı | ' + PARAMS.classes.map((c) => '%' + Math.round(c.p * 100) + ' ' + c.min + '–' + c.max + ' blok').join('; ') + '; son blok içinde rastgele kuyruk |');
md.push('| Aşama 1 | referans doluluk u olana dek yalnızca oluşturma |');
md.push('| Aşama 2 (yaşlandırma) | ' + PARAMS.agingOps + ' işlem: %' + Math.round(PARAMS.mix.create * 100) + ' oluşturma, %' + Math.round(PARAMS.mix.remove * 100) +
  ' silme, %' + Math.round(PARAMS.mix.extend * 100) + ' büyütme (1–' + PARAMS.extendMax + ' blok); referans doluluk u ± ' + fmt(PARAMS.band, 2) + ' dışına çıkınca zorunlu silme / oluşturma |');
md.push('| Ölçüm | durum ölçütleri iz sonunda; ret, taşıma ve atlama sayıları tüm iz boyunca |');
md.push('| Hücre biçimi | ortalama ± örneklem standart sapması (' + PARAMS.seeds.length + ' tohum) |');
md.push('');
md.push('Aynı işlem izi beş sütunun hepsine uygulanır. İz hiçbir yöntemin durumuna bakmaz: referans doluluk, canlı mantıksal dosyaların istenen veri bloklarından (⌈bayt / B⌉) hesaplanır. Bir yöntem bir dosyayı oluşturamadıysa o dosyaya gelen sonraki işlemler o yöntem için atlanır ve sayılır.');
md.push('');
md.push('### İz istatistikleri (yöntemden bağımsız)');
md.push('');
md.push('| u | Toplam işlem | Aşama 1 oluşturma | Oluşturma | Silme | Büyütme | Zorunlu silme | Zorunlu oluşturma | Son referans doluluk | En yüksek referans doluluk |');
md.push('|---|---|---|---|---|---|---|---|---|---|');
for (const u of PARAMS.utilizations) {
  const t = out.trace[uKey(u)];
  md.push('| ' + [fmt(u, 2), fmt(t.totalOps.mean, 1), fmt(t.phase1Ops.mean, 1), fmt(t.creates.mean, 1), fmt(t.deletes.mean, 1), fmt(t.extends.mean, 1),
    fmt(t.forcedDeletes.mean, 1), fmt(t.forcedCreates.mean, 1), fmt(t.finalRefUtil.mean, 3) + ' ± ' + fmt(t.finalRefUtil.sd, 3), fmt(t.peakRefUtil.mean, 3) + ' (en çok ' + fmt(t.peakRefUtil.max, 3) + ')'].join(' | ') + ' |');
}
md.push('');
for (const u of PARAMS.utilizations) {
  md.push('## Hedef doluluk u = ' + fmt(u, 2));
  md.push('');
  md.push('| Ölçüt | ' + VARIANTS.map((v) => v.label).join(' | ') + ' |');
  md.push('|---|' + VARIANTS.map(() => '---:').join('|') + '|');
  for (const m of METRICS) {
    md.push('| ' + m.label + ' | ' + VARIANTS.map((v) => cell(out.aggregates[uKey(u)][v.key][m.key], m)).join(' | ') + ' |');
  }
  md.push('');
}
md.push('## Duyarlılık: bitişik tahsiste ilk uygun ve en uygun');
md.push('');
md.push('Aynı ' + PARAMS.seeds.length + ' iz, yalnızca yerleştirme politikası değişir. İlk uygun sütunları yukarıdaki "Bitişik" sütunlarıyla aynıdır.');
md.push('');
md.push('| Ölçüt | ' + PARAMS.sensitivityUtilizations.map((u) => SENS_VARIANTS.map((v) => v.label + ', u = ' + fmt(u, 2)).join(' | ')).join(' | ') + ' |');
md.push('|---|' + PARAMS.sensitivityUtilizations.map(() => SENS_VARIANTS.map(() => '---:').join('|')).join('|') + '|');
for (const k of SENS_METRICS) {
  const m = METRICS.find((x) => x.key === k);
  md.push('| ' + m.label + ' | ' + PARAMS.sensitivityUtilizations.map((u) => SENS_VARIANTS.map((v) => cell(out.sensitivity.aggregates[uKey(u)][v.key][k], m)).join(' | ')).join(' | ') + ' |');
}
md.push('');
md.push('### Eşleştirilmiş fark (en uygun − ilk uygun, aynı iz)');
md.push('');
md.push('Hücre: farkın ortalaması ± standart sapması; parantez içinde en uygunun daha düşük / eşit / daha yüksek çıktığı tohum sayısı.');
md.push('');
md.push('| Ölçüt | ' + PARAMS.sensitivityUtilizations.map((u) => 'u = ' + fmt(u, 2)).join(' | ') + ' |');
md.push('|---|' + PARAMS.sensitivityUtilizations.map(() => '---:').join('|') + '|');
for (const k of PAIRED_METRICS) {
  md.push('| ' + PAIRED_LABELS[k] + ' | ' + PARAMS.sensitivityUtilizations.map((u) => {
    const p = out.sensitivity.paired[uKey(u)][k];
    const sign = p.meanDiff > 0 ? '+' : (p.meanDiff < 0 ? '−' : '');
    return sign + fmt(Math.abs(p.meanDiff), PAIRED_DECIMALS[k]) + ' ± ' + fmt(p.sdDiff, PAIRED_DECIMALS[k]) + ' (' + p.bestLower + ' / ' + p.equal + ' / ' + p.bestHigher + ')';
  }).join(' | ') + ' |');
}
md.push('');
md.push('## Kuramsal tutarlılık denetimleri');
md.push('');
md.push('| Denetim | Sonuç | Ayrıntı |');
md.push('|---|---|---|');
for (const c of out.sanityChecks) md.push('| ' + c.name + ' | ' + (c.ok ? 'tamam' : 'UYARI') + ' | ' + c.detail + ' |');
md.push('');
md.push('## Ölçüt tanımları');
md.push('');
md.push('- **Doluluk**: (veri + üstveri blokları) / N.');
md.push('- **Dış parçalanma indeksi**: 1 − en büyük boşluk / toplam boş blok (boş alan yoksa 0).');
md.push('- **Parça sayısı**: dosyanın veri bloklarının mantıksal sıradaki azami ardışık koşu sayısı.');
md.push('- **Sıralı okuma maliyeti**: dosyayı baştan sona okumak için disk okuması + konumlanma sayısı; okunan blok bir önceki okunan blok + 1 değilse bir konumlanma sayılır, üstveri okumaları yola dahildir, ilk konumlanma sayılmaz. "/ veri bloğu" satırı tüm dosyalar üzerinden havuzlanmış orandır (ideal değer 1).');
md.push('- **Rastgele erişim maliyeti**: tüm dosyaların tüm mantıksal blokları üzerinden ortalama erişim yolu uzunluğu (disk okuması).');
md.push('- **Üstveri yükü**: (üstveri blokları × B + veri blokları içindeki işaretçi baytları [+ FAT için N × P]) / (N × B).');
md.push('- **İç parçalanma**: ayrılan veri bloklarındaki kullanılmayan yük baytları / (N × B).');
md.push('- **Dış parçalanma kaynaklı ret**: gereken blok sayısı kadar boş blok bulunduğu halde yöntemin kuralı sağlanamadığı için reddedilen istek.');
md.push('');

fs.writeFileSync(path.join(__dirname, 'sonuclar.json'), JSON.stringify(out, null, 1) + '\n', 'utf8');
fs.writeFileSync(path.join(__dirname, 'sonuclar.md'), md.join('\n'), 'utf8');
const bad = out.sanityChecks.filter((c) => !c.ok).length;
console.log('\nsonuclar.json ve sonuclar.md yazıldı (' + ((Date.now() - t0) / 1000).toFixed(1) + ' sn). ' +
  (bad ? bad + ' denetim UYARI verdi; ayrıntılar yukarıda.' : 'Tüm denetimler tamam.'));
