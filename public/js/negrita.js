// Negrita en el texto de los pasos: se guarda como **texto** (dentro de una línea).
// Un par de ** incompleto se deja tal cual, como texto normal.

const MARCA = /\*\*(?=[^\s*])([^\n]*?[^\s*])\*\*/g;

// Divide el texto en tramos [{ t, b }] (b = negrita).
export function tramos(texto) {
  const out = [];
  let ultimo = 0;
  for (const m of String(texto || '').matchAll(MARCA)) {
    if (m.index > ultimo) out.push({ t: texto.slice(ultimo, m.index), b: false });
    out.push({ t: m[1], b: true });
    ultimo = m.index + m[0].length;
  }
  if (ultimo < (texto || '').length) out.push({ t: texto.slice(ultimo), b: false });
  return out;
}

const esEspacio = (c) => /\s/.test(c);

// Escribe el texto con marcas a partir de sus caracteres y de si cada uno va
// en negrita. Los saltos de línea y los espacios de los bordes quedan fuera de
// las marcas; un espacio entre dos palabras en negrita queda dentro.
export function componer(chars, negrita) {
  let out = '';
  let abierta = false;
  const siguienteEsNegra = (i) => {
    for (let k = i; k < chars.length && chars[k] !== '\n'; k++) if (!esEspacio(chars[k])) return negrita[k];
    return false;
  };
  chars.forEach((c, i) => {
    const negra = esEspacio(c) ? abierta && c !== '\n' && siguienteEsNegra(i) : negrita[i];
    if (negra !== abierta) {
      out += '**';
      abierta = negra;
    }
    out += c;
  });
  if (abierta) out += '**';
  return out;
}
