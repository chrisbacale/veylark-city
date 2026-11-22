import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const readSource = file => readFile(new URL(`fuentes/${file}`, root), 'utf8');
let source = await readSource('jugar.js');
for (const [marker, file] of [
  ['ÓPTICA', 'optica.js'],
  ['TRAYECTO', 'ruta.js'],
  ['SUPERFICIES', 'superficies.js'],
  ['SONIDO', 'paisaje.js'],
]) {
  const placeholder = `/* ${marker} */`;
  if (!source.includes(placeholder)) throw new Error(`Missing module ${file}`);
  const section = await readSource(file);
  source = source.replace(placeholder, () => section);
}
const oldInit = /async function init\(\)\{[^\n]*?\}/;
if (!oldInit.test(source)) throw new Error('Unable to find the game initializer.');
const offline = await readSource('inicio-offline.js');
source = source.replace(oldInit, () => offline.trimEnd());
source = source.replace('init().catch(noticeError);','Promise.resolve().then(init).catch(noticeError);');
await writeFile(new URL('juego/jugar.js', root), source.trimStart(), 'utf8');
console.log('Updated juego/jugar.js');
