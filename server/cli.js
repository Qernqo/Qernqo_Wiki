#!/usr/bin/env node
'use strict';
// Herramienta de administración:
//   node server/cli.js clave admin_user     → define/cambia la clave (la pide oculta)
//   node server/cli.js clave up_user
//   node server/cli.js usuarios              → muestra qué usuarios tienen clave
const readline = require('node:readline');
const auth = require('./auth');

function pedirOculto(pregunta) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(pregunta)) rl.output.write(s);
    };
    rl.question(pregunta, (r) => {
      rl.output.write('\n');
      rl.close();
      resolve(r);
    });
  });
}

async function main() {
  const [cmd, usuario] = process.argv.slice(2);
  if (cmd === 'clave' && auth.USUARIOS[usuario]) {
    // También acepta la clave por stdin no interactivo (útil en scripts).
    let clave;
    if (process.stdin.isTTY) {
      clave = await pedirOculto(`Nueva clave para ${usuario}: `);
      const repetida = await pedirOculto('Repite la clave: ');
      if (clave !== repetida) throw new Error('Las claves no coinciden');
    } else {
      clave = require('node:fs').readFileSync(0, 'utf8').split('\n')[0];
    }
    auth.fijarClave(usuario, clave);
    console.log(`Clave de ${usuario} actualizada. Las sesiones anteriores quedan cerradas.`);
  } else if (cmd === 'usuarios') {
    const u = auth.leerUsuarios();
    for (const [nombre, rol] of Object.entries(auth.USUARIOS)) {
      console.log(`${nombre.padEnd(12)} ${rol.padEnd(8)} ${u[nombre] ? 'con clave' : 'SIN CLAVE'}`);
    }
  } else {
    console.log('Uso:\n  node server/cli.js clave <admin_user|up_user>\n  node server/cli.js usuarios');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
