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

export const quitarNegrita = (texto) => String(texto || '').replace(MARCA, '$1');

// Caracteres del texto sin marcas, si cada uno va en negrita, y su posición
// en el texto marcado (para traducir la selección del editor).
function analizar(texto) {
  const chars = [];
  const negrita = [];
  const origen = [];
  let pos = 0;
  for (const { t, b } of tramos(texto)) {
    if (b) pos += 2;
    for (const c of t) {
      chars.push(c);
      negrita.push(b);
      origen.push(pos);
      pos += c.length;
    }
    if (b) pos += 2;
  }
  return { chars, negrita, origen };
}

const esEspacio = (c) => /\s/.test(c);

// Vuelve a escribir las marcas. Los saltos de línea y los espacios de los
// bordes quedan fuera; un espacio entre dos palabras en negrita queda dentro.
function componer(chars, negrita) {
  let out = '';
  const destino = [];
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
    destino.push(out.length);
    out += c;
  });
  if (abierta) out += '**';
  return { texto: out, destino };
}

// Aplica o quita la negrita en la selección [ini, fin) del texto marcado:
// si todo lo seleccionado ya está en negrita la quita, si no la aplica.
// Devuelve null si la selección está vacía o solo tiene espacios.
export function alternarNegrita(texto, ini, fin) {
  const { chars, negrita, origen } = analizar(texto);
  const aPlano = (idx) => origen.filter((o) => o < idx).length;
  let a = aPlano(ini);
  let b = aPlano(fin);
  while (a < b && esEspacio(chars[a])) a++;
  while (b > a && esEspacio(chars[b - 1])) b--;
  if (a >= b) return null;
  const poner = !chars.slice(a, b).every((c, k) => esEspacio(c) || negrita[a + k]);
  const nueva = negrita.map((v, k) => (k >= a && k < b ? poner : v));
  const r = componer(chars, nueva);
  return { texto: r.texto, ini: r.destino[a], fin: r.destino[b - 1] + chars[b - 1].length, negrita: poner };
}
