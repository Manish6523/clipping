import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { captionGeometry } from '../frontend/src/utils/captionGeometry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const vectorsPath = path.join(__dirname, '../shared/caption_vectors.json');
const vectors = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));

console.log('Testing JS captionGeometry against golden vectors...');

for (const tc of vectors.test_cases) {
  const res = captionGeometry(
    tc.input.pos_x,
    tc.input.pos_y,
    tc.input.max_w,
    tc.input.canvas_w,
    tc.input.canvas_h
  );

  for (const [key, val] of Object.entries(tc.expected)) {
    if (res[key] !== val) {
      console.error(`FAIL: ${tc.name} field ${key}: expected ${val}, got ${res[key]}`);
      process.exit(1);
    }
  }
  console.log(`✓ ${tc.name}`);
}

console.log('All JS caption golden vector tests passed!');

