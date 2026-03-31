import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

function usage() {
  console.error('Usage (positional): node extract_text_pdfjs.mjs <input.pdf>');
  console.error('Usage (flags):      node extract_text_pdfjs.mjs --input in.pdf');
  process.exit(2);
}

function parseArgs(argv) {
  const out = { input: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') usage();
    if (a === '--input' || a === '-i') { out.input = argv[++i]; continue; }
  }
  if (!out.input && argv[2] && !String(argv[2]).startsWith('-')) out.input = argv[2];
  return out;
}

const args = parseArgs(process.argv);
const input = args.input;
if (!input) usage();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const standardFontDataUrl = path.join(__dirname, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;

const data = new Uint8Array(fs.readFileSync(input));
const loadingTask = pdfjs.getDocument({ data, standardFontDataUrl });
const doc = await loadingTask.promise;

let out = '';
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const tc = await page.getTextContent();
  out += tc.items.map(it => it.str).join(' ') + '\n\n';
}

process.stdout.write(out);
