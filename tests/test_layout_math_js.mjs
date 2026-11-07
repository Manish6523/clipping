import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { calculateLayerGeometry } from '../frontend/src/utils/layoutMath.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const vPath = path.resolve(__dirname, '../shared/layout_vectors.json');
const vectorData = JSON.parse(fs.readFileSync(vPath, 'utf-8'));

console.log('Testing JS layoutMath against golden vectors...');
for (const v of vectorData.vectors) {
  const actual = calculateLayerGeometry(
    v.layer,
    v.src_w,
    v.src_h,
    v.canvas.w,
    v.canvas.h
  );
  const exp = v.expected;
  assert.deepStrictEqual(actual.src_crop, exp.src_crop, `${v.name} src_crop mismatch`);
  assert.deepStrictEqual(actual.dst_rect, exp.dst_rect, `${v.name} dst_rect mismatch`);
  assert.deepStrictEqual(actual.scale_size, exp.scale_size, `${v.name} scale_size mismatch`);

  if (exp.inner_crop) {
    assert.deepStrictEqual(actual.inner_crop, exp.inner_crop, `${v.name} inner_crop mismatch`);
  }
  if (exp.letterbox_offset) {
    assert.deepStrictEqual(actual.letterbox_offset, exp.letterbox_offset, `${v.name} letterbox_offset mismatch`);
  }
  console.log(`✓ ${v.name}`);
}
console.log('All JS golden vector tests passed!');

