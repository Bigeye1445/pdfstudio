import createQpdfModule from '../src/wasm/qpdf.js';

// Minimal valid n-page PDF, built by hand.
function makePdf(pages = 3) {
  const objs = [];
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(' ');
  objs.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  objs.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages} >>\nendobj\n`);
  for (let i = 0; i < pages; i++) {
    objs.push(`${3 + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n`);
  }
  let body = '%PDF-1.7\n';
  const offsets = [];
  for (const o of objs) {
    offsets.push(body.length);
    body += o;
  }
  const xrefPos = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

let out = [], err = [];
const mod = await createQpdfModule({
  print: (t) => out.push(t),
  printErr: (t) => err.push(t),
});

function run(args) {
  out = []; err = [];
  let code;
  try {
    code = mod.callMain(args);
  } catch (e) {
    if (e && e.name === 'ExitStatus') code = e.status;
    else throw e;
  }
  return { code, out: out.join('\n'), err: err.join('\n') };
}

console.log('version:', JSON.stringify(run(['--version'])));

mod.FS.mkdir('/w');
mod.FS.writeFile('/w/a.pdf', makePdf(3));

console.log('check:', JSON.stringify(run(['--check', '/w/a.pdf'])).slice(0, 200));
console.log('npages:', JSON.stringify(run(['--show-npages', '/w/a.pdf'])));

// encrypt
console.log('encrypt:', JSON.stringify(run(['--encrypt', '--user-password=secret', '--owner-password=owner', '--bits=256', '--', '/w/a.pdf', '/w/enc.pdf'])));
console.log('is-encrypted(enc):', JSON.stringify(run(['--is-encrypted', '/w/enc.pdf'])));
console.log('is-encrypted(plain):', JSON.stringify(run(['--is-encrypted', '/w/a.pdf'])));

// wrong password
console.log('wrong-pw:', JSON.stringify(run(['--password=nope', '--decrypt', '/w/enc.pdf', '/w/dec.pdf'])));
// right password
console.log('decrypt:', JSON.stringify(run(['--password=secret', '--decrypt', '/w/enc.pdf', '/w/dec.pdf'])));
console.log('npages(dec):', JSON.stringify(run(['--show-npages', '/w/dec.pdf'])));

// merge
mod.FS.writeFile('/w/b.pdf', makePdf(2));
console.log('merge:', JSON.stringify(run(['--empty', '--pages', '/w/a.pdf', '1-z', '/w/b.pdf', '1-z', '--', '/w/m.pdf'])));
console.log('npages(m):', JSON.stringify(run(['--show-npages', '/w/m.pdf'])));

// split
console.log('split:', JSON.stringify(run(['--split-pages=1', '/w/m.pdf', '/w/split-%d.pdf'])));
console.log('files:', mod.FS.readdir('/w').filter((f) => f.startsWith('split-')));

// rotate
console.log('rotate:', JSON.stringify(run(['--rotate=+90', '/w/a.pdf', '/w/rot.pdf'])));
console.log('rotated has /Rotate 90:', new TextDecoder('latin1').decode(mod.FS.readFile('/w/rot.pdf')).includes('/Rotate 90'));
