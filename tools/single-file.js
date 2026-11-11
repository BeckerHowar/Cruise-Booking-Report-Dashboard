/* Packs the dashboard into one self-contained HTML fragment for hosts that take a single
   page and supply their own document shell. Scripts are inlined, and the controls that
   need a real browser window (print, copy link, file download) are hidden.

   node tools/single-file.js <output.html>                                              */
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = process.argv[2];
if (!out) { console.error('usage: node tools/single-file.js <output.html>'); process.exit(1); }

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const pick = (re, what) => { const m = html.match(re); if (!m) throw new Error('index.html: no ' + what); return m[1]; };

const themeScript = pick(/<head>[\s\S]*?(<script>[\s\S]*?<\/script>)/, 'theme script');
const style = pick(/(<style>[\s\S]*?<\/style>)/, 'style block');
let body = pick(/<body>([\s\S]*?)<\/body>/, 'body');

let scripts = 0;
body = body.replace(/<script src="([^"?]+)(?:\?[^"]*)?"><\/script>/g, (all, src) => {
  const js = fs.readFileSync(path.join(root, src), 'utf8');
  if (/<\/script/i.test(js)) throw new Error(src + ' contains a closing script tag');
  new Function(js);                                   // a syntax error stops the build here
  scripts++;
  return '<script>\n' + js + '\n</script>';
});
if (!scripts) throw new Error('index.html: no scripts found');

const extra = '<style>\n' +
  '  #linkBtn, #printBtn, [data-act^="csv:"] { display: none !important; }\n' +
  '  #cockpit { margin-bottom: env(safe-area-inset-bottom, 0px); }\n' +
  '</style>';

const page = '<title>Cruise Booking Report Dashboard</title>\n' + themeScript + '\n' + style + '\n' + extra + '\n' + body.trim() + '\n';
fs.writeFileSync(out, page);
console.log('wrote ' + out + ' · ' + scripts + ' scripts inlined · ' + Math.round(page.length / 1024) + ' KB');
