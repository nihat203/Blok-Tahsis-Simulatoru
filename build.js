'use strict';
const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, 'simulator.src.html');
const corePath = path.join(__dirname, 'sim-core.js');
const outPath = path.join(__dirname, 'simulator.html');

const src = fs.readFileSync(srcPath, 'utf8');
const core = fs.readFileSync(corePath, 'utf8');

const marker = /<!-- BUILD:CORE -->[\s\S]*?<!-- \/BUILD:CORE -->/;
if (!marker.test(src)) {
  console.error('HATA: simulator.src.html içinde BUILD:CORE işaretleri bulunamadı.');
  process.exit(1);
}
if (/<\/script/i.test(core)) {
  console.error('HATA: sim-core.js içinde "</script" geçiyor; satır içine gömülemez.');
  process.exit(1);
}

const inlined = '<script>\n' + core + '\n</script>';
const out = src.replace(marker, () => inlined);

if (/<script[^>]*\ssrc=/i.test(out)) {
  console.error('HATA: çıktıda hâlâ dış betik başvurusu var.');
  process.exit(1);
}
fs.writeFileSync(outPath, out, 'utf8');
console.log('simulator.html yazıldı (' + Buffer.byteLength(out, 'utf8') + ' bayt, sim-core.js gömülü).');
