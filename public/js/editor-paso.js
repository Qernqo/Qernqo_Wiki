// Editor del texto de un paso: muestra la negrita al instante (sin ** a la vista)
// y guarda el texto como antes, con la negrita marcada como **texto**.
// Solo admite negrita y saltos de línea; lo pegado entra siempre como texto simple.
import { h, aviso } from './util.js';
import { tramos, componer } from './negrita.js';

const BLOQUES = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE']);

function esNegrita(el, heredada) {
  if (el.nodeName === 'STRONG' || el.nodeName === 'B') return true;
  const peso = el.style?.fontWeight;
  if (!peso) return heredada;
  return peso === 'bold' || peso === 'bolder' || Number(peso) >= 600;
}

// Contenido del editor → texto con marcas **.
// El editor usa solo texto, <strong>/<b> y <br>; los bloques (<div>, <p>) que
// pudiera crear el navegador se leen como líneas.
export function leerEditor(raiz) {
  const chars = [];
  const negrita = [];
  let pendiente = false; // salto de línea pendiente alrededor de un bloque
  let terminaEnBr = false;
  const agregar = (c, b) => {
    if (pendiente && chars.length && chars.at(-1) !== '\n') {
      chars.push('\n');
      negrita.push(false);
    }
    pendiente = false;
    chars.push(c);
    negrita.push(b);
  };
  const recorrer = (nodo, b) => {
    for (const n of nodo.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) {
        for (const c of n.data) {
          if (c === '\r') continue;
          agregar(c === '\u00a0' ? ' ' : c, b);
          terminaEnBr = false;
        }
      } else if (n.nodeName === 'BR') {
        agregar('\n', false);
        terminaEnBr = true;
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        const bloque = BLOQUES.has(n.nodeName);
        if (bloque) pendiente = true;
        recorrer(n, esNegrita(n, b));
        if (bloque) pendiente = true;
      }
    }
  };
  recorrer(raiz, false);
  // el <br> final solo reserva la última línea para el cursor
  if (terminaEnBr) {
    chars.pop();
    negrita.pop();
  }
  return componer(chars, negrita);
}

// Texto con marcas → contenido del editor.
function pintar(raiz, texto) {
  const nodos = [];
  for (const { t, b } of tramos(texto)) {
    t.split('\n').forEach((parte, i) => {
      if (i > 0) nodos.push(h('br'));
      if (parte) nodos.push(b ? h('strong', {}, parte) : document.createTextNode(parte));
    });
  }
  // un salto al final necesita un <br> extra para que la línea vacía se vea
  if (texto.endsWith('\n')) nodos.push(h('br'));
  raiz.replaceChildren(...nodos);
}

/**
 * @param {object} op
 * @param {string} op.valor texto inicial (con marcas **)
 * @param {number} op.max largo máximo del texto
 * @param {string} op.placeholder
 * @param {(texto: string) => void} op.alCambiar
 * @param {(archivos: File[]) => void} op.alPegarImagenes
 */
export function crearEditorPaso({ valor, max, placeholder, alCambiar, alPegarImagenes }) {
  const editor = h('div', {
    class: 'campo paso-texto',
    contenteditable: 'true',
    role: 'textbox',
    'aria-multiline': 'true',
    spellcheck: 'true',
    'data-placeholder': placeholder,
  });
  const actualizar = () => {
    const texto = leerEditor(editor);
    editor.classList.toggle('vacio', !texto.trim());
    alCambiar(texto);
  };
  const largoActual = () => leerEditor(editor).replace(/\*\*/g, '').length;
  const seleccionado = () => {
    const sel = getSelection();
    return sel.rangeCount && editor.contains(sel.anchorNode) ? sel.toString().length : 0;
  };

  editor.addEventListener('input', actualizar);
  editor.addEventListener('keydown', (e) => {
    const atajo = (e.ctrlKey || e.metaKey) && !e.altKey;
    if (atajo && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
      e.preventDefault(); // cursiva y subrayado no se usan
      if (e.key.toLowerCase() === 'b' && !e.shiftKey) negritaEnSeleccion(editor);
    } else if (e.key === 'Enter') {
      e.preventDefault(); // salto de línea simple (sin párrafos)
      document.execCommand('insertLineBreak');
    }
  });
  editor.addEventListener('beforeinput', (e) => {
    const tipo = e.inputType;
    // solo negrita; nada de formato traído por arrastre o por el navegador
    if ((tipo.startsWith('format') && tipo !== 'formatBold') || tipo === 'insertFromDrop' || tipo === 'insertParagraph') {
      e.preventDefault();
      return;
    }
    if (tipo === 'insertText' && e.data && largoActual() - seleccionado() + e.data.length > max) {
      e.preventDefault();
      aviso(`El texto del paso admite hasta ${max} caracteres`, 'error');
    }
  });
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const archivos = [...(e.clipboardData?.files || [])];
    if (archivos.some((a) => a.type.startsWith('image/'))) {
      alPegarImagenes(archivos);
      return;
    }
    let texto = (e.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n');
    const libre = max - (largoActual() - seleccionado());
    if (texto.length > libre) {
      texto = texto.slice(0, Math.max(0, libre));
      aviso(`El texto del paso admite hasta ${max} caracteres; se recortó lo pegado`, 'error');
    }
    // línea por línea, para que el editor use solo <br> (y Ctrl+Z lo deshaga)
    texto.split('\n').forEach((linea, i) => {
      if (i > 0) document.execCommand('insertLineBreak');
      if (linea) document.execCommand('insertText', false, linea);
    });
  });

  pintar(editor, valor || '');
  editor.classList.toggle('vacio', !(valor || '').trim());
  return editor;
}

// Aplica o quita la negrita en la selección (el navegador la agrega al historial de Ctrl+Z).
export function negritaEnSeleccion(editor) {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed || !editor.contains(sel.anchorNode) || !editor.contains(sel.focusNode)) return;
  if (!sel.toString().trim()) return;
  document.execCommand('styleWithCSS', false, false);
  document.execCommand('bold');
}
