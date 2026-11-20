'use strict';
const assert = require('assert');
const Sim = require('./sim-core.js');

const B = 4096, P = 4;
let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    failures.push(name);
    console.log('  HATA ' + name + '\n       ' + (e && e.message ? e.message.split('\n').join('\n       ') : e));
  }
}
function mk(method, N, extra) {
  return Sim.createAllocator(Object.assign({ method: method, N: N, B: B, P: P }, extra || {}));
}
const blk = (n) => n * B;

console.log('sim-core ' + Sim.VERSION + ' testleri');

console.log('\nGenel');
test('UMD dışa aktarımı ve dört yöntem', () => {
  assert.deepStrictEqual(Sim.METHODS, ['contiguous', 'linked', 'indexed', 'extent']);
  for (const m of Sim.METHODS) {
    const a = mk(m, 32);
    for (const fn of ['create', 'remove', 'extend', 'blocksOf', 'metaBlocksOf', 'accessPath', 'metrics']) {
      assert.strictEqual(typeof a[fn], 'function', m + '.' + fn);
    }
  }
  assert.throws(() => mk('olmayan', 8));
});

test('mulberry32 deterministik ve [0,1) aralığında', () => {
  const a = Sim.mulberry32(42), b = Sim.mulberry32(42), c = Sim.mulberry32(43);
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < 1000; i++) { xs.push(a()); ys.push(b()); zs.push(c()); }
  assert.deepStrictEqual(xs, ys);
  assert.notDeepStrictEqual(xs, zs);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(Math.abs(mean - 0.5) < 0.05, 'ortalama ' + mean);
});

test('geçersiz ve yinelenen istekler durumu değiştirmez', () => {
  for (const m of Sim.VARIANT_KEYS) {
    const a = mk(m, 16);
    assert.strictEqual(a.create('A', 0).reason, 'gecersiz');
    assert.strictEqual(a.create('A', 1.5).reason, 'gecersiz');
    assert.ok(a.create('A', 1).ok);
    assert.strictEqual(a.create('A', 1).reason, 'ad-kullanimda');
    assert.strictEqual(a.extend('Z', 1).reason, 'dosya-yok');
    assert.strictEqual(a.remove('Z').reason, 'dosya-yok');
    assert.strictEqual(a.metrics().failedTotal, 0, 'kullanım hataları ret sayılmaz');
    assert.deepStrictEqual(a.checkInvariants(), []);
  }
});

console.log('\nBitişik');
test('ilk uygun yerleştirme (elle hesap)', () => {
  const a = mk('contiguous', 16);
  assert.deepStrictEqual(a.create('A', blk(3)).allocated, [0, 1, 2]);
  assert.deepStrictEqual(a.create('B', blk(2)).allocated, [3, 4]);
  assert.deepStrictEqual(a.create('C', blk(4)).allocated, [5, 6, 7, 8]);
  a.remove('B');
  assert.deepStrictEqual(a.freeRuns(), [[3, 2], [9, 7]]);
  assert.deepStrictEqual(a.create('D', 1).allocated, [3]);
  assert.deepStrictEqual(a.create('E', blk(2)).allocated, [9, 10]);
  assert.deepStrictEqual(a.blocksOf('C'), [5, 6, 7, 8]);
  assert.deepStrictEqual(a.metaBlocksOf('C'), []);
  assert.deepStrictEqual(a.accessPath('C', 2), [7]);
  assert.throws(() => a.accessPath('C', 4), RangeError);
});

test('bayt -> blok yuvarlaması', () => {
  const a = mk('contiguous', 16);
  assert.strictEqual(a.create('a', 4096).allocated.length, 1);
  assert.strictEqual(a.create('b', 4097).allocated.length, 2);
  assert.strictEqual(a.create('c', 1).allocated.length, 1);
});

test('en uygun ile ilk uygun farklı boşluk seçer', () => {
  const build = (policy) => {
    const a = mk('contiguous', 16, { policy: policy });
    a.create('p1', blk(5)); a.create('s1', blk(1)); a.create('p2', blk(2)); a.create('s2', blk(1));
    a.remove('p1'); a.remove('p2');
    return a;
  };
  const ff = build('first-fit'), bf = build('best-fit');
  assert.deepStrictEqual(ff.freeRuns(), [[0, 5], [6, 2], [9, 7]]);
  assert.deepStrictEqual(ff.create('X', blk(2)).allocated, [0, 1]);
  assert.deepStrictEqual(bf.create('X', blk(2)).allocated, [6, 7]);
  assert.deepStrictEqual(ff.create('Y', blk(5)).allocated, [9, 10, 11, 12, 13]);
  assert.deepStrictEqual(bf.create('Y', blk(5)).allocated, [0, 1, 2, 3, 4]);
});

test('büyütme: yerinde büyüme, taşıma ve taşınan blok sayısı', () => {
  const a = mk('contiguous', 16);
  a.create('A', blk(3));
  let r = a.extend('A', blk(2));
  assert.ok(r.ok); assert.strictEqual(r.moved, 0);
  assert.deepStrictEqual(a.blocksOf('A'), [0, 1, 2, 3, 4]);
  a.create('B', blk(2));
  r = a.extend('A', blk(1));
  assert.ok(r.ok); assert.ok(r.relocated); assert.strictEqual(r.moved, 5);
  assert.deepStrictEqual(a.blocksOf('A'), [7, 8, 9, 10, 11, 12]);
  assert.deepStrictEqual(a.freeRuns(), [[0, 5], [13, 3]]);
  assert.strictEqual(a.metrics().movedBlocks, 5);
  const c = mk('contiguous', 8);
  c.create('A', 100);
  r = c.extend('A', 3996);
  assert.ok(r.ok); assert.strictEqual(r.allocated.length, 0); assert.strictEqual(c.sizeOf('A'), 4096);
  r = c.extend('A', 1);
  assert.deepStrictEqual(r.allocated, [1]);
});

test('dış parçalanma kaynaklı ret ayrı sayılır', () => {
  const a = mk('contiguous', 8);
  for (let i = 0; i < 8; i++) a.create('f' + i, blk(1));
  a.remove('f1'); a.remove('f3'); a.remove('f5');
  let r = a.create('X', blk(2));
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'parcalanma'); assert.strictEqual(r.fragCaused, true);
  r = a.create('Y', blk(4));
  assert.strictEqual(r.reason, 'yer-yok'); assert.strictEqual(r.fragCaused, false);
  r = a.extend('f6', blk(1));
  assert.strictEqual(r.reason, 'parcalanma');
  const m = a.metrics();
  assert.strictEqual(m.failedCreates, 2); assert.strictEqual(m.failedExtends, 1);
  assert.strictEqual(m.fragFailures, 2); assert.strictEqual(m.noSpaceFailures, 1);
  assert.strictEqual(m.fragFailedCreates, 1); assert.strictEqual(m.fragFailedExtends, 1);
  assert.deepStrictEqual(a.blocksOf('f6'), [6], 'reddedilen büyütme dosyayı değiştirmez');
  assert.deepStrictEqual(a.checkInvariants(), []);
});

console.log('\nBağlı liste ve FAT');
test('blok başına veri alanı B-P: 4092 bayt 1 blok, 4093 bayt 2 blok', () => {
  const a = mk('linked', 16);
  assert.strictEqual(a.payload, 4092);
  assert.strictEqual(a.create('a', 4092).allocated.length, 1);
  assert.strictEqual(a.create('b', 4093).allocated.length, 2);
  assert.strictEqual(a.create('c', blk(5)).allocated.length, 6);
});

test('en düşük numaralı boş bloklar ve erişim yolu i+1 okuma', () => {
  const a = mk('linked', 16);
  a.create('A', 4092 * 2);
  a.create('B', 4092 * 2);
  a.create('C', 4092 * 1);
  a.remove('B');
  const r = a.create('D', 4092 * 4);
  assert.deepStrictEqual(r.allocated, [2, 3, 5, 6]);
  assert.deepStrictEqual(a.blocksOf('D'), [2, 3, 5, 6]);
  assert.deepStrictEqual(a.accessPath('D', 0), [2]);
  assert.deepStrictEqual(a.accessPath('D', 3), [2, 3, 5, 6]);
  const s = a.structureOf('D');
  assert.strictEqual(s.first, 2); assert.strictEqual(s.last, 6);
  assert.deepStrictEqual(s.chain.map((c) => c.next), [3, 5, 6, null]);
  assert.strictEqual(a.fragmentsOf('D'), 2);
  assert.deepStrictEqual(a.seqCost('D'), { reads: 4, seeks: 1, seekDistance: 2, cost: 5 });
  a.extend('A', 4092);
  assert.deepStrictEqual(a.blocksOf('A'), [0, 1, 7]);
});

test('bağlı liste asla parçalanma yüzünden reddetmez; yalnızca yer yoksa', () => {
  const a = mk('linked', 8);
  for (let i = 0; i < 8; i++) a.create('f' + i, 4092);
  a.remove('f1'); a.remove('f3'); a.remove('f5');
  assert.ok(a.create('X', 4092 * 3).ok);
  assert.deepStrictEqual(a.blocksOf('X'), [1, 3, 5]);
  const r = a.create('Y', 1);
  assert.strictEqual(r.reason, 'yer-yok');
  assert.strictEqual(a.metrics().fragFailures, 0);
});

test('üstveri: blok içi işaretçiler P bayt/blok', () => {
  const a = mk('linked', 100);
  a.create('A', 4092 * 10);
  const m = a.metrics();
  assert.strictEqual(m.pointerBytes, 40);
  assert.strictEqual(m.metaBlocks, 0);
  assert.strictEqual(m.metaOverhead, 40 / (100 * 4096));
  assert.strictEqual(m.randomAccessCost, 5.5);
});

test('FAT çeşitlemesi: veri alanı B, erişim 1 okuma, tablo N*P bayt', () => {
  const a = mk('linked', 64, { fat: true });
  assert.strictEqual(a.key, 'fat');
  assert.strictEqual(a.create('A', blk(5)).allocated.length, 5);
  assert.deepStrictEqual(a.accessPath('A', 4), [4]);
  const m = a.metrics();
  assert.strictEqual(m.randomAccessCost, 1);
  assert.strictEqual(m.metaBytes, 64 * 4);
  assert.strictEqual(m.metaOverhead, (64 * 4) / (64 * 4096));
  assert.strictEqual(mk('fat', 8).fat, true);
});

console.log('\nİndeksli');
test('indeks bloğu önce, veri blokları en düşük boşlardan; erişim 2 okuma', () => {
  const a = mk('indexed', 16);
  let r = a.create('A', blk(3));
  assert.deepStrictEqual(r.metaAllocated, [0]);
  assert.deepStrictEqual(r.allocated, [1, 2, 3]);
  a.create('B', blk(2));
  a.remove('A');
  r = a.create('C', blk(5));
  assert.deepStrictEqual(a.metaBlocksOf('C'), [0]);
  assert.deepStrictEqual(a.blocksOf('C'), [1, 2, 3, 7, 8]);
  assert.deepStrictEqual(a.accessPath('C', 4), [0, 8]);
  assert.deepStrictEqual(a.seqPath('C'), [0, 1, 2, 3, 7, 8]);
  assert.deepStrictEqual(a.seqCost('C'), { reads: 6, seeks: 1, seekDistance: 4, cost: 7 });
  const m = a.metrics();
  assert.strictEqual(m.randomAccessCost, 2);
  assert.strictEqual(m.metaBlocks, 2);
  assert.strictEqual(m.metaOverhead, 2 / 16);
});

test('üstveri yüzünden ret: veri sığar, indeks bloğu sığmaz', () => {
  const a = mk('indexed', 4);
  const r = a.create('A', blk(4));
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'ustveri'); assert.strictEqual(r.fragCaused, false);
  assert.strictEqual(a.create('B', blk(5)).reason, 'yer-yok');
  assert.ok(a.create('C', blk(3)).ok);
  assert.strictEqual(a.metrics().fragFailures, 0);
  assert.strictEqual(a.metrics().metaFailures, 1);
});

test('zincirli indeks blokları: sınır değerleri kesin', () => {
  const a = mk('indexed', 4096);
  assert.strictEqual(a.K, 1024);
  assert.strictEqual(a.indexBlocksFor(1), 1);
  assert.strictEqual(a.indexBlocksFor(1024), 1);
  assert.strictEqual(a.indexBlocksFor(1025), 2);
  assert.strictEqual(a.indexBlocksFor(2047), 2);
  assert.strictEqual(a.indexBlocksFor(2048), 3);
  a.create('A', blk(1024));
  assert.strictEqual(a.metaBlocksOf('A').length, 1);
  assert.strictEqual(a.accessPath('A', 1023).length, 2);
  const r = a.extend('A', blk(1));
  assert.strictEqual(r.metaAllocated.length, 1);
  const meta = a.metaBlocksOf('A'), data = a.blocksOf('A');
  assert.strictEqual(meta.length, 2);
  assert.deepStrictEqual(a.accessPath('A', 0), [meta[0], data[0]]);
  assert.deepStrictEqual(a.accessPath('A', 1022), [meta[0], data[1022]]);
  assert.deepStrictEqual(a.accessPath('A', 1023), [meta[0], meta[1], data[1023]]);
  assert.deepStrictEqual(a.accessPath('A', 1024), [meta[0], meta[1], data[1024]]);
  const s = a.structureOf('A');
  assert.strictEqual(s.indexBlocks[0].entries.length, 1023);
  assert.strictEqual(s.indexBlocks[0].next, meta[1]);
  assert.strictEqual(s.indexBlocks[1].entries.length, 2);
  assert.strictEqual(a.seqPath('A').length, 1025 + 2);
  assert.strictEqual(a.metrics().randomAccessCost, (1023 * 2 + 2 * 3) / 1025);
  assert.deepStrictEqual(a.checkInvariants(), []);
  const b = mk('indexed', 4096);
  b.create('B', blk(2048));
  assert.strictEqual(b.metaBlocksOf('B').length, 3);
  assert.strictEqual(b.accessPath('B', 2047).length, 4);
  assert.strictEqual(b.accessPath('B', 2045).length, 3);
  assert.deepStrictEqual(b.checkInvariants(), []);
});

console.log('\nExtent');
test('tek boşluk yeterliyse ilk uygun tek extent', () => {
  const a = mk('extent', 32);
  a.create('A', blk(4)); a.create('B', blk(3)); a.create('C', blk(5));
  a.remove('B');
  let r = a.create('D', blk(2));
  assert.deepStrictEqual(r.allocated, [4, 5]);
  assert.deepStrictEqual(a.structureOf('D').extents, [{ start: 4, length: 2, logicalStart: 0 }]);
  r = a.create('E', blk(6));
  assert.deepStrictEqual(a.structureOf('E').extents, [{ start: 12, length: 6, logicalStart: 0 }]);
  assert.deepStrictEqual(a.accessPath('E', 5), [17]);
  assert.deepStrictEqual(a.metaBlocksOf('E'), []);
});

test('tek boşluk yoksa en büyük boşluklar sırayla alınır', () => {
  const a = mk('extent', 16);
  a.create('A', blk(1)); a.create('g1', blk(2)); a.create('B', blk(1)); a.create('g2', blk(5));
  a.create('C', blk(1)); a.create('g3', blk(3)); a.create('D', blk(1)); a.create('g4', blk(2));
  ['g1', 'g2', 'g3', 'g4'].forEach((g) => a.remove(g));
  assert.deepStrictEqual(a.freeRuns(), [[1, 2], [4, 5], [10, 3], [14, 2]]);
  const r = a.create('X', blk(9));
  assert.ok(r.ok);
  assert.deepStrictEqual(a.structureOf('X').extents.map((e) => [e.start, e.length]), [[4, 5], [10, 3], [1, 1]]);
  assert.deepStrictEqual(a.blocksOf('X'), [4, 5, 6, 7, 8, 10, 11, 12, 1]);
  assert.strictEqual(a.fragmentsOf('X'), 3);
  assert.deepStrictEqual(a.seqCost('X'), { reads: 9, seeks: 2, seekDistance: 2 + 11, cost: 11 });
  assert.strictEqual(a.metrics().fragFailures, 0);
  assert.deepStrictEqual(a.checkInvariants(), []);
});

test('büyütme: önce son extent yerinde büyür, kalan yeni extent olur', () => {
  const a = mk('extent', 16);
  a.create('A', blk(3));
  a.create('B', blk(2));
  a.create('C', blk(2));
  a.remove('B');
  let r = a.extend('A', blk(1));
  assert.deepStrictEqual(r.allocated, [3]);
  assert.deepStrictEqual(a.structureOf('A').extents.map((e) => [e.start, e.length]), [[0, 4]]);
  r = a.extend('A', blk(4));
  assert.deepStrictEqual(r.allocated, [4, 7, 8, 9]);
  assert.deepStrictEqual(a.structureOf('A').extents.map((e) => [e.start, e.length]), [[0, 5], [7, 3]]);
  r = a.extend('C', blk(1));
  assert.deepStrictEqual(a.structureOf('C').extents.map((e) => [e.start, e.length]), [[5, 2], [10, 1]]);
  assert.deepStrictEqual(a.checkInvariants(), []);
});

test('4 extent inode içinde; 5. extent ile ağaç bloğu ve 2 okuma', () => {
  const a = mk('extent', 32);
  for (let i = 0; i < 20; i++) a.create('t' + i, blk(1));
  a.create('fill', blk(12));
  for (let i = 1; i < 8; i += 2) a.remove('t' + i);
  let r = a.create('X', blk(4));
  assert.deepStrictEqual(a.blocksOf('X'), [1, 3, 5, 7]);
  assert.deepStrictEqual(a.metaBlocksOf('X'), []);
  assert.deepStrictEqual(a.accessPath('X', 3), [7]);
  assert.strictEqual(a.metrics().metaBlocks, 0);
  for (let i = 9; i < 14; i += 2) a.remove('t' + i);
  r = a.extend('X', blk(1));
  assert.ok(r.ok);
  assert.deepStrictEqual(r.allocated, [9]);
  assert.deepStrictEqual(r.metaAllocated, [11]);
  assert.deepStrictEqual(a.metaBlocksOf('X'), [11]);
  assert.deepStrictEqual(a.accessPath('X', 0), [11, 1]);
  assert.deepStrictEqual(a.accessPath('X', 4), [11, 9]);
  assert.deepStrictEqual(a.seqPath('X'), [11, 1, 3, 5, 7, 9]);
  assert.strictEqual(a.metrics().randomAccessCost > 1, true);
  assert.ok(a.extend('X', blk(1)).ok);
  assert.strictEqual(a.extend('X', blk(1)).reason, 'yer-yok');
  assert.deepStrictEqual(a.checkInvariants(), []);
});

test('ağaç bloğuna yer yoksa üstveri reddi', () => {
  const a = mk('extent', 10);
  for (let i = 0; i < 10; i++) a.create('t' + i, blk(1));
  for (let i = 1; i < 10; i += 2) a.remove('t' + i);
  const r = a.create('X', blk(5));
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'ustveri');
  assert.strictEqual(a.freeCount, 5, 'reddedilen istek blok ayırmaz');
  assert.ok(a.create('Y', blk(4)).ok);
  assert.strictEqual(a.metrics().fragFailures, 0);
});

test('iki düzeyli extent ağacı (küçük yayılımla)', () => {
  const a = mk('extent', 128, { extentsPerTreeBlock: 3 });
  for (let i = 0; i < 60; i++) a.create('t' + i, blk(1));
  for (let i = 1; i < 40; i += 2) a.remove('t' + i);
  a.create('fill', blk(60));
  let total = 0;
  a.create('X', blk(1)); total++;
  for (let k = 0; k < 14; k++) { assert.ok(a.extend('X', blk(1)).ok); total++; }
  assert.deepStrictEqual(a.checkInvariants(), []);
  const s = a.structureOf('X');
  assert.ok(s.extents.length > 12, 'extent sayısı ' + s.extents.length);
  assert.strictEqual(s.leaves.length, Math.ceil(s.extents.length / 3));
  assert.strictEqual(s.nodes.length, Math.ceil(s.leaves.length / 3));
  const p = a.accessPath('X', a.blocksOf('X').length - 1);
  assert.strictEqual(p.length, 3);
  assert.strictEqual(p[0], s.nodes[s.nodes.length - 1]);
  assert.strictEqual(a.seqPath('X').length, a.blocksOf('X').length + s.leaves.length + s.nodes.length);
});

console.log('\nÖlçütler');
test('dış parçalanma indeksi ve boşluk ölçütleri (elle hesap)', () => {
  const a = mk('contiguous', 20);
  a.create('A', blk(4)); a.create('B', blk(2)); a.create('C', blk(4)); a.create('D', blk(3));
  a.remove('B');
  const m = a.metrics();
  assert.strictEqual(m.usedBlocks, 11);
  assert.strictEqual(m.utilization, 11 / 20);
  assert.strictEqual(m.freeRuns, 2);
  assert.strictEqual(m.largestFreeRun, 7);
  assert.strictEqual(m.extFragIndex, 1 - 7 / 9);
  assert.strictEqual(m.meanFragments, 1);
  assert.strictEqual(m.randomAccessCost, 1);
  assert.strictEqual(m.seqCostPerBlock, 1);
  assert.strictEqual(m.metaOverhead, 0);
});

test('boş alan yokken dış parçalanma indeksi 0', () => {
  const a = mk('contiguous', 4);
  a.create('A', blk(4));
  assert.strictEqual(a.metrics().extFragIndex, 0);
  assert.strictEqual(mk('contiguous', 4).metrics().extFragIndex, 0);
});

test('_pathLen her zaman accessPath uzunluğuna eşit; rastgele erişim ortalaması tanıma uygun', () => {
  for (const key of Sim.VARIANT_KEYS) {
    const a = mk(key, 512, { log: false });
    Sim.runTrace(a, Sim.generateTrace(Object.assign({ N: 512, u: 0.8, seed: 7 }, Sim.workloadPreset(512))));
    let sum = 0, cnt = 0;
    for (const id of a.fileIds()) {
      const n = a.blocksOf(id).length;
      for (let i = 0; i < n; i++) { sum += a.accessPath(id, i).length; cnt++; }
    }
    assert.ok(cnt > 0);
    assert.ok(Math.abs(a.metrics().randomAccessCost - sum / cnt) < 1e-12, key);
  }
});

console.log('\nİz üreteci ve değişmezler');
test('iz deterministik, tohuma bağlı ve yöntemden bağımsız', () => {
  const o = { N: 8192, u: 0.7, seed: 5 };
  const t1 = Sim.generateTrace(o), t2 = Sim.generateTrace(o), t3 = Sim.generateTrace({ N: 8192, u: 0.7, seed: 6 });
  assert.deepStrictEqual(t1, t2);
  assert.notDeepStrictEqual(t1.ops, t3.ops);
  assert.strictEqual(t1.ops.length, t1.stats.phase1Ops + 5000);
  assert.strictEqual(t1.stats.capacityForced, 0);
});

test('referans doluluk: aşama 1 sonunda tam hedef, sonra denetleyici bandında', () => {
  for (const u of [0.5, 0.7, 0.9]) {
    const N = 8192, t = Sim.generateTrace({ N: N, u: u, seed: 11 });
    const size = new Map();
    let ref = 0, maxRef = 0, minRef = N, i = 0;
    for (const op of t.ops) {
      if (op.op === 'create') { size.set(op.id, op.bytes); ref += Math.ceil(op.bytes / B); }
      else if (op.op === 'delete') { ref -= Math.ceil(size.get(op.id) / B); size.delete(op.id); }
      else { const o = size.get(op.id); ref += Math.ceil((o + op.bytes) / B) - Math.ceil(o / B); size.set(op.id, o + op.bytes); }
      i++;
      if (i === t.stats.phase1Ops) assert.strictEqual(ref, Math.round(u * N), 'aşama 1 sonu');
      if (i > t.stats.phase1Ops) { maxRef = Math.max(maxRef, ref); minRef = Math.min(minRef, ref); }
    }
    assert.ok(maxRef <= (u + 0.05) * N + 400, 'üst sınır ' + maxRef / N);
    assert.ok(minRef >= (u - 0.05) * N - 400, 'alt sınır ' + minRef / N);
    assert.ok(maxRef < N);
    assert.strictEqual(ref / N, t.stats.finalRefUtil);
  }
});

test('boyut dağılımı yaklaşık %70 / %25 / %5', () => {
  const t = Sim.generateTrace({ N: 8192, u: 0.7, seed: 3, agingOps: 20000 });
  let s = 0, m = 0, l = 0, n = 0;
  for (const op of t.ops) {
    if (op.op !== 'create' || op.phase !== 2) continue;
    const k = Math.ceil(op.bytes / B);
    n++;
    if (k <= 8) s++; else if (k <= 64) m++; else l++;
    assert.ok(k >= 1 && k <= 400);
  }
  assert.ok(Math.abs(s / n - 0.70) < 0.03, 'küçük ' + s / n);
  assert.ok(Math.abs(m / n - 0.25) < 0.03, 'orta ' + m / n);
  assert.ok(Math.abs(l / n - 0.05) < 0.02, 'büyük ' + l / n);
});

test('her işlemden sonra değişmezler korunur (5 yöntem çeşidi + en uygun, 6 tohum)', () => {
  const variants = Sim.VARIANT_KEYS.map((k) => ({ method: k })).concat([{ method: 'contiguous', policy: 'best-fit' }]);
  for (const v of variants) {
    for (let seed = 1; seed <= 6; seed++) {
      const N = 128;
      const a = mk(v.method, N, { policy: v.policy, log: seed % 2 === 0 });
      const t = Sim.generateTrace(Object.assign({ N: N, u: 0.85, seed: seed }, Sim.workloadPreset(N), { agingOps: 250 }));
      for (const op of t.ops) {
        const before = a.freeCount;
        const r = Sim.applyOp(a, op);
        if (!r.ok) assert.strictEqual(a.freeCount, before, 'başarısız işlem durumu değiştirmemeli');
        const errs = a.checkInvariants();
        assert.deepStrictEqual(errs, [], v.method + ' tohum ' + seed + ': ' + errs.join('; '));
        const m = a.metrics();
        assert.ok(m.utilization >= 0 && m.utilization <= 1);
        assert.ok(m.extFragIndex >= 0 && m.extFragIndex < 1);
        assert.strictEqual(m.usedBlocks, m.dataBlocks + m.metaBlocks);
        if (v.method !== 'contiguous') assert.strictEqual(m.fragFailures, 0, v.method + ' parçalanma reddi üretmemeli');
        if (v.method === 'contiguous') { assert.strictEqual(m.randomAccessCost === 0 || m.randomAccessCost === 1, true); assert.ok(m.meanFragments <= 1); }
      }
      for (const id of a.fileIds()) assert.ok(a.remove(id).ok);
      assert.strictEqual(a.freeCount, N);
      assert.deepStrictEqual(a.freeRuns(), [[0, N]]);
    }
  }
});

test('günlük açık/kapalı sonucu değiştirmez; satırlar Türkçe metin', () => {
  for (const key of Sim.VARIANT_KEYS) {
    const N = 256;
    const t = Sim.generateTrace(Object.assign({ N: N, u: 0.9, seed: 9 }, Sim.workloadPreset(N)));
    const a = mk(key, N, { log: true }), b = mk(key, N, { log: false });
    let lines = 0;
    for (const op of t.ops) {
      const ra = Sim.applyOp(a, op), rb = Sim.applyOp(b, op);
      assert.strictEqual(ra.ok, rb.ok);
      assert.strictEqual(rb.log.length, 0);
      assert.ok(ra.log.length >= 1, 'her işlem en az bir günlük satırı üretir');
      ra.log.forEach((s) => { assert.strictEqual(typeof s, 'string'); assert.ok(s.length > 10); });
      lines += ra.log.length;
    }
    assert.deepStrictEqual(a.metrics(), b.metrics());
    assert.ok(lines > t.ops.length);
  }
});

test('yüksek dolulukta parçalanma reddi yalnızca bitişik yöntemde', () => {
  const N = 1024, res = {};
  const t = Sim.generateTrace(Object.assign({ N: N, u: 0.9, seed: 2 }, Sim.workloadPreset(N), { agingOps: 2000 }));
  for (const key of Sim.VARIANT_KEYS) {
    const a = mk(key, N, { log: false });
    Sim.runTrace(a, t);
    res[key] = a.metrics();
  }
  assert.ok(res.contiguous.fragFailures > 0);
  for (const key of ['linked', 'indexed', 'extent', 'fat']) assert.strictEqual(res[key].fragFailures, 0, key);
  assert.strictEqual(res.contiguous.randomAccessCost, 1);
  assert.strictEqual(res.fat.randomAccessCost, 1);
  assert.strictEqual(res.indexed.randomAccessCost, 2);
  assert.ok(res.linked.randomAccessCost > 2);
  assert.strictEqual(res.contiguous.meanFragments, 1);
  assert.ok(res.extent.meanFragments >= 1 && res.extent.meanFragments <= res.linked.meanFragments);
});

console.log('\n' + passed + ' test geçti, ' + failures.length + ' test başarısız.');
if (failures.length) {
  console.log('Başarısız: ' + failures.join(' | '));
  process.exit(1);
}
