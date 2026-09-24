'use strict';
// Usuarios fijos (admin_user / up_user) con clave hasheada con scrypt
// y sesiones firmadas con HMAC (sin base de datos).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('./config');

const USUARIOS = { admin_user: 'admin', up_user: 'editor' };

const archivoUsuarios = () => path.join(C.CONFIG, 'usuarios.json');

function asegurarConfig() {
  fs.mkdirSync(C.CONFIG, { recursive: true, mode: 0o700 });
}

function leerUsuarios() {
  try {
    return JSON.parse(fs.readFileSync(archivoUsuarios(), 'utf8'));
  } catch {
    return {};
  }
}

function hashClave(clave, sal = crypto.randomBytes(16).toString('hex')) {
  return { sal, hash: crypto.scryptSync(clave, sal, 64).toString('hex') };
}

function fijarClave(usuario, clave) {
  if (!USUARIOS[usuario]) throw new Error(`Usuario desconocido: ${usuario}`);
  if (typeof clave !== 'string' || clave.length < 10) {
    throw new Error('La clave debe tener al menos 10 caracteres');
  }
  asegurarConfig();
  const usuarios = leerUsuarios();
  usuarios[usuario] = { rol: USUARIOS[usuario], ...hashClave(clave), actualizado: new Date().toISOString() };
  const tmp = archivoUsuarios() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(usuarios, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, archivoUsuarios());
}

function verificar(usuario, clave) {
  const u = USUARIOS[usuario] && leerUsuarios()[usuario];
  if (!u || typeof clave !== 'string') {
    hashClave(String(clave || '')); // mismo costo para no revelar qué usuarios existen
    return null;
  }
  const { hash } = hashClave(clave, u.sal);
  const ok = crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(u.hash, 'hex'));
  return ok ? { usuario, rol: USUARIOS[usuario] } : null;
}

let secreto;
function obtenerSecreto() {
  if (secreto) return secreto;
  const archivo = path.join(C.CONFIG, 'secreto.key');
  try {
    secreto = fs.readFileSync(archivo);
  } catch {
    asegurarConfig();
    secreto = crypto.randomBytes(32);
    fs.writeFileSync(archivo, secreto, { mode: 0o600 });
  }
  return secreto;
}

// La firma incluye el hash de la clave: al cambiar la clave se invalidan las sesiones.
function firmar(datos, u) {
  return crypto.createHmac('sha256', obtenerSecreto()).update(`${datos}|${u.hash}`).digest('base64url');
}

function crearToken(usuario) {
  const u = leerUsuarios()[usuario];
  const exp = Date.now() + C.SESION_HORAS * 3600e3;
  const datos = Buffer.from(`${usuario}|${exp}`).toString('base64url');
  return `${datos}.${firmar(datos, u)}`;
}

function leerToken(token) {
  if (typeof token !== 'string') return null;
  const [datos, firma] = token.split('.');
  if (!datos || !firma) return null;
  const [usuario, exp] = Buffer.from(datos, 'base64url').toString().split('|');
  const u = USUARIOS[usuario] && leerUsuarios()[usuario];
  if (!u) return null;
  const esperada = Buffer.from(firmar(datos, u));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) return null;
  if (!(Date.now() < Number(exp))) return null;
  return { usuario, rol: USUARIOS[usuario] };
}

module.exports = { USUARIOS, fijarClave, verificar, crearToken, leerToken, leerUsuarios };
