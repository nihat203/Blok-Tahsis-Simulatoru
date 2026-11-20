(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SimCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var METHODS = ['contiguous', 'linked', 'indexed', 'extent'];
  var VARIANT_KEYS = ['contiguous', 'linked', 'indexed', 'extent', 'fat'];
  var LABELS = {
    contiguous: 'Bitişik',
    linked: 'Bağlı liste',
    indexed: 'İndeksli',
    extent: 'Extent',
    fat: 'FAT'
  };
  var DEFAULTS = { N: 256, B: 4096, P: 4, inodeExtents: 4, extentsPerTreeBlock: 340 };

  var REASON = {
    NO_SPACE: 'yer-yok',
    META: 'ustveri',
    FRAG: 'parcalanma',
    EXISTS: 'ad-kullanimda',
    MISSING: 'dosya-yok',
    INVALID: 'gecersiz'
  };

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function span(a, b) { return a === b ? String(a) : a + '–' + b; }

  function toRanges(blocks) {
    var out = [];
    var i = 0;
    while (i < blocks.length) {
      var j = i;
      while (j + 1 < blocks.length && blocks[j + 1] === blocks[j] + 1) j++;
      out.push([blocks[i], blocks[j]]);
      i = j + 1;
    }
    return out;
  }

  function runStr(start, len) {
    return len === 1 ? start + ' numaralı tek blokluk' : span(start, start + len - 1) + ' arası ' + len + ' blokluk';
  }

  function listStr(blocks, max) {
    var r = toRanges(blocks).map(function (x) { return span(x[0], x[1]); });
    max = max || 8;
    if (r.length > max) return r.slice(0, max).join(', ') + ', … (toplam ' + blocks.length + ' blok)';
    return r.join(', ');
  }

  function chainStr(blocks, max) {
    max = max || 10;
    if (blocks.length <= max) return blocks.join(' → ');
    return blocks.slice(0, max - 2).join(' → ') + ' → … → ' + blocks.slice(-2).join(' → ');
  }

  function Allocator(opts) {
    opts = opts || {};
    var method = opts.method || 'contiguous';
    var fat = !!opts.fat;
    if (method === 'fat') { method = 'linked'; fat = true; }
    if (METHODS.indexOf(method) < 0) throw new Error('Bilinmeyen yöntem: ' + method);

    var N = opts.N == null ? DEFAULTS.N : opts.N;
    var B = opts.B == null ? DEFAULTS.B : opts.B;
    var P = opts.P == null ? DEFAULTS.P : opts.P;
    if (!(Number.isInteger(N) && N > 0)) throw new Error('N pozitif tam sayı olmalı');
    if (!(Number.isInteger(B) && Number.isInteger(P) && P > 0 && B > P && B % P === 0)) {
      throw new Error('B, P\'nin tam katı ve P\'den büyük olmalı');
    }

    this.method = method;
    this.fat = method === 'linked' && fat;
    this.key = this.fat ? 'fat' : method;
    this.label = LABELS[this.key];
    this.policy = opts.policy === 'best-fit' ? 'best-fit' : 'first-fit';
    this.N = N;
    this.B = B;
    this.P = P;
    this.K = B / P;
    this.payload = (method === 'linked' && !this.fat) ? B - P : B;
    this.inodeExtents = opts.inodeExtents == null ? DEFAULTS.inodeExtents : opts.inodeExtents;
    this.fanout = opts.extentsPerTreeBlock == null ? DEFAULTS.extentsPerTreeBlock : opts.extentsPerTreeBlock;
    this.logOn = opts.log !== false;

    this.owner = new Int32Array(N).fill(-1);
    this.kind = new Uint8Array(N);
    this.freeCount = N;
    this._low = 0;
    this.files = new Map();
    this._byHandle = new Map();
    this._nextHandle = 0;
    this.stats = {
      createOk: 0, createFail: 0, extendOk: 0, extendFail: 0, removeOk: 0,
      failNoSpace: 0, failMeta: 0, failFrag: 0,
      fragCreateFail: 0, fragExtendFail: 0,
      movedBlocks: 0, relocations: 0, inPlaceGrowths: 0, skipped: 0
    };
  }

  var AP = Allocator.prototype;

  AP._take = function (b, f, kind) {
    this.owner[b] = f.h;
    this.kind[b] = kind;
    this.freeCount--;
  };
  AP._release = function (b) {
    this.owner[b] = -1;
    this.kind[b] = 0;
    this.freeCount++;
    if (b < this._low) this._low = b;
  };
  AP._lowest = function () {
    var o = this.owner, N = this.N, i = this._low;
    while (i < N && o[i] !== -1) i++;
    this._low = i;
    return i < N ? i : -1;
  };
  AP._takeLowest = function (f, kind) {
    var b = this._lowest();
    this._take(b, f, kind);
    return b;
  };

  AP.freeRuns = function () {
    var o = this.owner, N = this.N, out = [];
    var i = this._lowest();
    if (i < 0) return out;
    while (i < N) {
      if (o[i] !== -1) { i++; continue; }
      var j = i;
      while (j < N && o[j] === -1) j++;
      out.push([i, j - i]);
      i = j;
    }
    return out;
  };

  AP.largestFreeRun = function () {
    var runs = this.freeRuns(), m = 0;
    for (var i = 0; i < runs.length; i++) if (runs[i][1] > m) m = runs[i][1];
    return m;
  };

  AP._firstFit = function (need) {
    var o = this.owner, N = this.N;
    var i = this._lowest();
    if (i < 0) return null;
    while (i < N) {
      if (o[i] !== -1) { i++; continue; }
      var j = i;
      while (j < N && o[j] === -1) j++;
      if (j - i >= need) return [i, j - i];
      i = j;
    }
    return null;
  };

  AP._bestFit = function (need) {
    var runs = this.freeRuns(), best = null;
    for (var i = 0; i < runs.length; i++) {
      if (runs[i][1] >= need && (best === null || runs[i][1] < best[1])) best = runs[i];
    }
    return best;
  };

  AP._findRun = function (need) {
    return this.policy === 'best-fit' ? this._bestFit(need) : this._firstFit(need);
  };

  AP._runText = function (run) {
    var s = span(run[0], run[0] + run[1] - 1);
    if (this.policy === 'best-fit') {
      return 'En uygun (best-fit): yeterli boşlukların en küçüğü ' + s + ' (' + run[1] + ' blok) seçildi';
    }
    return 'İlk uygun (first-fit): ' + runStr(run[0], run[1]) + ' ilk yeterli boşluk bulundu';
  };

  AP._res = function (op, id) {
    return {
      op: op, id: id, ok: false, reason: null, fragCaused: false,
      allocated: [], metaAllocated: [], freed: [], moved: 0, relocated: false, log: []
    };
  };

  AP._fail = function (r, reason, msg) {
    r.ok = false;
    r.reason = reason;
    r.fragCaused = reason === REASON.FRAG;
    if (this.logOn) r.log.push(msg);
    return false;
  };

  AP._countFail = function (r, isCreate) {
    var s = this.stats;
    if (isCreate) s.createFail++; else s.extendFail++;
    if (r.reason === REASON.NO_SPACE) s.failNoSpace++;
    else if (r.reason === REASON.META) s.failMeta++;
    else if (r.reason === REASON.FRAG) {
      s.failFrag++;
      if (isCreate) s.fragCreateFail++; else s.fragExtendFail++;
    }
  };

  function validBytes(x) { return typeof x === 'number' && isFinite(x) && x >= 1 && Math.floor(x) === x; }

  AP.has = function (id) { return this.files.has(id); };
  AP.fileIds = function () { return Array.from(this.files.keys()); };
  AP.sizeOf = function (id) { return this._file(id).size; };

  AP._file = function (id) {
    var f = this.files.get(id);
    if (!f) throw new Error('Dosya yok: ' + id);
    return f;
  };

  AP.create = function (id, sizeBytes) {
    var r = this._res('create', id);
    if (this.files.has(id)) {
      this._fail(r, REASON.EXISTS, '"' + id + '" adlı dosya zaten var; istek yok sayıldı.');
      return r;
    }
    if (!validBytes(sizeBytes)) {
      this._fail(r, REASON.INVALID, 'Geçersiz boyut: dosya boyutu en az 1 bayt olan bir tam sayı olmalı.');
      return r;
    }
    var f = { id: id, h: this._nextHandle, size: 0, data: [], meta: [], extents: [], leaves: [], inodes: [] };
    var ok = this._grow(f, sizeBytes, r);
    if (ok) {
      this._nextHandle++;
      f.size = sizeBytes;
      this.files.set(id, f);
      this._byHandle.set(f.h, f);
      this.stats.createOk++;
      r.ok = true;
    } else {
      this._countFail(r, true);
    }
    return r;
  };

  AP.extend = function (id, extraBytes) {
    var r = this._res('extend', id);
    var f = this.files.get(id);
    if (!f) {
      this._fail(r, REASON.MISSING, '"' + id + '" adlı dosya bu yöntemde yok; istek yok sayıldı.');
      return r;
    }
    if (!validBytes(extraBytes)) {
      this._fail(r, REASON.INVALID, 'Geçersiz boyut: ek boyut en az 1 bayt olan bir tam sayı olmalı.');
      return r;
    }
    var ok = this._grow(f, f.size + extraBytes, r);
    if (ok) {
      f.size += extraBytes;
      this.stats.extendOk++;
      r.ok = true;
    } else {
      this._countFail(r, false);
    }
    return r;
  };

  AP.remove = function (id) {
    var r = this._res('remove', id);
    var f = this.files.get(id);
    if (!f) {
      this._fail(r, REASON.MISSING, '"' + id + '" adlı dosya bu yöntemde yok; istek yok sayıldı.');
      return r;
    }
    var all = f.data.concat(f.meta, f.leaves, f.inodes);
    for (var i = 0; i < all.length; i++) this._release(all[i]);
    this.files.delete(id);
    this._byHandle.delete(f.h);
    this.stats.removeOk++;
    r.ok = true;
    r.freed = all;
    if (this.logOn) {
      var metaN = all.length - f.data.length;
      var sorted = all.slice().sort(function (a, b) { return a - b; });
      r.log.push('"' + id + '" silindi: ' + f.data.length + ' veri bloğu' +
        (metaN ? ' ve ' + metaN + ' üstveri bloğu' : '') + ' serbest bırakıldı (' + listStr(sorted, 8) + ').');
    }
    return r;
  };

  AP._grow = function (f, newSize, r) {
    switch (this.method) {
      case 'contiguous': return this._growContiguous(f, newSize, r);
      case 'linked': return this._growLinked(f, newSize, r);
      case 'indexed': return this._growIndexed(f, newSize, r);
      default: return this._growExtent(f, newSize, r);
    }
  };

  AP._growContiguous = function (f, newSize, r) {
    var B = this.B, N = this.N, o = this.owner;
    var cur = f.data.length;
    var need = Math.ceil(newSize / B);
    var add = need - cur;
    var L = this.logOn ? r.log : null;
    var run, i, s;

    if (cur === 0) {
      if (L) L.push('"' + f.id + '": ' + newSize + ' bayt → ⌈' + newSize + '/' + B + '⌉ = ' + need + ' ardışık blok gerekiyor.');
      if (need > this.freeCount) {
        return this._fail(r, REASON.NO_SPACE, 'Reddedildi: ' + need + ' blok gerekiyor, diskte yalnızca ' + this.freeCount + ' boş blok var.');
      }
      run = this._findRun(need);
      if (!run) {
        return this._fail(r, REASON.FRAG, 'Reddedildi: toplam ' + this.freeCount + ' boş blok var ama en büyük ardışık boşluk ' +
          (L ? this.largestFreeRun() : 0) + ' blok; ' + need + ' ardışık blok bulunamadı (dış parçalanma).');
      }
      s = run[0];
      for (i = 0; i < need; i++) { this._take(s + i, f, 1); f.data.push(s + i); r.allocated.push(s + i); }
      if (L) L.push(this._runText(run) + '; ' + (need === 1 ? 'dosya ' + s + ' numaralı bloğa yerleştirildi.' : need + ' blok ' + span(s, s + need - 1) + ' aralığına yerleştirildi.'));
      if (L) L.push('Dizin girdisi: (başlangıç=' + s + ', uzunluk=' + need + ').');
      return true;
    }

    if (L) L.push('"' + f.id + '": yeni boyut ' + newSize + ' bayt → ' + need + ' blok; ' + add + ' ek blok gerekiyor.');
    if (add === 0) {
      if (L) L.push('Son bloktaki boş alan yeterli; yeni blok ayrılmadı.');
      return true;
    }
    var start = f.data[0], end = start + cur - 1;
    var room = 0;
    while (room < add && end + 1 + room < N && o[end + 1 + room] === -1) room++;
    if (room === add) {
      for (i = 1; i <= add; i++) { this._take(end + i, f, 1); f.data.push(end + i); r.allocated.push(end + i); }
      this.stats.inPlaceGrowths++;
      if (L) L.push('Dosyanın hemen ardındaki ' + span(end + 1, end + add) + ' boş: dosya yerinde büyütüldü; yeni dizin girdisi (başlangıç=' + start + ', uzunluk=' + need + ').');
      return true;
    }
    if (add > this.freeCount) {
      return this._fail(r, REASON.NO_SPACE, 'Reddedildi: ' + add + ' ek blok gerekiyor, diskte yalnızca ' + this.freeCount + ' boş blok var.');
    }
    if (L) {
      if (end + 1 >= N) L.push('Dosya diskin son bloğunda bitiyor; yerinde büyütülemez, taşınması gerekir.');
      else if (room === 0) L.push('Dosyanın ardındaki ' + (end + 1) + ' numaralı blok dolu; yerinde büyütülemez, taşınması gerekir.');
      else L.push('Dosyanın ardında yalnızca ' + room + ' boş blok var (' + add + ' gerekli); yerinde büyütülemez, taşınması gerekir.');
    }
    run = this._findRun(need);
    if (!run) {
      return this._fail(r, REASON.FRAG, 'Reddedildi: dosyanın tamamı için ' + need + ' ardışık blok gerekiyor; toplam ' + this.freeCount +
        ' boş blok var ama en büyük boşluk ' + (L ? this.largestFreeRun() : 0) + ' blok (dış parçalanma).');
    }
    s = run[0];
    var old = f.data;
    f.data = [];
    for (i = 0; i < need; i++) { this._take(s + i, f, 1); f.data.push(s + i); r.allocated.push(s + i); }
    for (i = 0; i < old.length; i++) { this._release(old[i]); r.freed.push(old[i]); }
    r.moved = cur;
    r.relocated = true;
    this.stats.movedBlocks += cur;
    this.stats.relocations++;
    if (L) L.push(this._runText(run) + '; dosya taşındı: ' + cur + ' blok kopyalandı, yeni aralık ' + span(s, s + need - 1) +
      ', eski ' + span(start, end) + ' aralığı serbest bırakıldı.');
    return true;
  };

  AP._growLinked = function (f, newSize, r) {
    var per = this.payload, cur = f.data.length;
    var need = Math.ceil(newSize / per);
    var add = need - cur;
    var L = this.logOn ? r.log : null;
    var i, b;
    if (L) {
      var how = this.fat
        ? 'FAT çeşitlemesi: işaretçiler bellekteki tabloda, blok başına veri alanı ' + per + ' bayt'
        : 'blok başına veri alanı ' + this.B + ' − ' + this.P + ' = ' + per + ' bayt';
      if (cur === 0) L.push('"' + f.id + '": ' + newSize + ' bayt; ' + how + ' → ⌈' + newSize + '/' + per + '⌉ = ' + need + ' blok gerekiyor.');
      else L.push('"' + f.id + '": yeni boyut ' + newSize + ' bayt; ' + how + ' → ' + need + ' blok; ' + add + ' ek blok gerekiyor.');
    }
    if (add === 0) {
      if (L) L.push('Son bloktaki boş alan yeterli; yeni blok ayrılmadı.');
      return true;
    }
    if (add > this.freeCount) {
      return this._fail(r, REASON.NO_SPACE, 'Reddedildi: ' + add + ' blok gerekiyor, diskte yalnızca ' + this.freeCount + ' boş blok var.');
    }
    var oldLast = cur ? f.data[cur - 1] : -1;
    for (i = 0; i < add; i++) { b = this._takeLowest(f, 1); f.data.push(b); r.allocated.push(b); }
    if (L) {
      L.push('En düşük numaralı ' + add + ' boş blok alındı: ' + listStr(r.allocated, 8) + '.');
      var where = this.fat ? 'FAT girdileri güncellendi' : 'Blok içi işaretçiler yazıldı';
      if (cur === 0) {
        L.push(where + ': ' + chainStr(f.data, 10) + ' (zincir sonu); dizin girdisi (ilk=' + f.data[0] + ', son=' + f.data[need - 1] + ').');
      } else {
        L.push(where + ': eski son blok ' + oldLast + ' artık ' + r.allocated[0] + ' numaralı bloğu gösteriyor; dizin girdisinde son=' + f.data[need - 1] + '.');
      }
    }
    return true;
  };

  AP.indexBlocksFor = function (n) {
    if (n <= this.K) return 1;
    return Math.ceil((n - 1) / (this.K - 1));
  };
  AP._idxOf = function (f, i) {
    return Math.min(Math.floor(i / (this.K - 1)), f.meta.length - 1);
  };

  AP._growIndexed = function (f, newSize, r) {
    var B = this.B, cur = f.data.length;
    var need = Math.ceil(newSize / B);
    var add = need - cur;
    var idxNeed = this.indexBlocksFor(need);
    var addIdx = idxNeed - f.meta.length;
    var L = this.logOn ? r.log : null;
    var k, b;
    if (L) {
      if (cur === 0) L.push('"' + f.id + '": ' + newSize + ' bayt → ' + need + ' veri bloğu + ' + idxNeed + ' indeks bloğu gerekiyor.');
      else L.push('"' + f.id + '": yeni boyut ' + newSize + ' bayt → ' + need + ' veri bloğu; ' + add + ' ek veri bloğu' +
        (addIdx > 0 ? ' ve ' + addIdx + ' ek indeks bloğu' : '') + ' gerekiyor.');
    }
    if (add === 0) {
      if (L) L.push('Son bloktaki boş alan yeterli; yeni blok ayrılmadı.');
      return true;
    }
    if (add > this.freeCount) {
      return this._fail(r, REASON.NO_SPACE, 'Reddedildi: ' + add + ' veri bloğu gerekiyor, diskte yalnızca ' + this.freeCount + ' boş blok var.');
    }
    if (add + addIdx > this.freeCount) {
      return this._fail(r, REASON.META, 'Reddedildi: ' + add + ' veri bloğu sığıyor ama ' + addIdx + ' indeks bloğu için yer kalmıyor (' +
        this.freeCount + ' boş blok var).');
    }
    for (k = cur; k < need; k++) {
      if (this.indexBlocksFor(k + 1) > f.meta.length) {
        b = this._takeLowest(f, 2);
        f.meta.push(b);
        r.metaAllocated.push(b);
        if (L) {
          if (f.meta.length === 1) L.push('İndeks bloğu olarak en düşük numaralı boş blok ' + b + ' ayrıldı.');
          else L.push('İndeks bloğu doldu (' + this.K + ' adres): ' + b + ' numaralı blok zincire ' + f.meta.length +
            '. indeks bloğu olarak eklendi; önceki indeks bloğunun son girdisi artık onu gösteriyor, o girdideki veri adresi yeni indeks bloğuna taşındı.');
        }
      }
      b = this._takeLowest(f, 1);
      f.data.push(b);
      r.allocated.push(b);
    }
    if (L) L.push('Veri blokları en düşük numaralı boş bloklardan alındı: ' + listStr(r.allocated, 8) +
      '; adresleri ' + (f.meta.length > 1 ? 'indeks bloklarına' : 'indeks bloğuna') + ' yazıldı (girdi ' + span(cur, need - 1) + ').');
    return true;
  };

  AP._treeNeed = function (e) {
    if (e <= this.inodeExtents) return { leaves: 0, nodes: 0 };
    var leaves = Math.ceil(e / this.fanout);
    var nodes = leaves <= this.inodeExtents ? 0 : Math.ceil(leaves / this.fanout);
    if (nodes > this.inodeExtents) throw new Error('Extent ağacı derinliği 2\'yi aşıyor; model bunu desteklemiyor');
    return { leaves: leaves, nodes: nodes };
  };

  AP._growExtent = function (f, newSize, r) {
    var B = this.B, N = this.N, o = this.owner;
    var cur = f.data.length;
    var need = Math.ceil(newSize / B);
    var add = need - cur;
    var L = this.logOn ? r.log : null;
    var i, k, b;
    if (L) {
      if (cur === 0) L.push('"' + f.id + '": ' + newSize + ' bayt → ⌈' + newSize + '/' + B + '⌉ = ' + need + ' blok gerekiyor.');
      else L.push('"' + f.id + '": yeni boyut ' + newSize + ' bayt → ' + need + ' blok; ' + add + ' ek blok gerekiyor.');
    }
    if (add === 0) {
      if (L) L.push('Son bloktaki boş alan yeterli; yeni blok ayrılmadı.');
      return true;
    }
    if (add > this.freeCount) {
      return this._fail(r, REASON.NO_SPACE, 'Reddedildi: ' + add + ' blok gerekiyor, diskte yalnızca ' + this.freeCount + ' boş blok var.');
    }

    var rem = add, grown = 0, tail = -1;
    if (cur > 0) {
      var last = f.extents[f.extents.length - 1];
      tail = last[0] + last[1];
      b = tail;
      while (grown < rem && b < N && o[b] === -1) { grown++; b++; }
      rem -= grown;
    }
    var plan = [];
    var single = null;
    if (rem > 0) {
      var runs = this.freeRuns();
      if (grown > 0) runs = runs.filter(function (x) { return x[0] !== tail; });
      for (i = 0; i < runs.length; i++) { if (runs[i][1] >= rem) { single = runs[i]; break; } }
      if (single) {
        plan.push([single[0], rem]);
      } else {
        var sorted = runs.slice().sort(function (x, y) { return y[1] - x[1] || x[0] - y[0]; });
        var left = rem;
        for (i = 0; i < sorted.length && left > 0; i++) {
          var t = Math.min(sorted[i][1], left);
          plan.push([sorted[i][0], t]);
          left -= t;
        }
      }
    }
    var eNew = f.extents.length + plan.length;
    var tn = this._treeNeed(eNew);
    var addLeaves = tn.leaves - f.leaves.length;
    var addNodes = tn.nodes - f.inodes.length;
    var addTree = addLeaves + addNodes;
    if (add + addTree > this.freeCount) {
      return this._fail(r, REASON.META, 'Reddedildi: ' + add + ' veri bloğu sığıyor ama ' + eNew + ' extent için gereken ' + addTree +
        ' extent ağacı bloğuna yer kalmıyor (' + this.freeCount + ' boş blok var).');
    }

    if (grown > 0) {
      var le = f.extents[f.extents.length - 1];
      for (i = 0; i < grown; i++) { this._take(tail + i, f, 1); f.data.push(tail + i); r.allocated.push(tail + i); }
      le[1] += grown;
      this.stats.inPlaceGrowths++;
      if (L) L.push('Son extent\'in hemen ardındaki ' + span(tail, tail + grown - 1) + ' boş: son extent yerinde büyütüldü → (başlangıç=' +
        le[0] + ', uzunluk=' + le[1] + ').' + (rem > 0 ? ' Kalan ' + rem + ' blok için yeni extent gerekiyor.' : ''));
    } else if (L && cur > 0) {
      L.push(tail >= N ? 'Son extent diskin sonunda bitiyor; yerinde büyütülemez.'
        : 'Son extent\'in ardındaki ' + tail + ' numaralı blok dolu; yerinde büyütülemez.');
    }
    if (L && rem > 0) {
      if (single) {
        L.push('İlk uygun (first-fit): ' + runStr(single[0], single[1]) +
          ' ilk yeterli boşluk bulundu; tek extent (başlangıç=' + single[0] + ', uzunluk=' + rem + ') oluşturuldu.');
      } else {
        L.push(rem + ' blokluk tek bir boşluk yok; en büyük boşluklar sırayla alınıyor (' + plan.length + ' extent).');
      }
    }
    for (k = 0; k < plan.length; k++) {
      var st = plan[k][0], ln = plan[k][1];
      for (i = 0; i < ln; i++) { this._take(st + i, f, 1); f.data.push(st + i); r.allocated.push(st + i); }
      f.extents.push([st, ln]);
      if (L && !single) {
        if (k < 6) L.push('Extent ' + f.extents.length + ': en büyük boşluktan ' + span(st, st + ln - 1) + ' alındı (uzunluk=' + ln + ').');
        else if (k === 6) L.push('… kalan ' + (plan.length - 6) + ' extent aynı kuralla alındı.');
      }
    }
    for (k = 0; k < addLeaves; k++) { b = this._takeLowest(f, 2); f.leaves.push(b); r.metaAllocated.push(b); }
    for (k = 0; k < addNodes; k++) { b = this._takeLowest(f, 2); f.inodes.push(b); r.metaAllocated.push(b); }
    if (L && addTree > 0) {
      L.push('Extent sayısı ' + eNew + ' oldu (inode en çok ' + this.inodeExtents + ' extent tutar): extent ağacı için ' +
        listStr(r.metaAllocated, 6) + ' numaralı blok ayrıldı (blok başına ' + this.fanout + ' extent).');
    }
    return true;
  };

  AP.blocksOf = function (id) { return this._file(id).data.slice(); };

  AP._metaCount = function (f) { return f.meta.length + f.leaves.length + f.inodes.length; };

  AP.metaBlocksOf = function (id) {
    var f = this._file(id);
    return f.meta.concat(f.leaves, f.inodes);
  };

  AP._extentIndexOf = function (f, i) {
    var acc = 0;
    for (var k = 0; k < f.extents.length; k++) {
      acc += f.extents[k][1];
      if (i < acc) return k;
    }
    return f.extents.length - 1;
  };

  AP.accessPath = function (id, i) {
    var f = this._file(id);
    if (!(Number.isInteger(i) && i >= 0 && i < f.data.length)) {
      throw new RangeError('Mantıksal blok aralık dışında: ' + i);
    }
    switch (this.method) {
      case 'contiguous':
        return [f.data[i]];
      case 'linked':
        return this.fat ? [f.data[i]] : f.data.slice(0, i + 1);
      case 'indexed': {
        var j = this._idxOf(f, i);
        var p = f.meta.slice(0, j + 1);
        p.push(f.data[i]);
        return p;
      }
      default: {
        if (f.extents.length <= this.inodeExtents) return [f.data[i]];
        var k = this._extentIndexOf(f, i);
        var leaf = Math.floor(k / this.fanout);
        var path = [];
        if (f.inodes.length) path.push(f.inodes[Math.floor(leaf / this.fanout)]);
        path.push(f.leaves[leaf]);
        path.push(f.data[i]);
        return path;
      }
    }
  };

  AP._pathLen = function (f, i) {
    switch (this.method) {
      case 'contiguous': return 1;
      case 'linked': return this.fat ? 1 : i + 1;
      case 'indexed': return this._idxOf(f, i) + 2;
      default:
        if (f.extents.length <= this.inodeExtents) return 1;
        return f.inodes.length ? 3 : 2;
    }
  };

  AP._seqPath = function (f) {
    var out, i, k;
    switch (this.method) {
      case 'contiguous':
      case 'linked':
        return f.data.slice();
      case 'indexed': {
        out = [];
        var lastJ = -1;
        for (i = 0; i < f.data.length; i++) {
          var j = this._idxOf(f, i);
          while (lastJ < j) { lastJ++; out.push(f.meta[lastJ]); }
          out.push(f.data[i]);
        }
        return out;
      }
      default: {
        if (f.extents.length <= this.inodeExtents) return f.data.slice();
        out = [];
        var lastLeaf = -1, lastNode = -1;
        for (k = 0; k < f.extents.length; k++) {
          var leaf = Math.floor(k / this.fanout);
          var node = Math.floor(leaf / this.fanout);
          if (f.inodes.length && node !== lastNode) { out.push(f.inodes[node]); lastNode = node; }
          if (leaf !== lastLeaf) { out.push(f.leaves[leaf]); lastLeaf = leaf; }
          for (i = 0; i < f.extents[k][1]; i++) out.push(f.extents[k][0] + i);
        }
        return out;
      }
    }
  };
  AP.seqPath = function (id) { return this._seqPath(this._file(id)); };

  function seqCostOfPath(p) {
    var seeks = 0, dist = 0;
    for (var k = 1; k < p.length; k++) {
      if (p[k] !== p[k - 1] + 1) { seeks++; dist += Math.abs(p[k] - p[k - 1]); }
    }
    return { reads: p.length, seeks: seeks, seekDistance: dist, cost: p.length + seeks };
  }
  AP.seqCost = function (id) { return seqCostOfPath(this.seqPath(id)); };

  function fragmentsOfBlocks(d) {
    if (d.length === 0) return 0;
    var c = 1;
    for (var i = 1; i < d.length; i++) if (d[i] !== d[i - 1] + 1) c++;
    return c;
  }
  AP.fragmentsOf = function (id) { return fragmentsOfBlocks(this._file(id).data); };

  AP.fileInfo = function (id) {
    var f = this._file(id);
    return {
      id: id, size: f.size, dataBlocks: f.data.length, metaBlocks: this._metaCount(f),
      fragments: fragmentsOfBlocks(f.data),
      first: f.data[0], last: f.data[f.data.length - 1]
    };
  };

  AP.structureOf = function (id) {
    var f = this._file(id), i, k;
    if (this.method === 'contiguous') {
      return { type: 'contiguous', id: id, size: f.size, start: f.data[0], length: f.data.length };
    }
    if (this.method === 'linked') {
      var chain = [];
      for (i = 0; i < f.data.length; i++) chain.push({ block: f.data[i], next: i + 1 < f.data.length ? f.data[i + 1] : null });
      return { type: 'linked', fat: this.fat, id: id, size: f.size, first: f.data[0], last: f.data[f.data.length - 1], length: f.data.length, chain: chain };
    }
    if (this.method === 'indexed') {
      var blocks = [];
      for (k = 0; k < f.meta.length; k++) {
        var isLast = k === f.meta.length - 1;
        var from = k * (this.K - 1);
        var to = isLast ? f.data.length : from + this.K - 1;
        blocks.push({
          block: f.meta[k], firstLogical: from, entries: f.data.slice(from, to),
          next: isLast ? null : f.meta[k + 1], capacity: this.K
        });
      }
      return { type: 'indexed', id: id, size: f.size, length: f.data.length, indexBlocks: blocks };
    }
    var ext = [], acc = 0;
    for (k = 0; k < f.extents.length; k++) {
      ext.push({ start: f.extents[k][0], length: f.extents[k][1], logicalStart: acc });
      acc += f.extents[k][1];
    }
    return {
      type: 'extent', id: id, size: f.size, length: f.data.length, extents: ext,
      inInode: f.extents.length <= this.inodeExtents, inodeCapacity: this.inodeExtents,
      leaves: f.leaves.slice(), nodes: f.inodes.slice(), fanout: this.fanout
    };
  };

  AP.ownerOf = function (b) {
    var h = this.owner[b];
    return h === -1 || h === undefined ? null : this._byHandle.get(h).id;
  };
  AP.kindOf = function (b) { return this.kind[b]; };

  AP.blockInfo = function (b) {
    if (!(b >= 0 && b < this.N)) return null;
    if (this.owner[b] === -1) return { free: true };
    var f = this._byHandle.get(this.owner[b]);
    if (this.kind[b] === 1) return { free: false, id: f.id, kind: 'data', logical: f.data.indexOf(b) };
    var role = 'indeks bloğu', ord = f.meta.indexOf(b);
    if (ord < 0) {
      ord = f.leaves.indexOf(b);
      role = 'extent ağacı yaprağı';
      if (ord < 0) { ord = f.inodes.indexOf(b); role = 'extent ağacı ara düğümü'; }
    }
    return { free: false, id: f.id, kind: 'meta', role: role, ordinal: ord };
  };

  AP.metrics = function () {
    var N = this.N, B = this.B, self = this;
    var runs = this.freeRuns();
    var largest = 0, i;
    for (i = 0; i < runs.length; i++) if (runs[i][1] > largest) largest = runs[i][1];
    var free = this.freeCount;
    var fileCount = 0, dataBlocks = 0, metaBlocks = 0, fragSum = 0, fragMax = 0;
    var reads = 0, seeks = 0, seekDist = 0, raSum = 0, slack = 0, bytes = 0;
    this.files.forEach(function (f) {
      var n = f.data.length;
      fileCount++;
      dataBlocks += n;
      metaBlocks += self._metaCount(f);
      var fr = fragmentsOfBlocks(f.data);
      fragSum += fr;
      if (fr > fragMax) fragMax = fr;
      var c = seqCostOfPath(self._seqPath(f));
      reads += c.reads; seeks += c.seeks; seekDist += c.seekDistance;
      for (var k = 0; k < n; k++) raSum += self._pathLen(f, k);
      slack += n * self.payload - f.size;
      bytes += f.size;
    });
    var pointerBytes = (this.method === 'linked' && !this.fat) ? dataBlocks * this.P : 0;
    var tableBytes = this.fat ? N * this.P : 0;
    var metaBytes = metaBlocks * B + pointerBytes + tableBytes;
    var s = this.stats;
    return {
      N: N,
      usedBlocks: N - free,
      freeBlocks: free,
      utilization: (N - free) / N,
      freeRuns: runs.length,
      largestFreeRun: largest,
      extFragIndex: free === 0 ? 0 : 1 - largest / free,
      fileCount: fileCount,
      dataBlocks: dataBlocks,
      metaBlocks: metaBlocks,
      fileBytes: bytes,
      pointerBytes: pointerBytes,
      tableBytes: tableBytes,
      metaBytes: metaBytes,
      metaOverhead: metaBytes / (N * B),
      internalWaste: slack / (N * B),
      meanFragments: fileCount ? fragSum / fileCount : 0,
      maxFragments: fragMax,
      seqReads: reads,
      seqSeeks: seeks,
      seqCostMean: fileCount ? (reads + seeks) / fileCount : 0,
      seqSeeksMean: fileCount ? seeks / fileCount : 0,
      seqCostPerBlock: dataBlocks ? (reads + seeks) / dataBlocks : 0,
      meanSeekDistance: seeks ? seekDist / seeks : 0,
      randomAccessCost: dataBlocks ? raSum / dataBlocks : 0,
      movedBlocks: s.movedBlocks,
      relocations: s.relocations,
      failedCreates: s.createFail,
      failedExtends: s.extendFail,
      failedTotal: s.createFail + s.extendFail,
      fragFailures: s.failFrag,
      fragFailedCreates: s.fragCreateFail,
      fragFailedExtends: s.fragExtendFail,
      noSpaceFailures: s.failNoSpace,
      metaFailures: s.failMeta,
      skipped: s.skipped
    };
  };

  AP.checkInvariants = function () {
    var errs = [], N = this.N, seen = new Int32Array(N).fill(-1), self = this, used = 0, i;
    this.files.forEach(function (f) {
      var all = f.data.concat(f.meta, f.leaves, f.inodes);
      for (var k = 0; k < all.length; k++) {
        var b = all[k];
        if (!(b >= 0 && b < N)) { errs.push(f.id + ': aralık dışı blok ' + b); continue; }
        if (seen[b] !== -1) errs.push('blok ' + b + ' iki kez kullanılmış');
        seen[b] = f.h;
        if (self.owner[b] !== f.h) errs.push('blok ' + b + ' sahip tablosu ile uyuşmuyor');
        if (self.kind[b] !== (k < f.data.length ? 1 : 2)) errs.push('blok ' + b + ' tür tablosu ile uyuşmuyor');
      }
      used += all.length;
      if (f.data.length !== Math.ceil(f.size / self.payload)) errs.push(f.id + ': veri bloğu sayısı boyutla uyuşmuyor');
      if (self.method === 'contiguous' && fragmentsOfBlocks(f.data) !== 1) errs.push(f.id + ': bitişik dosya parçalı');
      if (self.method === 'indexed' && f.meta.length !== self.indexBlocksFor(f.data.length)) errs.push(f.id + ': indeks bloğu sayısı yanlış');
      if (self.method !== 'indexed' && f.meta.length !== 0) errs.push(f.id + ': beklenmeyen indeks bloğu');
      if (self.method === 'extent') {
        var flat = [];
        for (var e = 0; e < f.extents.length; e++) for (var q = 0; q < f.extents[e][1]; q++) flat.push(f.extents[e][0] + q);
        if (flat.length !== f.data.length || flat.some(function (x, ix) { return x !== f.data[ix]; })) errs.push(f.id + ': extent listesi veri bloklarıyla uyuşmuyor');
        if (f.extents.length !== fragmentsOfBlocks(f.data)) errs.push(f.id + ': birleştirilmemiş komşu extent var');
        var tn = self._treeNeed(f.extents.length);
        if (f.leaves.length !== tn.leaves || f.inodes.length !== tn.nodes) errs.push(f.id + ': extent ağacı blok sayısı yanlış');
      } else if (f.leaves.length || f.inodes.length) {
        errs.push(f.id + ': beklenmeyen extent ağacı bloğu');
      }
    });
    if (used !== N - this.freeCount) errs.push('boş blok sayacı tutarsız: ' + used + ' kullanılan, sayaç ' + (N - this.freeCount));
    for (i = 0; i < N; i++) {
      if ((this.owner[i] === -1) !== (seen[i] === -1)) { errs.push('blok ' + i + ' sahipsiz ama dolu ya da tersi'); break; }
    }
    return errs;
  };

  function createAllocator(opts) { return new Allocator(opts); }

  var DEFAULT_CLASSES = [
    { p: 0.70, min: 1, max: 8 },
    { p: 0.25, min: 9, max: 64 },
    { p: 0.05, min: 65, max: 400 }
  ];
  var DEFAULT_MIX = { create: 0.45, remove: 0.35, extend: 0.20 };

  function workloadPreset(N) {
    if (N <= 64) {
      return { classes: [{ p: 0.70, min: 1, max: 2 }, { p: 0.25, min: 3, max: 5 }, { p: 0.05, min: 6, max: 10 }], extendMax: 2, agingOps: 60 };
    }
    if (N <= 256) {
      return { classes: [{ p: 0.70, min: 1, max: 4 }, { p: 0.25, min: 5, max: 12 }, { p: 0.05, min: 13, max: 32 }], extendMax: 4, agingOps: 150 };
    }
    if (N <= 1024) {
      return { classes: [{ p: 0.70, min: 1, max: 8 }, { p: 0.25, min: 9, max: 32 }, { p: 0.05, min: 33, max: 100 }], extendMax: 16, agingOps: 300 };
    }
    return { classes: DEFAULT_CLASSES, extendMax: 32, agingOps: 5000 };
  }

  function generateTrace(o) {
    var N = o.N, B = o.B == null ? DEFAULTS.B : o.B, u = o.u, seed = o.seed;
    var agingOps = o.agingOps == null ? 5000 : o.agingOps;
    var classes = o.classes || DEFAULT_CLASSES;
    var extendMax = o.extendMax == null ? 32 : o.extendMax;
    var band = o.band == null ? 0.05 : o.band;
    var mix = o.mix || DEFAULT_MIX;
    var prefix = o.idPrefix == null ? 'd' : o.idPrefix;
    var rnd = mulberry32(seed);
    function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
    function drawBlocks() {
      var x = rnd(), acc = 0;
      for (var c = 0; c < classes.length; c++) {
        acc += classes[c].p;
        if (x < acc) return ri(classes[c].min, classes[c].max);
      }
      var z = classes[classes.length - 1];
      return ri(z.min, z.max);
    }
    function tailBytes(blocks) { return (blocks - 1) * B + ri(1, B); }

    var ops = [], live = [], bytesOf = new Map(), refBlocks = 0, nextId = 1;
    var st = { creates: 0, deletes: 0, extends: 0, forcedDeletes: 0, forcedCreates: 0, capacityForced: 0, phase1Ops: 0, peakRefUtil: 0 };

    function doCreate(k, phase) {
      var id = prefix + (nextId++);
      var bytes = tailBytes(k);
      ops.push({ op: 'create', id: id, bytes: bytes, phase: phase });
      bytesOf.set(id, bytes);
      live.push(id);
      refBlocks += k;
      st.creates++;
    }
    function doDelete(phase) {
      var idx = ri(0, live.length - 1);
      var id = live[idx];
      live[idx] = live[live.length - 1];
      live.pop();
      refBlocks -= Math.ceil(bytesOf.get(id) / B);
      bytesOf.delete(id);
      ops.push({ op: 'delete', id: id, phase: phase });
      st.deletes++;
    }
    function track() { var x = refBlocks / N; if (x > st.peakRefUtil) st.peakRefUtil = x; }

    var target = Math.round(u * N);
    while (refBlocks < target) {
      var k1 = drawBlocks();
      if (k1 > target - refBlocks) k1 = target - refBlocks;
      doCreate(k1, 1);
      track();
    }
    st.phase1Ops = ops.length;

    for (var t = 0; t < agingOps; t++) {
      var util = refBlocks / N;
      var x = rnd();
      var kind;
      if (live.length === 0 || util < u - band) {
        kind = 'create';
        st.forcedCreates++;
      } else if (util > u + band) {
        kind = 'delete';
        st.forcedDeletes++;
      } else {
        kind = x < mix.create ? 'create' : (x < mix.create + mix.remove ? 'delete' : 'extend');
      }
      if (kind === 'create') {
        var k2 = drawBlocks();
        if (refBlocks + k2 > N) {
          if (live.length === 0) continue;
          st.capacityForced++;
          doDelete(2);
        } else {
          doCreate(k2, 2);
        }
      } else if (kind === 'extend') {
        var idx = ri(0, live.length - 1);
        var grow = ri(1, extendMax);
        if (refBlocks + grow > N) {
          st.capacityForced++;
          doDelete(2);
        } else {
          var id = live[idx];
          var oldBytes = bytesOf.get(id);
          var oldBlocks = Math.ceil(oldBytes / B);
          var newBytes = tailBytes(oldBlocks + grow);
          ops.push({ op: 'extend', id: id, bytes: newBytes - oldBytes, phase: 2 });
          bytesOf.set(id, newBytes);
          refBlocks += grow;
          st.extends++;
        }
      } else {
        doDelete(2);
      }
      track();
    }
    st.finalRefUtil = refBlocks / N;
    st.finalLiveFiles = live.length;
    st.totalOps = ops.length;
    return {
      params: { N: N, B: B, u: u, seed: seed, agingOps: agingOps, classes: classes, extendMax: extendMax, band: band, mix: mix },
      ops: ops,
      stats: st
    };
  }

  function applyOp(alloc, op) {
    if (op.op === 'create') return alloc.create(op.id, op.bytes);
    if (!alloc.has(op.id)) {
      alloc.stats.skipped++;
      var r = alloc._res(op.op === 'delete' ? 'remove' : op.op, op.id);
      r.skipped = true;
      r.reason = REASON.MISSING;
      if (alloc.logOn) r.log.push('"' + op.id + '" bu yöntemde yok (oluşturma isteği reddedilmişti); işlem atlandı.');
      return r;
    }
    if (op.op === 'delete' || op.op === 'remove') return alloc.remove(op.id);
    if (op.op === 'extend') return alloc.extend(op.id, op.bytes);
    throw new Error('Bilinmeyen işlem: ' + op.op);
  }

  function runTrace(alloc, trace) {
    var ops = trace.ops || trace;
    for (var i = 0; i < ops.length; i++) applyOp(alloc, ops[i]);
    return alloc;
  }

  return {
    VERSION: VERSION,
    METHODS: METHODS,
    VARIANT_KEYS: VARIANT_KEYS,
    LABELS: LABELS,
    DEFAULTS: DEFAULTS,
    REASON: REASON,
    DEFAULT_CLASSES: DEFAULT_CLASSES,
    DEFAULT_MIX: DEFAULT_MIX,
    Allocator: Allocator,
    createAllocator: createAllocator,
    mulberry32: mulberry32,
    generateTrace: generateTrace,
    workloadPreset: workloadPreset,
    applyOp: applyOp,
    runTrace: runTrace,
    seqCostOfPath: seqCostOfPath,
    fragmentsOfBlocks: fragmentsOfBlocks,
    toRanges: toRanges,
    span: span
  };
});
