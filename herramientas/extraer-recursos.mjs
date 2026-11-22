import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const resources = new URL('recursos/', root);
const target = process.argv[2];
if (!target) throw new Error('Provide a destination directory.');
const output = resolve(target);
const sandbox = createContext({ atob });
const blocks = (await readdir(resources)).filter(name => /^bloque-\d+\.js$/.test(name)).sort();
const files = ['motor/fflate.js', 'motor/cargar-recursos.js', 'recursos/metadatos.js', 'recursos/escena.js', ...blocks.map(name => `recursos/${name}`)];
for (const name of files) {
  const script = await readFile(new URL(name, root), 'utf8');
  runInContext(script, sandbox, {filename: name});
}
const { metadata, buffer } = runInContext('ViceCityLoadResources(ViceCityMetadata, ViceCityBundle)', sandbox);
await mkdir(output, {recursive: true});
await writeFile(resolve(output, 'escena.bin'), new Uint8Array(buffer));
await writeFile(resolve(output, 'metadatos.json'), JSON.stringify(metadata, null, 2)+'\n');
console.log(`${Object.keys(metadata.meshes).length} meshes. Asset atlas: ${buffer.byteLength} bytes.`);
