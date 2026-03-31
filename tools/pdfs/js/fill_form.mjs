import fs from 'fs';
import { PDFDocument } from 'pdf-lib';

function usage() {
  console.error('Usage (positional): node fill_form.mjs <input.pdf> <values.json> <output.pdf> [--flatten]');
  console.error('Usage (flags):      node fill_form.mjs --input in.pdf --values values.json --output out.pdf [--flatten]');
  process.exit(2);
}

function parseArgs(argv) {
  const out = { input: null, values: null, output: null, flatten: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') usage();
    if (a === '--flatten') { out.flatten = true; continue; }
    if (a === '--input' || a === '-i') { out.input = argv[++i]; continue; }
    if (a === '--values' || a === '--fields' || a === '-v') { out.values = argv[++i]; continue; }
    if (a === '--output' || a === '-o') { out.output = argv[++i]; continue; }
    // Unknown flag: ignore, but allow positional fallback.
  }
  // Positional fallback
  if (!out.input && argv[2] && !String(argv[2]).startsWith('-')) out.input = argv[2];
  if (!out.values && argv[3] && !String(argv[3]).startsWith('-')) out.values = argv[3];
  if (!out.output && argv[4] && !String(argv[4]).startsWith('-')) out.output = argv[4];
  return out;
}

const args = parseArgs(process.argv);
const input = args.input;
const valuesPath = args.values;
const output = args.output;
const flatten = args.flatten;

if (!input || !valuesPath || !output) usage();

const values = JSON.parse(fs.readFileSync(valuesPath, 'utf8'));
const bytes = fs.readFileSync(input);
const pdfDoc = await PDFDocument.load(bytes);
const form = pdfDoc.getForm();

for (const [key, val] of Object.entries(values)) {
  let field;
  try {
    field = form.getField(key);
  } catch {
    console.error(`[WARN] Field not found: ${key}`);
    continue;
  }

  const fieldType = field.constructor?.name || '';
  try {
    if (fieldType === 'PDFTextField') {
      field.setText(String(val));
    } else if (fieldType === 'PDFCheckBox') {
      if (val) field.check();
      else field.uncheck();
    } else if (fieldType === 'PDFDropdown' || fieldType === 'PDFOptionList') {
      field.select(String(val));
    } else if (fieldType === 'PDFRadioGroup') {
      field.select(String(val));
    } else {
      // Best-effort fallback
      if (typeof field.setText === 'function') field.setText(String(val));
      else console.error(`[WARN] Unsupported field type for ${key}: ${fieldType}`);
    }
  } catch (e) {
    console.error(`[WARN] Failed to set ${key} (${fieldType}): ${e}`);
  }
}

if (flatten) {
  form.flatten();
}

const outBytes = await pdfDoc.save();
fs.writeFileSync(output, outBytes);
console.log(`[OK] wrote ${output}`);
