import fs from 'fs';
import { PDFDocument } from 'pdf-lib';

function usage() {
  console.error('Usage (positional): node extract_form_fields.mjs <input.pdf>');
  console.error('Usage (flags):      node extract_form_fields.mjs --input in.pdf');
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

const bytes = fs.readFileSync(input);
const pdfDoc = await PDFDocument.load(bytes);
let form;
try {
  form = pdfDoc.getForm();
} catch {
  console.log('No AcroForm found.');
  process.exit(0);
}

const fields = form.getFields();
if (fields.length === 0) {
  console.log('No form fields found.');
  process.exit(0);
}

for (const f of fields) {
  const type = f.constructor?.name || 'Field';
  const name = f.getName();
  console.log(`${name}\t${type}`);
}
