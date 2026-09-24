# Wiki Unidad Soporte TI - Saesa

Wiki interna con dos ejes:

1. **Generador de fichas**: formulario (nombre, fecha, versión, elaborado por, link de descarga
   con QR, tags y pasos con hasta 4 imágenes, reordenables con arrastre). El PDF se genera
   en el navegador (A4, texto y QR vectoriales).
2. **Biblioteca**: categorías con hasta 4 subniveles, buscador con tolerancia a errores de
   tipeo y tildes, filtros combinables (categoría, tags, autor, fechas), historial de versiones
   (botón `v1.2 …`) y papelera.

## Usuarios

| Usuario      | Rol    | Puede                                                  |
|--------------|--------|--------------------------------------------------------|
| (anónimo)    | —      | Ver, buscar y descargar                                |
| `up_user`    | editor | Crear/editar fichas (nueva versión), crear/renombrar categorías, mover fichas |
| `admin_user` | admin  | Todo lo anterior + eliminar fichas/versiones/categorías vacías, papelera |

## Estructura

```
public/            aplicación web (HTML/CSS/JS, sin compilación)
  css/tema.css     colores del sitio (basados en saesa.cl)
  js/pdf.js        diseño del PDF (colores en la constante COLOR)
  vendor/          jsPDF, qrcode-generator, SortableJS, MiniSearch (MIT)
  assets/          logo Saesa y fuente Figtree (OFL)
server/            API en Node.js sin dependencias externas
  cli.js           definir claves: node server/cli.js clave admin_user
deploy/            Caddyfile, servicios systemd, respaldo incremental (restic)
INSTALACION.md     guía paso a paso para Ubuntu en Vultr
```

Datos (fuera del repositorio, por defecto `./data`):

```
data/biblioteca/   carpetas portables: categorías → procedimientos → versiones (PDF + datos + imágenes;
                   las imágenes sin cambios entre versiones son enlaces duros: copiar con rsync -aH)
data/papelera/     elementos eliminados (restaurables por el admin)
data/config/       claves (hash scrypt), secreto de sesión y auditoria.log
```

## Probar en local

```bash
node server/cli.js clave admin_user
node server/cli.js clave up_user
node server/server.js            # http://127.0.0.1:3000
```

Versiones de ficha: formato `X.Y` con `Y` de 0 a 9 (1.0 → 1.1 … 1.9 → 2.0).
