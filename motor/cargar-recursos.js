(function (root) {
  'use strict';

  function decodeBase64(text) {
    if (Uint8Array.fromBase64) return Uint8Array.fromBase64(text);
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function loadResources(metadata, bundle) {
    const atlas = new Uint8Array(bundle.size);
    let cursor = 0;
    for (const [length, encoded] of bundle.blocks) {
      const destination = atlas.subarray(cursor, cursor + length);
      const raw = root.fflate.gunzipSync(decodeBase64(encoded), { out: destination });
      if (raw.length !== length) throw new Error('An asset block is incomplete.');
      cursor += length;
    }
    if (cursor !== atlas.length) throw new Error('Some game assets could not be loaded.');
    const scratch = new Uint8Array(Math.max(0, ...bundle.filters.map(([, bytes]) => bytes)));
    for (const [offset, bytes, lanes, deltas] of bundle.filters) {
      const data = atlas.subarray(offset, offset + bytes);
      const count = bytes / lanes;
      scratch.set(data);
      for (let lane = 0; lane < lanes; lane++) {
        for (let i = 0; i < count; i++) data[i * lanes + lane] = scratch[lane * count + i];
      }
      if (deltas) {
        const indices = lanes === 2 ? new Uint16Array(atlas.buffer, offset, count)
                                   : new Uint32Array(atlas.buffer, offset, count);
        let previous = 0;
        for (let i = 0; i < count; i++) {
          const encoded = indices[i];
          const delta = (encoded >>> 1) ^ -(encoded & 1);
          indices[i] = previous + delta;
          previous = indices[i];
        }
      }
    }
    return { metadata, buffer: atlas.buffer };
  }

  root.ViceCityLoadResources = loadResources;
})(globalThis);
