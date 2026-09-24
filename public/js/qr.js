// Genera la matriz QR (librería qrcode-generator, global `qrcode`) y la dibuja
// como vectores: en SVG para la vista previa y en jsPDF para la ficha.
/* global qrcode */

export function matrizQr(texto) {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const qr = qrcode(0, 'M');
  qr.addData(texto, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const filas = [];
  for (let r = 0; r < n; r++) {
    const fila = [];
    for (let c = 0; c < n; c++) fila.push(qr.isDark(r, c));
    filas.push(fila);
  }
  return filas;
}

// Agrupa módulos oscuros consecutivos de cada fila en rectángulos.
function tramos(matriz) {
  const lista = [];
  matriz.forEach((fila, r) => {
    let inicio = -1;
    fila.forEach((oscuro, c) => {
      if (oscuro && inicio < 0) inicio = c;
      if ((!oscuro || c === fila.length - 1) && inicio >= 0) {
        const fin = oscuro ? c + 1 : c;
        lista.push([r, inicio, fin - inicio]);
        inicio = -1;
      }
    });
  });
  return lista;
}

export function qrSvg(texto, margen = 2) {
  const m = matrizQr(texto);
  const n = m.length + margen * 2;
  const d = tramos(m)
    .map(([r, c, w]) => `M${c + margen} ${r + margen}h${w}v1h-${w}z`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#0B2559"/></svg>`;
}

export function qrPdf(doc, texto, x, y, tamano, color = [11, 37, 89]) {
  const m = matrizQr(texto);
  const celda = tamano / m.length;
  doc.setFillColor(...color);
  for (const [r, c, w] of tramos(m)) {
    // pequeño solape para evitar líneas finas entre módulos en algunos visores
    doc.rect(x + c * celda, y + r * celda, w * celda + 0.02, celda + 0.02, 'F');
  }
}
