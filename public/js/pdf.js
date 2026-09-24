// Construye la ficha en PDF (A4 vertical) con jsPDF.
// Texto, líneas, formas y código QR son vectoriales; las fotos de los pasos
// se insertan como imágenes JPEG.
/* global jspdf */
import { qrPdf } from './qr.js';
import { blobADataUrl, fechaCorta } from './util.js';

export const SITIO = 'Wiki Unidad Soporte TI - Saesa';

const COLOR = {
  morado: [79, 31, 255],
  azul: [11, 37, 89],
  texto: [33, 38, 56],
  gris: [98, 105, 128],
  linea: [222, 225, 236],
  fondo: [243, 244, 250],
  tag: [236, 232, 255],
  lima: [215, 232, 74],
};

const A4 = { ancho: 210, alto: 297 };
const M = 16; // margen lateral
const ANCHO = A4.ancho - M * 2;
const TOPE = 32; // inicio del contenido bajo el encabezado
const FONDO = A4.alto - 23; // límite inferior del contenido

let recursos;
async function cargarRecursos() {
  if (recursos) return recursos;
  const leer = async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`No se pudo cargar ${url}`);
    return blobADataUrl(await r.blob());
  };
  const [normal, semi, negrita, logo] = await Promise.all([
    leer('assets/fonts/Figtree-400.ttf'),
    leer('assets/fonts/Figtree-600.ttf'),
    leer('assets/fonts/Figtree-700.ttf'),
    leer('assets/logo-saesa.png'),
  ]);
  const b64 = (u) => u.slice(u.indexOf(',') + 1);
  recursos = { fuentes: { normal: b64(normal), semi: b64(semi), negrita: b64(negrita) }, logo };
  return recursos;
}

function registrarFuentes(doc, f) {
  doc.addFileToVFS('Figtree-400.ttf', f.normal);
  doc.addFileToVFS('Figtree-600.ttf', f.semi);
  doc.addFileToVFS('Figtree-700.ttf', f.negrita);
  doc.addFont('Figtree-400.ttf', 'Figtree', 'normal');
  doc.addFont('Figtree-700.ttf', 'Figtree', 'bold');
  doc.addFont('Figtree-600.ttf', 'FigtreeSemi', 'normal');
}

const tipoImagen = (src) => (/^data:image\/png/.test(src) ? 'PNG' : 'JPEG');

/**
 * @param {object} datos {nombre, fecha, version, autor, link, tags[], pasos[{texto, imagenes[{src,w,h}]}]}
 * @param {string} categoria texto de la ruta de categoría ("Redes / Switches")
 * @returns {Promise<jsPDF>}
 */
export async function crearPdf(datos, categoria) {
  const { fuentes, logo } = await cargarRecursos();
  const doc = new jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
  registrarFuentes(doc, fuentes);

  const fuente = (estilo, tam, color = COLOR.texto) => {
    if (estilo === 'semi') doc.setFont('FigtreeSemi', 'normal');
    else doc.setFont('Figtree', estilo);
    doc.setFontSize(tam);
    doc.setTextColor(...color);
  };
  const altoLinea = (tam, factor = 1.4) => tam * 0.3528 * factor;

  let y = TOPE;
  const nuevaPagina = () => {
    doc.addPage();
    y = TOPE;
  };
  const asegurar = (alto) => {
    if (y + alto > FONDO) nuevaPagina();
  };

  // ---------- bloque de título ----------
  fuente('bold', 8, COLOR.morado);
  doc.text('FICHA TÉCNICA', M, y);
  y += 4;

  fuente('bold', 20, COLOR.azul);
  const titulo = doc.splitTextToSize(datos.nombre, ANCHO);
  for (const linea of titulo) {
    y += altoLinea(20, 1.15);
    doc.text(linea, M, y);
  }
  y += 6;

  // ---------- recuadro de metadatos ----------
  const columnas = [
    ['Versión', datos.version, 22],
    ['Fecha', fechaCorta(datos.fecha), 30],
    ['Categoría', categoria || '—', 74],
    ['Elaborado por', datos.autor, ANCHO - 22 - 30 - 74],
  ];
  fuente('semi', 9.5);
  const valores = columnas.map(([, v, w]) => doc.splitTextToSize(String(v), w - 7));
  const altoMeta = 11 + Math.max(...valores.map((l) => l.length)) * altoLinea(9.5, 1.25);
  doc.setFillColor(...COLOR.fondo);
  doc.roundedRect(M, y, ANCHO, altoMeta, 2.5, 2.5, 'F');
  let x = M;
  columnas.forEach(([etiqueta, , w], i) => {
    fuente('normal', 7.2, COLOR.gris);
    doc.text(etiqueta.toUpperCase(), x + 5, y + 6);
    fuente('semi', 9.5, COLOR.azul);
    valores[i].forEach((l, k) => doc.text(l, x + 5, y + 11 + k * altoLinea(9.5, 1.25)));
    if (i) {
      doc.setDrawColor(...COLOR.linea);
      doc.setLineWidth(0.3);
      doc.line(x, y + 3, x, y + altoMeta - 3);
    }
    x += w;
  });
  y += altoMeta + 5;

  // ---------- tags ----------
  if (datos.tags && datos.tags.length) {
    fuente('semi', 8);
    let tx = M;
    const alto = 5.6;
    for (const tag of datos.tags) {
      const w = doc.getTextWidth(tag) + 6;
      if (tx + w > M + ANCHO) {
        tx = M;
        y += alto + 2;
      }
      doc.setFillColor(...COLOR.tag);
      doc.roundedRect(tx, y, w, alto, 2.8, 2.8, 'F');
      doc.setTextColor(...COLOR.morado);
      doc.text(tag, tx + 3, y + 3.9);
      tx += w + 2;
    }
    y += alto + 6;
  }

  // ---------- link de descarga + QR ----------
  if (datos.link) {
    const lado = 28;
    const alto = lado + 8;
    doc.setDrawColor(...COLOR.linea);
    doc.setLineWidth(0.35);
    doc.roundedRect(M, y, ANCHO, alto, 2.5, 2.5, 'S');
    qrPdf(doc, datos.link, M + 4, y + 4, lado, COLOR.azul);
    doc.link(M + 4, y + 4, lado, lado, { url: datos.link });
    const tx = M + lado + 10;
    fuente('bold', 10.5, COLOR.azul);
    doc.text('Link de descarga', tx, y + 10);
    fuente('normal', 9, COLOR.morado);
    const lineas = doc.splitTextToSize(datos.link, ANCHO - lado - 16).slice(0, 3);
    lineas.forEach((l, i) => doc.textWithLink(l, tx, y + 16 + i * altoLinea(9, 1.3), { url: datos.link }));
    fuente('normal', 8, COLOR.gris);
    doc.text('Escanea el código QR o haz clic en el enlace.', tx, y + alto - 5);
    y += alto + 8;
  }

  // ---------- pasos ----------
  asegurar(20);
  fuente('bold', 13, COLOR.azul);
  doc.text('Procedimiento', M, y + 4);
  doc.setFillColor(...COLOR.lima);
  doc.rect(M, y + 6.5, 16, 1.2, 'F');
  y += 14;

  const xTexto = M + 10;
  const anchoTexto = ANCHO - 10;
  const lh = altoLinea(10.5, 1.45);

  datos.pasos.forEach((paso, i) => {
    fuente('normal', 10.5);
    const lineas = paso.texto ? doc.splitTextToSize(paso.texto, anchoTexto) : [];
    asegurar(10 + Math.min(lineas.length, 3) * lh + (lineas.length ? 0 : 40));

    // número del paso
    doc.setFillColor(...COLOR.morado);
    doc.circle(M + 3.6, y + 3.4, 3.6, 'F');
    fuente('bold', 9, [255, 255, 255]);
    doc.text(String(i + 1), M + 3.6, y + 4.6, { align: 'center' });
    fuente('semi', 11, COLOR.azul);
    doc.text(`Paso ${i + 1}`, xTexto, y + 4.8);
    y += 10;

    fuente('normal', 10.5);
    for (const linea of lineas) {
      if (y + lh > FONDO) nuevaPagina();
      doc.text(linea, xTexto, y + 3.8);
      y += lh;
    }
    if (lineas.length) y += 2;

    // imágenes: 1 → ancho completo; 2 → dos columnas; 3-4 → grilla 2×2
    const imgs = paso.imagenes || [];
    if (imgs.length) {
      const cols = imgs.length === 1 ? 1 : 2;
      const maxAlto = imgs.length === 1 ? 115 : imgs.length === 2 ? 80 : 68;
      const sep = 4;
      const celda = (anchoTexto - sep * (cols - 1)) / cols;
      for (let f = 0; f < imgs.length; f += cols) {
        const fila = imgs.slice(f, f + cols).map((img) => {
          const escala = Math.min(celda / img.w, maxAlto / img.h);
          return { ...img, dw: img.w * escala, dh: img.h * escala };
        });
        const altoFila = Math.max(...fila.map((m) => m.dh));
        if (y + altoFila > FONDO) nuevaPagina();
        fila.forEach((m, k) => {
          const ix = xTexto + k * (celda + sep) + (cols === 1 ? 0 : (celda - m.dw) / 2);
          doc.addImage(m.src, tipoImagen(m.src), ix, y, m.dw, m.dh, undefined, 'FAST');
          doc.setDrawColor(...COLOR.linea);
          doc.setLineWidth(0.25);
          doc.rect(ix, y, m.dw, m.dh, 'S');
        });
        y += altoFila + sep;
      }
    }
    y += 5;
    if (i < datos.pasos.length - 1 && y + 4 < FONDO) {
      doc.setDrawColor(...COLOR.linea);
      doc.setLineWidth(0.25);
      doc.line(xTexto, y - 2.5, M + ANCHO, y - 2.5);
    }
  });

  // ---------- encabezado y pie en todas las páginas ----------
  const paginas = doc.getNumberOfPages();
  const anchoLogo = 30;
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p);
    doc.addImage(logo, 'PNG', M, 10, anchoLogo, (anchoLogo * 170) / 530, 'logo', 'FAST');
    fuente('semi', 8.5, COLOR.azul);
    doc.text(SITIO, A4.ancho - M, 15, { align: 'right' });
    if (p > 1) {
      fuente('normal', 8, COLOR.gris);
      doc.text(doc.splitTextToSize(datos.nombre, 110)[0], A4.ancho - M, 19.5, { align: 'right' });
    }
    doc.setDrawColor(...COLOR.morado);
    doc.setLineWidth(0.5);
    doc.line(M, 24, A4.ancho - M, 24);
    doc.setFillColor(...COLOR.lima);
    doc.rect(M, 23.4, 22, 1.2, 'F');

    const yPie = A4.alto - 16;
    doc.setDrawColor(...COLOR.linea);
    doc.setLineWidth(0.3);
    doc.line(M, yPie, A4.ancho - M, yPie);
    fuente('semi', 8.5, COLOR.azul);
    doc.text(`Elaborado por: ${datos.autor}`, M, yPie + 5.5);
    fuente('normal', 7.5, COLOR.gris);
    doc.text(doc.splitTextToSize(`${datos.nombre} · Versión ${datos.version} · ${fechaCorta(datos.fecha)}`, 125)[0], M, yPie + 9.8);
    fuente('semi', 8.5, COLOR.azul);
    doc.text(`Página ${p} de ${paginas}`, A4.ancho - M, yPie + 5.5, { align: 'right' });
    fuente('normal', 7.5, COLOR.gris);
    doc.text(SITIO, A4.ancho - M, yPie + 9.8, { align: 'right' });
  }

  doc.setProperties({
    title: datos.nombre,
    subject: `Ficha técnica · Versión ${datos.version}`,
    author: datos.autor,
    keywords: (datos.tags || []).join(', '),
    creator: SITIO,
  });
  doc.setLanguage('es-CL');
  return doc;
}
