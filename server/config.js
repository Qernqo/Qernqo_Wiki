'use strict';
// Configuración central. Todo se puede sobreescribir con variables de entorno
// (en Docker las define el Dockerfile; ver también docker-compose.yml).
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const DATA_DIR = path.resolve(process.env.WIKI_DATA_DIR || path.join(raiz, 'data'));

module.exports = {
  PORT: parseInt(process.env.WIKI_PORT || '3000', 10),
  HOST: process.env.WIKI_HOST || '127.0.0.1',
  DATA_DIR,
  // Carpeta portable: categorías / subcategorías / fichas / versiones.
  BIBLIOTECA: path.join(DATA_DIR, 'biblioteca'),
  PAPELERA: path.join(DATA_DIR, 'papelera'),
  CONFIG: path.join(DATA_DIR, 'config'),
  PUBLIC_DIR: path.resolve(process.env.WIKI_PUBLIC_DIR || path.join(raiz, 'public')),
  // En producción Caddy sirve los estáticos; Node también puede hacerlo (útil en pruebas).
  SERVIR_ESTATICOS: process.env.WIKI_SERVIR_ESTATICOS !== '0',
  // "auto" = Secure solo si la petición llegó por HTTPS (Cloudflare).
  COOKIE_SECURE: process.env.WIKI_COOKIE_SECURE || 'auto',
  MAX_BODY: parseInt(process.env.WIKI_MAX_BODY_MB || '95', 10) * 1024 * 1024,
  // 1 categoría + 4 subniveles.
  MAX_NIVELES: 5,
  MAX_IMAGENES_PASO: 4,
  MAX_TAGS: 5,
  SESION_HORAS: 12,
};
