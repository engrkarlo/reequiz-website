import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modules = join(root, 'node_modules');
const output = join(root, 'public', 'ocr');

const assets = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ...['tesseract-core', 'tesseract-core-simd', 'tesseract-core-lstm', 'tesseract-core-simd-lstm']
    .flatMap(name => [
      [`tesseract.js-core/${name}.wasm.js`, `core/${name}.wasm.js`],
      [`tesseract.js-core/${name}.wasm`, `core/${name}.wasm`]
    ]),
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz']
];

await mkdir(output, { recursive: true });
for (const [from, to] of assets) {
  const destination = join(output, to);
  await mkdir(dirname(destination), { recursive: true });
  try {
    await copyFile(join(modules, from), destination);
  } catch (error) {
    throw new Error(`Offline OCR asset not found in installed dependencies: ${from}. Run npm install first. ${error.message}`);
  }
}
await writeFile(join(output, 'precache.json'), JSON.stringify(assets.map(([, path]) => '/ocr/' + path), null, 2) + '\n');
console.log(`Copied ${assets.length} locally hosted OCR assets for browser-offline scanning.`);
