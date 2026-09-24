// Estado compartido de la aplicación.
import { api } from './util.js';

export const estado = {
  usuario: null, // { usuario, rol: 'admin' | 'editor' }
  biblioteca: { arbol: [], fichas: [], maxNiveles: 5 },
  cambiosSinGuardar: false,
};

export const puedeEditar = () => !!estado.usuario;
export const esAdmin = () => estado.usuario && estado.usuario.rol === 'admin';

export async function cargarBiblioteca() {
  estado.biblioteca = await api('GET', '/api/biblioteca');
  return estado.biblioteca;
}

// Lista plana de categorías: [{ ruta: [...], texto: 'A / B', nivel }]
export function categoriasPlanas(arbol = estado.biblioteca.arbol) {
  const lista = [];
  const recorrer = (nodos) =>
    nodos.forEach((n) => {
      lista.push({ ruta: n.ruta, texto: n.ruta.join(' / '), nivel: n.ruta.length - 1, total: n.total });
      recorrer(n.hijos);
    });
  recorrer(arbol);
  return lista;
}

export const textoRuta = (ruta) => (ruta || []).join(' / ');
