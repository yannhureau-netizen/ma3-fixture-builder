// Lecture d'un fichier ZIP (un .gdtf est un zip). Gère les fichiers stockés et compressés (deflate),
// grâce au décompresseur intégré au navigateur. Aucune dépendance externe.

export async function readZip(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  // Fin du répertoire central : on la cherche en partant de la fin du fichier
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ce n\'est pas un fichier GDTF (archive zip illisible)');

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const utf8 = new TextDecoder();
  const files = new Map();

  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('archive zip abîmée');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = utf8.decode(u8.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, '/');
    files.set(name, { method, csize, off });
    p += 46 + nlen + xlen + clen;
  }

  return {
    names: [...files.keys()],
    // Retrouve un nom sans tenir compte des majuscules
    find(name) {
      const low = name.toLowerCase();
      return this.names.find(n => n.toLowerCase() === low) || null;
    },
    async get(name) {
      const f = files.get(name);
      if (!f) return null;
      const ln = dv.getUint16(f.off + 26, true);
      const lx = dv.getUint16(f.off + 28, true);
      const start = f.off + 30 + ln + lx;
      const data = u8.subarray(start, start + f.csize);
      if (f.method === 0) return data.slice();
      if (f.method === 8) {
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      }
      throw new Error(`format de compression non pris en charge (${f.method})`);
    },
  };
}
