'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Sim = require('./sim-core.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  HATA ' + name + '\n       ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n       ')); }
}
function near(a, b, msg) {
  const tol = 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  if (!(Math.abs(a - b) <= tol)) throw new Error((msg || 'değer') + ': beklenen ' + b + ', bulunan ' + a);
}

class Ref {
  constructor(o) {
    this.method = o.method; this.fat = !!o.fat; this.policy = o.policy || 'first-fit';
    this.N = o.N; this.B = o.B; this.P = o.P; this.K = o.B / o.P;
    this.inodeExtents = o.inodeExtents == null ? 4 : o.inodeExtents;
    this.fanout = o.fanout == null ? 340 : o.fanout;
    this.disk = new Array(o.N).fill(null);
    this.files = new Map();
    this.moved = 0; this.skipped = 0;
    this.failCreate = 0; this.failExtend = 0;
    this.byReason = { 'yer-yok': 0, 'ustveri': 0, 'parcalanma': 0 };
  }
  payload() { return this.method === 'linked' && !this.fat ? this.B - this.P : this.B; }
  freeCount() { let c = 0; for (let i = 0; i < this.N; i++) if (this.disk[i] === null) c++; return c; }
  static runsOf(isFree, N) {
    const out = []; let i = 0;
    while (i < N) {
      if (!isFree(i)) { i++; continue; }
      let j = i; while (j < N && isFree(j)) j++;
      out.push({ start: i, len: j - i }); i = j;
    }
    return out;
  }
  runs() { return Ref.runsOf((i) => this.disk[i] === null, this.N); }
  lowestFree() { for (let i = 0; i < this.N; i++) if (this.disk[i] === null) return i; throw new Error('boş blok yok'); }

  create(id, size) {
    if (this.files.has(id)) throw new Error('ref: ad kullanımda');
    const f = { id, size: 0, data: [], meta: [], ext: [], leaves: [], nodes: [] };
    const why = this.grow(f, size);
    if (why) { this.failCreate++; this.byReason[why]++; return why; }
    f.size = size; this.files.set(id, f); return null;
  }
  extend(id, extra) {
    const f = this.files.get(id);
    const why = this.grow(f, f.size + extra);
    if (why) { this.failExtend++; this.byReason[why]++; return why; }
    f.size += extra; return null;
  }
  remove(id) {
    const f = this.files.get(id);
    const all = f.data.concat(f.meta, f.leaves, f.nodes);
    for (const b of all) { assert.strictEqual(this.disk[b], id); this.disk[b] = null; }
    this.files.delete(id);
    return all;
  }
  grow(f, newSize) {
    if (this.method === 'contiguous') return this.growContiguous(f, newSize);
    if (this.method === 'linked') return this.growLinked(f, newSize);
    if (this.method === 'indexed') return this.growIndexed(f, newSize);
    return this.growExtent(f, newSize);
  }

  pickRun(need) {
    const ok = this.runs().filter((r) => r.len >= need);
    if (!ok.length) return null;
    if (this.policy === 'best-fit') {
      let best = ok[0];
      for (const r of ok) if (r.len < best.len) best = r;
      return best;
    }
    return ok[0];
  }
  growContiguous(f, newSize) {
    const need = Math.ceil(newSize / this.B), cur = f.data.length, add = need - cur, free = this.freeCount();
    if (cur === 0) {
      if (need > free) return 'yer-yok';
      const r = this.pickRun(need);
      if (!r) return 'parcalanma';
      for (let i = 0; i < need; i++) { this.disk[r.start + i] = f.id; f.data.push(r.start + i); }
      return null;
    }
    if (add === 0) return null;
    const end = f.data[cur - 1];
    let inPlace = true;
    for (let i = 1; i <= add; i++) if (end + i >= this.N || this.disk[end + i] !== null) inPlace = false;
    if (inPlace) {
      for (let i = 1; i <= add; i++) { this.disk[end + i] = f.id; f.data.push(end + i); }
      return null;
    }
    if (add > free) return 'yer-yok';
    const r = this.pickRun(need);
    if (!r) return 'parcalanma';
    const old = f.data; f.data = [];
    for (let i = 0; i < need; i++) { this.disk[r.start + i] = f.id; f.data.push(r.start + i); }
    for (const b of old) this.disk[b] = null;
    this.moved += cur;
    return null;
  }
  growLinked(f, newSize) {
    const need = Math.ceil(newSize / this.payload()), add = need - f.data.length;
    if (add === 0) return null;
    if (add > this.freeCount()) return 'yer-yok';
    for (let i = 0; i < add; i++) { const b = this.lowestFree(); this.disk[b] = f.id; f.data.push(b); }
    return null;
  }
  idxNeeded(n) {
    let m = 1;
    while (n > (m - 1) * (this.K - 1) + this.K) m++;
    return m;
  }
  growIndexed(f, newSize) {
    const need = Math.ceil(newSize / this.B), cur = f.data.length, add = need - cur, free = this.freeCount();
    if (add === 0) return null;
    const addIdx = this.idxNeeded(need) - f.meta.length;
    if (add > free) return 'yer-yok';
    if (add + addIdx > free) return 'ustveri';
    for (let k = cur; k < need; k++) {
      if (this.idxNeeded(k + 1) > f.meta.length) { const m = this.lowestFree(); this.disk[m] = f.id; f.meta.push(m); }
      const b = this.lowestFree(); this.disk[b] = f.id; f.data.push(b);
    }
    return null;
  }
  treeNeed(e) {
    if (e <= this.inodeExtents) return { leaves: 0, nodes: 0 };
    const leaves = Math.ceil(e / this.fanout);
    return { leaves, nodes: leaves <= this.inodeExtents ? 0 : Math.ceil(leaves / this.fanout) };
  }
  growExtent(f, newSize) {
    const N = this.N;
    const need = Math.ceil(newSize / this.B), cur = f.data.length, add = need - cur, free = this.freeCount();
    if (add === 0) return null;
    if (add > free) return 'yer-yok';
    const tmp = this.disk.map((x) => x === null);
    let rem = add, grown = 0, tail = -1;
    if (cur > 0) {
      const last = f.ext[f.ext.length - 1];
      tail = last.start + last.len;
      while (grown < rem && tail + grown < N && tmp[tail + grown]) { tmp[tail + grown] = false; grown++; }
      rem -= grown;
    }
    const pieces = [];
    if (rem > 0) {
      const single = Ref.runsOf((i) => tmp[i], N).find((r) => r.len >= rem);
      if (single) pieces.push({ start: single.start, len: rem });
      else {
        while (rem > 0) {
          const rs = Ref.runsOf((i) => tmp[i], N);
          let big = rs[0];
          for (const r of rs) if (r.len > big.len) big = r;
          const t = Math.min(big.len, rem);
          for (let i = 0; i < t; i++) tmp[big.start + i] = false;
          pieces.push({ start: big.start, len: t }); rem -= t;
        }
      }
    }
    const tn = this.treeNeed(f.ext.length + pieces.length);
    const addLeaves = tn.leaves - f.leaves.length, addNodes = tn.nodes - f.nodes.length;
    if (add + addLeaves + addNodes > free) return 'ustveri';
    if (grown > 0) {
      for (let i = 0; i < grown; i++) { this.disk[tail + i] = f.id; f.data.push(tail + i); }
      f.ext[f.ext.length - 1].len += grown;
    }
    for (const p of pieces) {
      for (let i = 0; i < p.len; i++) { assert.strictEqual(this.disk[p.start + i], null); this.disk[p.start + i] = f.id; f.data.push(p.start + i); }
      f.ext.push({ start: p.start, len: p.len });
    }
    for (let i = 0; i < addLeaves; i++) { const b = this.lowestFree(); this.disk[b] = f.id; f.leaves.push(b); }
    for (let i = 0; i < addNodes; i++) { const b = this.lowestFree(); this.disk[b] = f.id; f.nodes.push(b); }
    return null;
  }

  metaOf(f) { return f.meta.concat(f.leaves, f.nodes); }
  accessPath(f, i) {
    if (this.method === 'contiguous') return [f.data[i]];
    if (this.method === 'linked') return this.fat ? [f.data[i]] : f.data.slice(0, i + 1);
    if (this.method === 'indexed') {
      let lo = 0;
      for (let j = 0; j < f.meta.length; j++) {
        const cap = j === f.meta.length - 1 ? Infinity : this.K - 1;
        if (i < lo + cap) return f.meta.slice(0, j + 1).concat([f.data[i]]);
        lo += cap;
      }
      throw new Error('ref: indeks aralığı');
    }
    if (f.ext.length <= this.inodeExtents) return [f.data[i]];
    let acc = 0, k = 0;
    for (; k < f.ext.length; k++) { acc += f.ext[k].len; if (i < acc) break; }
    const leaf = Math.floor(k / this.fanout), p = [];
    if (f.nodes.length) p.push(f.nodes[Math.floor(leaf / this.fanout)]);
    p.push(f.leaves[leaf]); p.push(f.data[i]);
    return p;
  }
  seqPath(f) {
    if (this.method === 'contiguous' || this.method === 'linked') return f.data.slice();
    const out = [], seen = new Set();
    for (let i = 0; i < f.data.length; i++) {
      const p = this.accessPath(f, i);
      for (let q = 0; q < p.length - 1; q++) if (!seen.has(p[q])) { seen.add(p[q]); out.push(p[q]); }
      out.push(p[p.length - 1]);
    }
    return out;
  }
  metrics() {
    const N = this.N, B = this.B, runs = this.runs(), free = this.freeCount();
    let largest = 0; for (const r of runs) largest = Math.max(largest, r.len);
    let files = 0, data = 0, meta = 0, fragSum = 0, reads = 0, seeks = 0, dist = 0, ra = 0, slack = 0;
    for (const f of this.files.values()) {
      files++; data += f.data.length; meta += this.metaOf(f).length;
      let fr = f.data.length ? 1 : 0;
      for (let i = 1; i < f.data.length; i++) if (f.data[i] !== f.data[i - 1] + 1) fr++;
      fragSum += fr;
      const sp = this.seqPath(f);
      reads += sp.length;
      for (let i = 1; i < sp.length; i++) if (sp[i] !== sp[i - 1] + 1) { seeks++; dist += Math.abs(sp[i] - sp[i - 1]); }
      for (let i = 0; i < f.data.length; i++) ra += this.accessPath(f, i).length;
      slack += f.data.length * this.payload() - f.size;
    }
    const ptr = this.method === 'linked' && !this.fat ? data * this.P : 0;
    const table = this.fat ? N * this.P : 0;
    return {
      utilization: (N - free) / N, fileCount: files, freeRuns: runs.length, largestFreeRun: largest,
      extFragIndex: free === 0 ? 0 : 1 - largest / free,
      meanFragments: files ? fragSum / files : 0,
      seqCostPerBlock: data ? (reads + seeks) / data : 0,
      seqCostMean: files ? (reads + seeks) / files : 0,
      seqSeeksMean: files ? seeks / files : 0,
      meanSeekDistance: seeks ? dist / seeks : 0,
      randomAccessCost: data ? ra / data : 0,
      metaOverhead: (meta * B + ptr + table) / (N * B),
      internalWaste: slack / (N * B),
      movedBlocks: this.moved, failedCreates: this.failCreate, failedExtends: this.failExtend,
      fragFailures: this.byReason['parcalanma'], noSpaceFailures: this.byReason['yer-yok'],
      metaFailures: this.byReason['ustveri'], skipped: this.skipped,
      dataBlocks: data, metaBlocks: meta
    };
  }
}
const METRIC_KEYS = ['utilization', 'fileCount', 'freeRuns', 'largestFreeRun', 'extFragIndex', 'meanFragments',
  'seqCostPerBlock', 'seqCostMean', 'seqSeeksMean', 'meanSeekDistance', 'randomAccessCost', 'metaOverhead',
  'internalWaste', 'movedBlocks', 'failedCreates', 'failedExtends', 'fragFailures', 'noSpaceFailures', 'metaFailures',
  'skipped', 'dataBlocks', 'metaBlocks'];

const VARIANTS = [
  { key: 'contiguous', method: 'contiguous', policy: 'first-fit' },
  { key: 'linked', method: 'linked' },
  { key: 'indexed', method: 'indexed' },
  { key: 'extent', method: 'extent' },
  { key: 'fat', method: 'linked', fat: true },
  { key: 'best-fit', method: 'contiguous', policy: 'best-fit' }
];
function pair(v, o) {
  const sim = Sim.createAllocator({ method: v.method, fat: v.fat, policy: v.policy, N: o.N, B: o.B, P: o.P,
    inodeExtents: o.inodeExtents, extentsPerTreeBlock: o.fanout, log: !!o.log });
  const ref = new Ref({ method: v.method, fat: v.fat, policy: v.policy, N: o.N, B: o.B, P: o.P, inodeExtents: o.inodeExtents, fanout: o.fanout });
  return { sim, ref };
}
function ownerMap(sim) { const a = []; for (let b = 0; b < sim.N; b++) a.push(sim.ownerOf(b)); return a; }

function checkState(sim, ref, ctx) {
  const N = sim.N, seen = new Array(N).fill(null);
  let used = 0;
  const ids = sim.fileIds();
  assert.deepStrictEqual(ids.slice().sort(), Array.from(ref.files.keys()).sort(), ctx + ': canlı dosya kümesi');
  for (const id of ids) {
    const f = ref.files.get(id);
    const data = sim.blocksOf(id), meta = sim.metaBlocksOf(id);
    assert.deepStrictEqual(data, f.data, ctx + ': ' + id + ' veri blokları');
    assert.deepStrictEqual(meta, ref.metaOf(f), ctx + ': ' + id + ' üstveri blokları');
    assert.strictEqual(sim.sizeOf(id), f.size, ctx + ': ' + id + ' boyut');
    for (const b of data.concat(meta)) {
      assert.ok(Number.isInteger(b) && b >= 0 && b < N, ctx + ': aralık dışı blok ' + b);
      assert.strictEqual(seen[b], null, ctx + ': blok ' + b + ' iki kez sahiplenilmiş (' + seen[b] + ', ' + id + ')');
      seen[b] = id; used++;
    }
  }
  let freeScan = 0;
  for (let b = 0; b < N; b++) {
    const o = sim.ownerOf(b);
    assert.strictEqual(o, seen[b], ctx + ': blok ' + b + ' sahip tablosu');
    if (o === null) freeScan++;
  }
  const m = sim.metrics();
  assert.strictEqual(m.freeBlocks, freeScan, ctx + ': boş blok sayacı');
  assert.strictEqual(m.freeBlocks + used, N, ctx + ': boş + kullanılan = N');
  assert.strictEqual(m.usedBlocks, used, ctx + ': kullanılan blok');
  return m;
}
function checkMetrics(sim, ref, ctx) {
  const m = sim.metrics(), r = ref.metrics();
  for (const k of METRIC_KEYS) near(m[k], r[k], ctx + ': ölçüt ' + k);
}
function checkPaths(sim, ref, id, ctx) {
  const f = ref.files.get(id), data = sim.blocksOf(id);
  for (let i = 0; i < data.length; i++) {
    const p = sim.accessPath(id, i);
    assert.strictEqual(p[p.length - 1], data[i], ctx + ': erişim yolu hedef blokta bitmiyor');
    assert.deepStrictEqual(p, ref.accessPath(f, i), ctx + ': ' + id + ' erişim yolu i=' + i);
  }
  const sc = sim.seqCost(id), sp = ref.seqPath(f);
  let seeks = 0; for (let i = 1; i < sp.length; i++) if (sp[i] !== sp[i - 1] + 1) seeks++;
  assert.strictEqual(sc.reads, sp.length, ctx + ': sıralı okuma sayısı');
  assert.strictEqual(sc.seeks, seeks, ctx + ': konumlanma sayısı');
  assert.strictEqual(sc.cost, sp.length + seeks, ctx + ': sıralı maliyet');
}

function step(sim, ref, op, ctx, deep) {
  if (op.op === 'create') {
    const before = deep ? ownerMap(sim) : null;
    const r = sim.create(op.id, op.bytes), why = ref.create(op.id, op.bytes);
    assert.strictEqual(r.ok, why === null, ctx + ': oluşturma sonucu (ref: ' + why + ', sim: ' + r.reason + ')');
    if (why) {
      assert.strictEqual(r.reason, why, ctx + ': ret nedeni');
      assert.strictEqual(r.fragCaused, why === 'parcalanma', ctx + ': fragCaused');
      assert.ok(!sim.has(op.id), ctx + ': reddedilen dosya kayıtlı');
      if (deep) assert.deepStrictEqual(ownerMap(sim), before, ctx + ': reddedilen oluşturma diski değiştirdi');
    }
    return r.ok;
  }
  if (!ref.files.has(op.id)) {
    assert.ok(!sim.has(op.id), ctx + ': dosya yalnızca sim tarafında var');
    const before = deep ? ownerMap(sim) : null;
    Sim.applyOp(sim, op); ref.skipped++;
    if (deep) assert.deepStrictEqual(ownerMap(sim), before, ctx + ': atlanan işlem diski değiştirdi');
    return false;
  }
  if (op.op === 'delete') {
    const owned = sim.blocksOf(op.id).concat(sim.metaBlocksOf(op.id));
    const before = deep ? ownerMap(sim) : null, freeBefore = sim.metrics().freeBlocks;
    const r = Sim.applyOp(sim, op), refFreed = ref.remove(op.id);
    assert.ok(r.ok, ctx + ': silme başarısız');
    assert.deepStrictEqual(r.freed.slice().sort((a, b) => a - b), owned.slice().sort((a, b) => a - b), ctx + ': serbest bırakılan bloklar');
    assert.deepStrictEqual(refFreed.slice().sort((a, b) => a - b), owned.slice().sort((a, b) => a - b), ctx + ': ref serbest bırakılan');
    assert.strictEqual(sim.metrics().freeBlocks, freeBefore + owned.length, ctx + ': boş blok artışı');
    if (deep) {
      const after = ownerMap(sim), set = new Set(owned);
      for (let b = 0; b < sim.N; b++) {
        if (set.has(b)) assert.strictEqual(after[b], null, ctx + ': blok ' + b + ' serbest kalmadı');
        else assert.strictEqual(after[b], before[b], ctx + ': silme başka bloğa dokundu (' + b + ')');
      }
    }
    return true;
  }
  const before = deep ? ownerMap(sim) : null;
  const r = Sim.applyOp(sim, op), why = ref.extend(op.id, op.bytes);
  assert.strictEqual(r.ok, why === null, ctx + ': büyütme sonucu (ref: ' + why + ', sim: ' + r.reason + ')');
  if (why) {
    assert.strictEqual(r.reason, why, ctx + ': ret nedeni');
    if (deep) assert.deepStrictEqual(ownerMap(sim), before, ctx + ': reddedilen büyütme diski değiştirdi');
  }
  return r.ok;
}

console.log('1. PRNG');
function mulberry32Canon(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
test('mulberry32 kanonik tanımla aynı diziyi üretir; [0,1) içinde, ortalama ~0,5', () => {
  for (const seed of [0, 1, 2, 30, 12345, 0xffffffff, 2 ** 31]) {
    const a = Sim.mulberry32(seed), b = mulberry32Canon(seed);
    let s = 0;
    for (let i = 0; i < 20000; i++) { const x = a(); assert.strictEqual(x, b()); assert.ok(x >= 0 && x < 1); s += x; }
    assert.ok(Math.abs(s / 20000 - 0.5) < 0.01);
  }
});
test('çekirdek ve deney kodunda Math.random yok', () => {
  for (const f of ['sim-core.js', 'deney.js']) assert.ok(!/Math\.random/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')), f);
});

console.log('2. Elle hesaplanmış küçük senaryolar');
const B = 4096, P = 4;
function mk(method, extra) { return Sim.createAllocator(Object.assign({ method, N: 16, B, P, log: true }, extra || {})); }
function ok(r) { assert.ok(r.ok, 'başarılı olmalıydı: ' + r.reason); return r; }
function no(r, reason) { assert.ok(!r.ok); assert.strictEqual(r.reason, reason); assert.strictEqual(r.fragCaused, reason === 'parcalanma'); return r; }
function range(a, b) { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; }

test('bitişik (ilk uygun): yerleşim, yerinde büyüme, taşıma, iki ret sınıfı, dolu disk', () => {
  const a = mk('contiguous');
  ok(a.create('A', 3 * B + 1));
  ok(a.create('B', 2 * B));
  ok(a.create('C', 2 * B + 1));
  ok(a.create('D', B + 1));
  assert.deepStrictEqual(a.blocksOf('A'), [0, 1, 2, 3]);
  assert.deepStrictEqual(a.blocksOf('B'), [4, 5]);
  assert.deepStrictEqual(a.blocksOf('C'), [6, 7, 8]);
  assert.deepStrictEqual(a.blocksOf('D'), [9, 10]);
  let r = ok(a.extend('B', 1));
  assert.deepStrictEqual(a.blocksOf('B'), [11, 12, 13]);
  assert.strictEqual(r.moved, 2); assert.strictEqual(a.metrics().movedBlocks, 2);
  ok(a.extend('A', 3 * B - 1));
  assert.deepStrictEqual(a.blocksOf('A'), range(0, 5));
});
test('bitişik (ilk uygun): tam senaryo', () => {
  const a = mk('contiguous');
  ok(a.create('A', 4 * B)); ok(a.create('B', 2 * B)); ok(a.create('C', 3 * B)); ok(a.create('D', 2 * B));
  let r = ok(a.extend('B', 1));
  assert.deepStrictEqual(a.blocksOf('B'), [11, 12, 13]);
  assert.strictEqual(r.moved, 2); assert.ok(r.relocated);
  assert.deepStrictEqual(r.freed.slice().sort((x, y) => x - y), [4, 5]);
  r = no(a.extend('A', 3 * B), 'parcalanma');
  assert.deepStrictEqual(a.blocksOf('A'), [0, 1, 2, 3]);
  assert.strictEqual(a.sizeOf('A'), 4 * B);
  ok(a.extend('A', 2 * B));
  assert.deepStrictEqual(a.blocksOf('A'), range(0, 5));
  no(a.create('F', 2 * B + 1), 'yer-yok');
  no(a.extend('A', 3 * B), 'yer-yok');
  ok(a.create('G', B + 1));
  assert.deepStrictEqual(a.blocksOf('G'), [14, 15]);
  let m = a.metrics();
  assert.strictEqual(m.utilization, 1); assert.strictEqual(m.extFragIndex, 0);
  assert.strictEqual(m.freeRuns, 0); assert.strictEqual(m.largestFreeRun, 0);
  assert.strictEqual(m.movedBlocks, 2);
  assert.strictEqual(m.failedCreates, 1); assert.strictEqual(m.failedExtends, 2);
  assert.strictEqual(m.fragFailures, 1); assert.strictEqual(m.noSpaceFailures, 2);
  assert.strictEqual(m.randomAccessCost, 1); assert.strictEqual(m.meanFragments, 1); assert.strictEqual(m.seqCostPerBlock, 1);
  assert.strictEqual(m.metaOverhead, 0);
  ok(a.remove('C')); ok(a.remove('D'));
  m = a.metrics();
  assert.strictEqual(m.freeRuns, 1); assert.strictEqual(m.largestFreeRun, 5); assert.strictEqual(m.extFragIndex, 0);
  ok(a.create('H', 5 * B));
  assert.deepStrictEqual(a.blocksOf('H'), range(6, 10));
  assert.deepStrictEqual(a.accessPath('H', 3), [9]);
});
test('bitişik: ilk uygun ile en uygun farklı boşluğu seçer; eşitlikte en düşük başlangıç', () => {
  for (const policy of ['first-fit', 'best-fit']) {
    const a = mk('contiguous', { policy });
    ok(a.create('A', 4 * B)); ok(a.create('B', 2 * B)); ok(a.create('C', 3 * B)); ok(a.create('D', 2 * B));
    ok(a.remove('A')); ok(a.remove('C'));
    ok(a.create('E', 3 * B));
    assert.deepStrictEqual(a.blocksOf('E'), policy === 'first-fit' ? [0, 1, 2] : [6, 7, 8]);
    const m = a.metrics();
    if (policy === 'first-fit') { assert.strictEqual(m.freeRuns, 3); near(m.extFragIndex, 1 - 5 / 9); }
    else { assert.strictEqual(m.freeRuns, 2); near(m.extFragIndex, 1 - 5 / 9); }
  }
  const b = mk('contiguous', { policy: 'best-fit' });
  ok(b.create('A', 2 * B)); ok(b.create('x', B)); ok(b.create('C', 2 * B)); ok(b.create('y', B)); ok(b.create('z', 10 * B));
  ok(b.remove('A')); ok(b.remove('C'));
  ok(b.create('E', 2 * B));
  assert.deepStrictEqual(b.blocksOf('E'), [0, 1]);
});
test('bağlı liste: veri alanı B−P, en düşük boş blok, zincir erişimi, konumlanma ve üstveri', () => {
  const a = mk('linked');
  ok(a.create('A', 2 * 4092 + 1));
  ok(a.create('B', 4096));
  assert.deepStrictEqual(a.blocksOf('A'), [0, 1, 2]);
  assert.deepStrictEqual(a.blocksOf('B'), [3, 4]);
  ok(a.remove('A'));
  ok(a.create('C', 5 * 4092));
  assert.deepStrictEqual(a.blocksOf('C'), [0, 1, 2, 5, 6]);
  assert.deepStrictEqual(a.metaBlocksOf('C'), []);
  assert.deepStrictEqual(a.accessPath('C', 0), [0]);
  assert.deepStrictEqual(a.accessPath('C', 3), [0, 1, 2, 5]);
  assert.strictEqual(a.fragmentsOf('C'), 2);
  let c = a.seqCost('C');
  assert.deepStrictEqual([c.reads, c.seeks, c.seekDistance, c.cost], [5, 1, 3, 6]);
  ok(a.extend('C', 1));
  assert.deepStrictEqual(a.blocksOf('C'), [0, 1, 2, 5, 6, 7]);
  const m = a.metrics();
  assert.strictEqual(m.usedBlocks, 8);
  near(m.metaOverhead, 8 * 4 / (16 * 4096));
  near(m.randomAccessCost, ((1 + 2) + (1 + 2 + 3 + 4 + 5 + 6)) / 8);
  near(m.meanFragments, (1 + 2) / 2);
  near(m.seqCostMean, (2 + 7) / 2);
  near(m.internalWaste, (2 * 4092 - 4096 + 6 * 4092 - (5 * 4092 + 1)) / (16 * 4096));
  near(m.extFragIndex, 0);
  no(a.create('Z', 8 * 4092 + 1), 'yer-yok');
  ok(a.create('Y', 8 * 4092));
  assert.deepStrictEqual(a.blocksOf('Y'), range(8, 15));
});
test('FAT: veri alanı B, erişim 1 okuma, üstveri N×P bayt', () => {
  const a = mk('linked', { fat: true });
  ok(a.create('A', 3 * B)); ok(a.create('B', B)); ok(a.remove('A')); ok(a.create('C', 5 * B));
  assert.deepStrictEqual(a.blocksOf('B'), [3]);
  assert.deepStrictEqual(a.blocksOf('C'), [0, 1, 2, 4, 5]);
  assert.deepStrictEqual(a.accessPath('C', 4), [5]);
  const m = a.metrics();
  assert.strictEqual(m.randomAccessCost, 1);
  near(m.metaOverhead, 16 * 4 / (16 * 4096));
  assert.strictEqual(m.internalWaste, 0);
});
test('indeksli: indeks bloğu + veri, 2 okuma, üstveri reddi ile yer-yok reddi ayrımı', () => {
  const a = mk('indexed');
  ok(a.create('A', 2 * B)); ok(a.create('B', 1));
  assert.deepStrictEqual(a.metaBlocksOf('A'), [0]); assert.deepStrictEqual(a.blocksOf('A'), [1, 2]);
  assert.deepStrictEqual(a.metaBlocksOf('B'), [3]); assert.deepStrictEqual(a.blocksOf('B'), [4]);
  ok(a.remove('A'));
  ok(a.create('C', 3 * B + 1));
  assert.deepStrictEqual(a.metaBlocksOf('C'), [0]);
  assert.deepStrictEqual(a.blocksOf('C'), [1, 2, 5, 6]);
  assert.deepStrictEqual(a.accessPath('C', 2), [0, 5]);
  const c = a.seqCost('C');
  assert.deepStrictEqual([c.reads, c.seeks, c.seekDistance, c.cost], [5, 1, 3, 6]);
  no(a.create('D', 9 * B), 'ustveri');
  no(a.create('E', 10 * B), 'yer-yok');
  let m = a.metrics();
  assert.strictEqual(m.fragFailures, 0); assert.strictEqual(m.metaFailures, 1); assert.strictEqual(m.noSpaceFailures, 1);
  assert.strictEqual(m.randomAccessCost, 2);
  near(m.metaOverhead, 2 / 16);
  ok(a.create('F', 8 * B));
  assert.deepStrictEqual(a.metaBlocksOf('F'), [7]); assert.deepStrictEqual(a.blocksOf('F'), range(8, 15));
  m = a.metrics();
  assert.strictEqual(m.utilization, 1); assert.strictEqual(m.extFragIndex, 0);
  no(a.extend('B', B), 'yer-yok');
  ok(a.extend('B', B - 1));
  assert.deepStrictEqual(a.blocksOf('B'), [4]);
});
test('indeksli: zincirli indeks blokları (B=32, P=4 -> K=8): 8 blok 1 indeks, 9 blok 2 indeks', () => {
  const a = Sim.createAllocator({ method: 'indexed', N: 32, B: 32, P: 4, log: true });
  ok(a.create('X', 8 * 32));
  assert.deepStrictEqual(a.metaBlocksOf('X'), [0]); assert.deepStrictEqual(a.blocksOf('X'), range(1, 8));
  assert.deepStrictEqual(a.accessPath('X', 7), [0, 8]);
  ok(a.extend('X', 1));
  assert.deepStrictEqual(a.metaBlocksOf('X'), [0, 9]);
  assert.deepStrictEqual(a.blocksOf('X'), [1, 2, 3, 4, 5, 6, 7, 8, 10]);
  assert.deepStrictEqual(a.accessPath('X', 6), [0, 7]);
  assert.deepStrictEqual(a.accessPath('X', 7), [0, 9, 8]);
  assert.deepStrictEqual(a.accessPath('X', 8), [0, 9, 10]);
  const c = a.seqCost('X');
  assert.deepStrictEqual([c.reads, c.seeks, c.seekDistance, c.cost], [11, 3, 5, 14]);
  near(a.metrics().randomAccessCost, (7 * 2 + 2 * 3) / 9);
  ok(a.extend('X', 6 * 32));
  assert.strictEqual(a.metaBlocksOf('X').length, 2);
  ok(a.extend('X', 32));
  assert.strictEqual(a.metaBlocksOf('X').length, 3);
  assert.strictEqual(a.accessPath('X', 13).length, 3);
  assert.strictEqual(a.accessPath('X', 14).length, 4);
  assert.strictEqual(a.accessPath('X', 15).length, 4);
});
test('indeksli (B=4096): 1024 blok 1 indeks / 2 okuma; 1025 blok 2 indeks; 2047 -> 2, 2048 -> 3', () => {
  const a = Sim.createAllocator({ method: 'indexed', N: 4096, B, P, log: false });
  ok(a.create('X', 1024 * B));
  assert.strictEqual(a.metaBlocksOf('X').length, 1);
  assert.strictEqual(a.metrics().randomAccessCost, 2);
  ok(a.extend('X', 1));
  assert.strictEqual(a.metaBlocksOf('X').length, 2);
  assert.strictEqual(a.accessPath('X', 1022).length, 2);
  assert.strictEqual(a.accessPath('X', 1023).length, 3);
  assert.strictEqual(a.accessPath('X', 1024).length, 3);
  near(a.metrics().randomAccessCost, (1023 * 2 + 2 * 3) / 1025);
  ok(a.extend('X', 1022 * B));
  assert.strictEqual(a.blocksOf('X').length, 2047); assert.strictEqual(a.metaBlocksOf('X').length, 2);
  ok(a.extend('X', B));
  assert.strictEqual(a.blocksOf('X').length, 2048); assert.strictEqual(a.metaBlocksOf('X').length, 3);
  assert.strictEqual(a.accessPath('X', 2045).length, 3);
  assert.strictEqual(a.accessPath('X', 2046).length, 4);
});
test('extent: ilk uygun tek extent, en büyük boşluklardan parçalı tahsis, yerinde büyüme', () => {
  const a = Sim.createAllocator({ method: 'extent', N: 32, B, P, log: true });
  ok(a.create('A', 4 * B)); ok(a.create('B', 2 * B)); ok(a.create('C', 6 * B)); ok(a.create('D', 3 * B));
  ok(a.create('E', 2 * B)); ok(a.create('F', 3 * B));
  assert.deepStrictEqual(a.blocksOf('F'), [17, 18, 19]);
  ok(a.remove('B')); ok(a.remove('D'));
  ok(a.create('G', 2 * B + 1));
  assert.deepStrictEqual(a.blocksOf('G'), [12, 13, 14]);
  ok(a.remove('G'));
  ok(a.create('H', 14 * B));
  assert.deepStrictEqual(a.blocksOf('H'), range(20, 31).concat([12, 13]));
  let s = a.structureOf('H');
  assert.deepStrictEqual(s.extents.map((e) => [e.start, e.length]), [[20, 12], [12, 2]]);
  assert.strictEqual(a.fragmentsOf('H'), 2);
  assert.deepStrictEqual(a.metaBlocksOf('H'), []);
  assert.deepStrictEqual(a.accessPath('H', 12), [12]);
  const c = a.seqCost('H');
  assert.deepStrictEqual([c.reads, c.seeks, c.seekDistance, c.cost], [14, 1, 19, 15]);
  ok(a.extend('A', 1));
  assert.deepStrictEqual(a.blocksOf('A'), [0, 1, 2, 3, 4]);
  ok(a.extend('A', 2 * B));
  assert.deepStrictEqual(a.blocksOf('A'), [0, 1, 2, 3, 4, 5, 14]);
  s = a.structureOf('A');
  assert.deepStrictEqual(s.extents.map((e) => [e.start, e.length]), [[0, 6], [14, 1]]);
  const m = a.metrics();
  assert.strictEqual(m.utilization, 1); assert.strictEqual(m.extFragIndex, 0);
  assert.strictEqual(m.randomAccessCost, 1); assert.strictEqual(m.metaOverhead, 0);
  near(m.meanFragments, (2 + 1 + 1 + 1 + 2) / 5);
  no(a.extend('C', 1), 'yer-yok');
});
test('extent: 4\'ten fazla extent -> ağaç bloğu (2 okuma); ağaç bloğuna yer yoksa üstveri reddi', () => {
  function board() {
    const a = Sim.createAllocator({ method: 'extent', N: 32, B, P, log: true });
    for (let i = 0; i < 16; i++) ok(a.create('a' + i, B));
    ok(a.create('T', 16 * B));
    for (let i = 0; i < 16; i += 2) ok(a.remove('a' + i));
    return a;
  }
  let a = board();
  ok(a.create('Z', 5 * B));
  assert.deepStrictEqual(a.blocksOf('Z'), [0, 2, 4, 6, 8]);
  assert.deepStrictEqual(a.metaBlocksOf('Z'), [10]);
  assert.deepStrictEqual(a.accessPath('Z', 3), [10, 6]);
  const c = a.seqCost('Z');
  assert.deepStrictEqual([c.reads, c.seeks, c.seekDistance, c.cost], [6, 5, 18, 11]);
  ok(a.create('Y', 2 * B));
  assert.deepStrictEqual(a.blocksOf('Y'), [12, 14]);
  assert.deepStrictEqual(a.metaBlocksOf('Y'), []);
  assert.deepStrictEqual(a.accessPath('Y', 1), [14]);
  let m = a.metrics();
  assert.strictEqual(m.utilization, 1);
  near(m.metaOverhead, 1 / 32);
  near(m.randomAccessCost, (8 + 16 + 5 * 2 + 2) / 31);
  a = board();
  no(a.create('Z', 8 * B), 'ustveri');
  assert.strictEqual(a.metrics().freeBlocks, 8);
  ok(a.create('Z', 7 * B));
  assert.deepStrictEqual(a.blocksOf('Z'), [0, 2, 4, 6, 8, 10, 12]);
  assert.deepStrictEqual(a.metaBlocksOf('Z'), [14]);
  a = board();
  ok(a.create('Q', 4 * B));
  assert.deepStrictEqual(a.blocksOf('Q'), [0, 2, 4, 6]);
  assert.deepStrictEqual(a.metaBlocksOf('Q'), []);
  assert.strictEqual(a.accessPath('Q', 3).length, 1);
  ok(a.extend('Q', 1));
  assert.deepStrictEqual(a.blocksOf('Q'), [0, 2, 4, 6, 8]);
  assert.deepStrictEqual(a.metaBlocksOf('Q'), [10]);
  assert.strictEqual(a.accessPath('Q', 0).length, 2);
});
test('dış parçalanma indeksi: boş alan yokken 0, tek parça iken 0, bilinen örnekte 1 − enBüyük/toplam', () => {
  const a = Sim.createAllocator({ method: 'linked', fat: true, N: 10, B, P, log: false });
  assert.strictEqual(a.metrics().extFragIndex, 0);
  for (let i = 0; i < 10; i++) ok(a.create('f' + i, B));
  assert.strictEqual(a.metrics().extFragIndex, 0); assert.strictEqual(a.metrics().freeBlocks, 0);
  ok(a.remove('f1')); ok(a.remove('f4')); ok(a.remove('f5')); ok(a.remove('f9'));
  const m = a.metrics();
  assert.strictEqual(m.freeRuns, 3); assert.strictEqual(m.largestFreeRun, 2); near(m.extFragIndex, 1 - 2 / 4);
});

console.log('3. Özellik testleri: rastgele izlerde referans modelle birebir karşılaştırma');
function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function randomOps(rnd, cfg, count) {
  const ops = [], live = [], pay = [cfg.B, cfg.B - cfg.P];
  let next = 1;
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  function bytes(maxBlocks) {
    const k = ri(1, maxBlocks), unit = pay[ri(0, 1)], x = rnd();
    if (x < 0.25) return k * unit;
    if (x < 0.40) return k * unit + 1;
    if (x < 0.50) return Math.max(1, k * unit - 1);
    return (k - 1) * cfg.B + ri(1, cfg.B);
  }
  for (let t = 0; t < count; t++) {
    const x = rnd();
    if (live.length === 0 || x < 0.45) {
      const id = 'p' + (next++);
      ops.push({ op: 'create', id, bytes: bytes(rnd() < 0.15 ? cfg.big : cfg.small) });
      live.push(id);
    } else if (x < 0.75) {
      const i = ri(0, live.length - 1);
      ops.push({ op: 'delete', id: live[i] });
      live.splice(i, 1);
    } else {
      ops.push({ op: 'extend', id: live[ri(0, live.length - 1)], bytes: bytes(rnd() < 0.2 ? cfg.big : cfg.small) });
    }
  }
  return ops;
}
const CONFIGS = [
  { N: 48, B: 64, P: 4, inodeExtents: 4, fanout: 3, small: 4, big: 20, ops: 500 },
  { N: 64, B: 32, P: 4, inodeExtents: 4, fanout: 3, small: 3, big: 40, ops: 500 },
  { N: 200, B: 4096, P: 4, inodeExtents: 4, fanout: 340, small: 8, big: 60, ops: 600 },
  { N: 512, B: 64, P: 4, inodeExtents: 4, fanout: 8, small: 10, big: 150, ops: 700 }
];
for (const v of VARIANTS) {
  test(v.key + ': ' + CONFIGS.length + ' disk düzeni × 12 tohum, her işlemden sonra tam durum denetimi', () => {
    let fails = 0, oks = 0, relocs = 0, chained = 0, trees = 0, nodes = 0;
    for (let ci = 0; ci < CONFIGS.length; ci++) {
      const cfg = CONFIGS[ci];
      for (let seed = 1; seed <= 12; seed++) {
        const { sim, ref } = pair(v, Object.assign({ log: seed % 2 === 0 }, cfg));
        const ops = randomOps(lcg(seed * 7919 + ci * 104729), cfg, cfg.ops);
        for (let t = 0; t < ops.length; t++) {
          const ctx = v.key + ' düzen ' + ci + ' tohum ' + seed + ' adım ' + t + ' ' + JSON.stringify(ops[t]);
          const movedBefore = ref.moved;
          const okk = step(sim, ref, ops[t], ctx, true);
          if (ops[t].op !== 'delete') { if (okk) oks++; else fails++; }
          if (ref.moved > movedBefore) relocs++;
          checkState(sim, ref, ctx);
          if (okk && ops[t].op !== 'delete') {
            checkPaths(sim, ref, ops[t].id, ctx);
            const f = ref.files.get(ops[t].id);
            if (f.meta.length > 1) chained++;
            if (f.leaves.length) trees++;
            if (f.nodes.length) nodes++;
          }
          if (t % 10 === 0 || t === ops.length - 1) checkMetrics(sim, ref, ctx);
        }
        for (const id of sim.fileIds()) checkPaths(sim, ref, id, v.key + ' son durum');
        assert.deepStrictEqual(sim.checkInvariants(), [], 'checkInvariants');
      }
    }
    assert.ok(oks > 2000 && fails > 100, 'başarılı/başarısız istek sayısı yetersiz: ' + oks + '/' + fails);
    if (v.method === 'contiguous') assert.ok(relocs > 100, 'taşıma yolu yeterince çalışmadı: ' + relocs);
    if (v.method === 'indexed') assert.ok(chained > 50, 'zincirli indeks yolu yeterince çalışmadı: ' + chained);
    if (v.method === 'extent') assert.ok(trees > 50, 'extent ağacı yolu yeterince çalışmadı: ' + trees + '/' + nodes);
  });
}

console.log('4. İz üreteci');
const EXP = { N: 8192, B: 4096, P: 4, us: [0.5, 0.7, 0.9], band: 0.05, agingOps: 5000, extendMax: 32 };
function gen(u, seed) { return Sim.generateTrace({ N: EXP.N, B: EXP.B, u, seed, agingOps: EXP.agingOps }); }

test('iz deterministik; tohuma bağlı; üreteç hiçbir yöntem nesnesi almıyor', () => {
  assert.strictEqual(JSON.stringify(gen(0.7, 5)), JSON.stringify(gen(0.7, 5)));
  assert.notStrictEqual(JSON.stringify(gen(0.7, 5).ops), JSON.stringify(gen(0.7, 6).ops));
  assert.strictEqual(Sim.generateTrace.length, 1);
  const t = gen(0.9, 3), copy = JSON.stringify(t.ops);
  for (const v of VARIANTS) Sim.runTrace(Sim.createAllocator({ method: v.method, fat: v.fat, policy: v.policy, N: EXP.N, B, P, log: false }), t);
  assert.strictEqual(JSON.stringify(t.ops), copy, 'yöntemler izi değiştirmemeli');
});
test('iz kuralları: aşama 1 hedefi, denetleyici, sınıf oranları, işlem karışımı (3 doluluk × 30 tohum)', () => {
  const cls = [0, 0, 0], mix = { create: 0, delete: 0, extend: 0 };
  let tailSum = 0, tailN = 0, growSum = 0, growN = 0, growMin = 99, growMax = 0, sizeMin = 1e9, sizeMax = 0;
  for (const u of EXP.us) for (let seed = 1; seed <= 30; seed++) {
    const t = gen(u, seed), live = new Map(), target = Math.round(u * EXP.N);
    let ref = 0, phase2 = 0, peak = 0, seenPhase2 = false;
    const ids = new Set();
    for (const op of t.ops) {
      const utilBefore = ref / EXP.N;
      if (op.phase === 1) assert.ok(!seenPhase2 && op.op === 'create');
      else {
        if (!seenPhase2) { assert.strictEqual(ref, target, 'aşama 1 sonunda referans tam hedefte olmalı'); seenPhase2 = true; }
        phase2++;
        if (utilBefore > u + EXP.band) assert.strictEqual(op.op, 'delete', 'üst sınır aşıldı ama silme zorlanmadı');
        else if (utilBefore < u - EXP.band) assert.strictEqual(op.op, 'create', 'alt sınırın altında ama oluşturma zorlanmadı');
        else mix[op.op]++;
      }
      if (op.op === 'create') {
        assert.ok(!ids.has(op.id), 'dosya adı yeniden kullanıldı'); ids.add(op.id);
        assert.ok(Number.isInteger(op.bytes) && op.bytes >= 1);
        const k = Math.ceil(op.bytes / EXP.B);
        live.set(op.id, op.bytes); ref += k;
        if (op.phase === 2) {
          cls[k <= 8 ? 0 : k <= 64 ? 1 : 2]++;
          sizeMin = Math.min(sizeMin, k); sizeMax = Math.max(sizeMax, k);
          tailSum += op.bytes - (k - 1) * EXP.B; tailN++;
        }
      } else if (op.op === 'delete') {
        assert.ok(live.has(op.id), 'canlı olmayan dosya silindi');
        ref -= Math.ceil(live.get(op.id) / EXP.B); live.delete(op.id);
      } else {
        assert.strictEqual(op.op, 'extend');
        assert.ok(live.has(op.id), 'canlı olmayan dosya büyütüldü');
        assert.ok(Number.isInteger(op.bytes) && op.bytes >= 1);
        const old = live.get(op.id), g = Math.ceil((old + op.bytes) / EXP.B) - Math.ceil(old / EXP.B);
        assert.ok(g >= 1 && g <= EXP.extendMax, 'büyütme 1–32 blok olmalı: ' + g);
        growSum += g; growN++; growMin = Math.min(growMin, g); growMax = Math.max(growMax, g);
        live.set(op.id, old + op.bytes); ref += g;
      }
      assert.ok(ref <= EXP.N, 'referans disk taştı');
      peak = Math.max(peak, ref / EXP.N);
    }
    assert.strictEqual(phase2, EXP.agingOps, 'aşama 2 işlem sayısı');
    near(t.stats.finalRefUtil, ref / EXP.N, 'son referans doluluk');
    near(t.stats.peakRefUtil, peak, 'en yüksek referans doluluk');
    assert.strictEqual(t.stats.finalLiveFiles, live.size);
    assert.ok(ref / EXP.N >= u - EXP.band - 0.06 && ref / EXP.N <= u + EXP.band + 0.05, 'son doluluk bandın çok dışında');
  }
  const cn = cls[0] + cls[1] + cls[2];
  assert.ok(Math.abs(cls[0] / cn - 0.70) < 0.01 && Math.abs(cls[1] / cn - 0.25) < 0.01 && Math.abs(cls[2] / cn - 0.05) < 0.005,
    'sınıf oranları: ' + cls.map((x) => (x / cn).toFixed(4)));
  assert.strictEqual(sizeMin, 1); assert.strictEqual(sizeMax, 400);
  const mn = mix.create + mix.delete + mix.extend;
  assert.ok(Math.abs(mix.create / mn - 0.45) < 0.01 && Math.abs(mix.delete / mn - 0.35) < 0.01 && Math.abs(mix.extend / mn - 0.20) < 0.01,
    'bant içi işlem karışımı: ' + [mix.create / mn, mix.delete / mn, mix.extend / mn].map((x) => x.toFixed(4)));
  assert.ok(Math.abs(tailSum / tailN / EXP.B - 0.5) < 0.01, 'son blok kuyruğu düzgün dağılmıyor');
  assert.ok(growMin === 1 && growMax === 32 && Math.abs(growSum / growN - 16.5) < 0.2, 'büyütme boyu 1–32 düzgün değil');
});

console.log('5. Deney ölçeğinde bağımsız yeniden hesap (N = 8192)');
const withResults = process.argv.includes('--sonuclar');
const REPL_SEEDS = withResults ? range(1, 30) : [1, 2, 3, 4];
const repl = {};
test('sim-core ölçütleri = referans modelin ölçütleri (' + REPL_SEEDS.length + ' tohum × 3 doluluk × 6 yöntem çeşidi)', () => {
  for (const u of EXP.us) {
    repl[u.toFixed(2)] = {};
    for (const v of VARIANTS) { repl[u.toFixed(2)][v.key] = {}; for (const k of METRIC_KEYS) repl[u.toFixed(2)][v.key][k] = []; }
    for (const seed of REPL_SEEDS) {
      const t = gen(u, seed);
      for (const v of VARIANTS) {
        if (v.key === 'best-fit' && u === 0.5) continue;
        const { sim, ref } = pair(v, { N: EXP.N, B: EXP.B, P: EXP.P, log: false });
        for (let i = 0; i < t.ops.length; i++) step(sim, ref, t.ops[i], v.key + ' u=' + u + ' tohum=' + seed + ' adım=' + i, false);
        const ctx = v.key + ' u=' + u + ' tohum=' + seed;
        checkState(sim, ref, ctx);
        checkMetrics(sim, ref, ctx);
        const m = ref.metrics();
        for (const k of METRIC_KEYS) repl[u.toFixed(2)][v.key][k].push(m[k]);
        if (v.method === 'contiguous') { assert.strictEqual(m.randomAccessCost, 1); assert.strictEqual(m.meanFragments, 1); assert.strictEqual(m.seqCostPerBlock, 1); }
        if (v.key === 'fat') assert.strictEqual(m.randomAccessCost, 1);
        if (v.key === 'indexed') { assert.strictEqual(m.randomAccessCost, 2); assert.strictEqual(m.metaBlocks, m.fileCount); }
        if (v.method !== 'contiguous') { assert.strictEqual(m.fragFailures, 0); assert.strictEqual(m.movedBlocks, 0); }
        if (v.key === 'linked') {
          let a = 0, b = 0;
          for (const f of ref.files.values()) { const n = Math.ceil(f.size / (EXP.B - EXP.P)); a += n * (n + 1) / 2; b += n; }
          near(m.randomAccessCost, a / b, 'bağlı liste rastgele erişim kapalı biçimi');
        }
      }
    }
  }
});

if (withResults) {
  console.log('6. sonuclar.json ve sonuclar.md, bağımsız yeniden hesapla karşılaştırma');
  const J = JSON.parse(fs.readFileSync(path.join(__dirname, 'sonuclar.json'), 'utf8'));
  const MD = fs.readFileSync(path.join(__dirname, 'sonuclar.md'), 'utf8');
  const stat = (xs) => {
    const n = xs.length, mean = xs.reduce((s, x) => s + x, 0) / n;
    return { mean, sd: Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) };
  };
  const fmt = (x, d) => x.toFixed(d).replace('.', ',');
  const ROWS = [
    ['Doluluk (kullanılan blok / N)', 'utilization', 3, 1], ['Canlı dosya sayısı', 'fileCount', 1, 1],
    ['Boşluk sayısı', 'freeRuns', 1, 1], ['En büyük boşluk (blok)', 'largestFreeRun', 1, 1],
    ['Dış parçalanma indeksi', 'extFragIndex', 3, 1], ['Dosya başına ortalama parça sayısı', 'meanFragments', 2, 1],
    ['Sıralı okuma maliyeti / veri bloğu', 'seqCostPerBlock', 3, 1], ['Sıralı okuma maliyeti / dosya (okuma + konumlanma)', 'seqCostMean', 1, 1],
    ['Dosya başına konumlanma sayısı', 'seqSeeksMean', 2, 1], ['Ortalama konumlanma uzaklığı (blok)', 'meanSeekDistance', 1, 1],
    ['Rastgele erişim maliyeti (okuma)', 'randomAccessCost', 2, 1], ['Üstveri yükü (%)', 'metaOverhead', 3, 100],
    ['İç parçalanma (%)', 'internalWaste', 3, 100], ['Taşınan blok (tüm iz)', 'movedBlocks', 1, 1],
    ['Reddedilen oluşturma (tüm iz)', 'failedCreates', 1, 1], ['Reddedilen büyütme (tüm iz)', 'failedExtends', 1, 1],
    ['— dış parçalanma kaynaklı ret', 'fragFailures', 1, 1], ['— boş blok yetersizliğinden ret', 'noSpaceFailures', 1, 1],
    ['— üstveri bloğuna yer kalmadığından ret', 'metaFailures', 1, 1], ['Atlanan işlem (dosya o yöntemde yok)', 'skipped', 1, 1]
  ];
  test('sonuclar.json ham değerleri = bağımsız yeniden hesap (tüm tohumlar, tüm ölçütler)', () => {
    for (const u of ['0.50', '0.70', '0.90']) for (const key of ['contiguous', 'linked', 'indexed', 'extent', 'fat']) for (const k of METRIC_KEYS) {
      const a = J.raw[u][key][k], b = repl[u][key][k];
      assert.strictEqual(a.length, 30);
      for (let i = 0; i < 30; i++) near(a[i], b[i], 'u=' + u + ' ' + key + ' ' + k + ' tohum ' + (i + 1));
    }
    for (const u of ['0.70', '0.90']) for (const k of METRIC_KEYS) {
      const a = J.sensitivity.raw[u]['best-fit'][k], b = repl[u]['best-fit'][k];
      for (let i = 0; i < 30; i++) near(a[i], b[i], 'duyarlılık u=' + u + ' en uygun ' + k + ' tohum ' + (i + 1));
      const c = J.sensitivity.raw[u]['first-fit'][k], d = repl[u]['contiguous'][k];
      for (let i = 0; i < 30; i++) near(c[i], d[i], 'duyarlılık u=' + u + ' ilk uygun ' + k + ' tohum ' + (i + 1));
    }
  });
  test('sonuclar.json ortalama / standart sapma değerleri ham değerlerden doğru hesaplanmış', () => {
    for (const u of ['0.50', '0.70', '0.90']) for (const key of ['contiguous', 'linked', 'indexed', 'extent', 'fat']) for (const k of METRIC_KEYS) {
      const s = stat(repl[u][key][k]), a = J.aggregates[u][key][k];
      near(a.mean, s.mean, 'ortalama ' + u + ' ' + key + ' ' + k); near(a.sd, s.sd, 'ss ' + u + ' ' + key + ' ' + k);
    }
  });
  test('sonuclar.md tablolarındaki her hücre bağımsız yeniden hesapla aynı (ondalık virgül)', () => {
    const sections = MD.split(/\n## /);
    for (const u of ['0.50', '0.70', '0.90']) {
      const sec = sections.find((s) => s.startsWith('Hedef doluluk u = ' + u.replace('.', ',')));
      assert.ok(sec, 'bölüm yok: u=' + u);
      const lines = sec.split('\n').filter((l) => l.startsWith('|'));
      assert.strictEqual(lines[0], '| Ölçüt | Bitişik | Bağlı liste | İndeksli | Extent | FAT |');
      for (const [label, k, d, scale] of ROWS) {
        const expect = '| ' + label + ' | ' + ['contiguous', 'linked', 'indexed', 'extent', 'fat'].map((key) => {
          const s = stat(repl[u][key][k]); return fmt(s.mean * scale, d) + ' ± ' + fmt(s.sd * scale, d);
        }).join(' | ') + ' |';
        assert.ok(lines.includes(expect), 'u=' + u + ' satırı farklı.\n       beklenen: ' + expect + '\n       bulunan : ' + (lines.find((l) => l.startsWith('| ' + label + ' |')) || '(yok)'));
      }
    }
    const sens = sections.find((s) => s.startsWith('Duyarlılık'));
    const sl = sens.split('\n').filter((l) => l.startsWith('|'));
    for (const [label, k, d, scale] of ROWS) {
      if (!sl.some((l) => l.startsWith('| ' + label + ' |'))) continue;
      const cells = [];
      for (const u of ['0.70', '0.90']) for (const key of ['contiguous', 'best-fit']) { const s = stat(repl[u][key][k]); cells.push(fmt(s.mean * scale, d) + ' ± ' + fmt(s.sd * scale, d)); }
      const expect = '| ' + label + ' | ' + cells.join(' | ') + ' |';
      assert.ok(sl.includes(expect), 'duyarlılık satırı farklı.\n       beklenen: ' + expect + '\n       bulunan : ' + sl.find((l) => l.startsWith('| ' + label + ' |')));
    }
    assert.ok(!/\d\.\d/.test(MD.replace(/`[^`]*`/g, '')), 'Markdown tablolarında ondalık nokta kalmış');
  });
}

console.log('\n' + passed + ' denetim geçti, ' + failed + ' denetim başarısız.');
process.exit(failed ? 1 : 0);
