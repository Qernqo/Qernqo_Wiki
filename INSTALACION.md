# Instalación en VPS OVH (Ubuntu 24.04 LTS)

Arquitectura final:

```
Usuario ─► Cloudflare Access (login por correo) ─► Túnel Cloudflare ─► cloudflared (en el servidor)
        ─► Caddy 127.0.0.1:80 ─┬─ wiki.aysen.app   ─┬─ /            → /srv/wiki/app/public
           (un sitio por       │                    ├─ /archivos/*  → /srv/wiki/data/biblioteca
            subdominio)        │                    └─ /api/*       → Node.js :3000 (systemd: wiki)
                               ├─ fichas.aysen.app  →  /srv/fichas/public   (HTML estático, cuando se migre)
                               └─ <nuevo>.aysen.app →  /srv/<nuevo>/public
```

- **No se abren puertos** a Internet: el túnel sale desde el servidor hacia Cloudflare.
- El HTTPS lo pone Cloudflare; Caddy trabaja solo en HTTP local.
- El backend **no usa dependencias npm**: basta con Node.js.
- La wiki es la **base inicial** del servidor: Caddy queda preparado para agregar más
  subdominios (sección 12).

Todos los comandos se ejecutan como un usuario con `sudo`.

### Tamaño del servidor

Todo (sistema, biblioteca y respaldos) queda en el disco del servidor. Estimación para
~500 procedimientos con 10 imágenes cada uno e historial de versiones:

| Uso                                                   | Estimado |
|-------------------------------------------------------|----------|
| Sistema, Node.js, Caddy                               | ~5 GB    |
| Biblioteca (las imágenes repetidas entre versiones no se duplican) | ~5 GB |
| Respaldo incremental (restic)                         | ~6 GB    |
| Margen de crecimiento                                 | ~15 GB   |

**Recomendado: 50 GB de disco o más.** El VPS de OVH (4 vCore, 4 GB RAM, 75 GB) cumple con
holgura, también para sumar fichas y otros sitios estáticos. Revisa el uso real con
`du -sh /srv/wiki/data/biblioteca` y `df -h /`.

---

## 1. Preparar el sistema

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl gpg rsync restic debian-keyring debian-archive-keyring apt-transport-https ufw
sudo timedatectl set-timezone America/Santiago
```

Firewall (solo SSH; el túnel no necesita puertos de entrada):

```bash
sudo ufw allow OpenSSH
sudo ufw enable
```

> OVH también ofrece un firewall de red en el panel (*Network Firewall* de la IP del VPS).
> Es opcional: con el túnel basta con permitir SSH.

## 2. Instalar Node.js 22 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # debe mostrar v22.x
```

## 3. Instalar Caddy

```bash
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

## 4. Descargar la wiki y crear carpetas

```bash
# usuario de sistema sin login para el servicio
sudo useradd --system --home /srv/wiki --shell /usr/sbin/nologin wiki

sudo mkdir -p /srv/wiki /etc/wiki /var/backups/wiki-restic
sudo git clone -b main https://github.com/qernqo/qernqo_wiki.git /srv/wiki/app
#  (repositorio privado: usa una "deploy key" de solo lectura o un token)

sudo mkdir -p /srv/wiki/data
sudo chown -R wiki:wiki /srv/wiki/data /var/backups/wiki-restic
sudo chmod 700 /var/backups/wiki-restic
sudo chmod 755 /srv/wiki /srv/wiki/data
sudo chmod +x /srv/wiki/app/deploy/respaldo.sh

sudo cp /srv/wiki/app/deploy/wiki.env.ejemplo /etc/wiki/wiki.env
```

## 5. Crear las claves de los usuarios

La wiki tiene dos usuarios fijos:

| Usuario      | Permisos                                          |
|--------------|---------------------------------------------------|
| `admin_user` | Acceso total (incluye eliminar y papelera)        |
| `up_user`    | Crear y modificar procedimientos y categorías (no elimina)|

```bash
sudo -u wiki env WIKI_DATA_DIR=/srv/wiki/data node /srv/wiki/app/server/cli.js clave admin_user
sudo -u wiki env WIKI_DATA_DIR=/srv/wiki/data node /srv/wiki/app/server/cli.js clave up_user
```

La clave se pide dos veces y debe tener al menos 10 caracteres. Para cambiarla, repite el
comando: las sesiones abiertas de ese usuario se cierran automáticamente.

## 6. Servicio systemd del backend

```bash
sudo cp /srv/wiki/app/deploy/wiki.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wiki
sudo systemctl status wiki --no-pager
curl -s http://127.0.0.1:3000/api/sesion     # → {"usuario":null}
```

## 7. Configurar Caddy (un archivo por subdominio)

La configuración vive en `deploy/caddy/`:

```
Caddyfile                          → /etc/caddy/Caddyfile        (base común de todos los sitios)
sitios/wiki.caddy                  → /etc/caddy/sitios/wiki.caddy
sitios/fichas.caddy                → para cuando fichas se migre a este servidor
sitios/plantilla-estatico.caddy.ejemplo  → plantilla para sitios nuevos
```

```bash
# si el servidor ya tenía un Caddyfile, guárdalo antes de reemplazarlo
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.antes 2>/dev/null || true

sudo mkdir -p /etc/caddy/sitios
sudo cp /srv/wiki/app/deploy/caddy/Caddyfile /etc/caddy/Caddyfile
sudo cp /srv/wiki/app/deploy/caddy/sitios/wiki.caddy /etc/caddy/sitios/
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
curl -sI -H "Host: wiki.aysen.app" http://127.0.0.1/ | head -1    # → HTTP/1.1 200 OK
```

Qué hace la base común (`Caddyfile`):
- Sin certificados propios (`auto_https off`): el HTTPS lo pone Cloudflare.
- Escucha solo en `127.0.0.1` (`default_bind`): nadie llega a Caddy sin pasar por el túnel.
- Compresión, cabeceras de seguridad y bloqueo de archivos ocultos (`.git`, `.env`…) en todos
  los sitios.
- Un dominio que no tenga archivo en `sitios/` responde "Sitio no configurado" (404).

> Si quieres entrar también directamente desde la red interna, agrega la IP privada del
> servidor en `default_bind` (p. ej. `default_bind 127.0.0.1 10.0.0.5`) y permite el puerto 80
> solo desde esa red: `sudo ufw allow from 10.0.0.0/8 to any port 80 proto tcp` (ajusta el rango).

## 8. Túnel de Cloudflare + Cloudflare Access

### 8.1 Instalar cloudflared

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared
```

### 8.2 Crear el túnel (desde el panel, lo más simple)

1. En **Cloudflare Zero Trust** → **Networks → Tunnels** → **Create a tunnel** → tipo *Cloudflared*.
2. Nombre: `vps-ovh` (un solo túnel sirve para todos los subdominios). Elige *Debian / 64-bit*
   y copia el comando que aparece:
   ```bash
   sudo cloudflared service install <TOKEN_QUE_ENTREGA_CLOUDFLARE>
   ```
   Ejecútalo en el servidor. El túnel queda como servicio y arranca solo.
3. En **Public Hostname** agrega:
   - Subdominio: `wiki` · Dominio: `aysen.app`
   - Service: **HTTP** → `localhost:80`

   Cada subdominio nuevo es otro *Public Hostname* en el mismo túnel, también hacia
   `localhost:80`: Caddy decide qué sitio mostrar según el dominio.

### 8.3 Proteger con Cloudflare Access (login por correo)

1. **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Dominio: `wiki.aysen.app` (repite la aplicación para cada subdominio, p. ej. `fichas.aysen.app`).
3. Política **Allow** → *Include* → **Emails ending in** `@saesa.cl`
   (o *Emails* con la lista exacta de correos autorizados).
4. Método de login: **One-time PIN** (código enviado al correo).

> Los nombres de los menús de Cloudflare pueden variar levemente, pero los pasos son los mismos.

Con esto, cualquiera que entre a `https://wiki.aysen.app` primero se valida con su correo
(Cloudflare) y luego ve la biblioteca. Para crear o editar procedimientos usa el botón **Ingresar**
(arriba a la derecha) con `up_user` o `admin_user`.

## 9. Respaldo diario (incremental con restic)

El respaldo usa **restic**: cifrado, y cada día guarda solo lo nuevo o modificado. Conserva
7 respaldos diarios, 4 semanales y 6 mensuales, y el repositorio ocupa aproximadamente lo
mismo que los datos (no se multiplica por cada copia).

### 9.1 Crear la clave del respaldo

```bash
openssl rand -base64 32 | sudo tee /etc/wiki/restic.pass >/dev/null
sudo chown wiki:wiki /etc/wiki/restic.pass
sudo chmod 600 /etc/wiki/restic.pass
sudo cat /etc/wiki/restic.pass      # ⚠ guárdala en tu gestor de contraseñas
```

> **Importante:** sin esta clave los respaldos **no se pueden recuperar**. Guárdala fuera
> del servidor.

### 9.2 Activar el respaldo automático (todos los días a las 02:30)

```bash
sudo cp /srv/wiki/app/deploy/wiki-respaldo.service /srv/wiki/app/deploy/wiki-respaldo.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wiki-respaldo.timer
sudo systemctl start wiki-respaldo.service      # primera copia (crea el repositorio)
journalctl -u wiki-respaldo -n 20 --no-pager    # resultado
```

Ver las copias disponibles:

```bash
sudo restic -r /var/backups/wiki-restic --password-file /etc/wiki/restic.pass snapshots
```

### 9.3 Restaurar

```bash
sudo systemctl stop wiki
# 1) extraer la copia más reciente (o un ID de la lista de snapshots) a una carpeta temporal
sudo restic -r /var/backups/wiki-restic --password-file /etc/wiki/restic.pass \
     restore latest --target /tmp/wiki-restaurar
# 2) reemplazar los datos actuales (-H conserva los enlaces entre versiones)
sudo rsync -aH --delete /tmp/wiki-restaurar/srv/wiki/data/ /srv/wiki/data/
sudo rm -r /tmp/wiki-restaurar
sudo systemctl start wiki
```

### 9.4 Protección fuera del servidor

Este respaldo vive **en el mismo disco**: protege ante borrados o errores, pero no ante la
pérdida del servidor. Mientras no uses otro destino, activa en el panel de OVH la opción de
**respaldo automático** del VPS (*Automated Backup*) o toma **snapshots** periódicos: copian el
disco completo fuera de la máquina.

Cuando quieras respaldar fuera (OVHcloud Object Storage u otro S3), solo cambia en
`/etc/systemd/system/wiki-respaldo.service` la línea `RESTIC_REPOSITORY=` por el destino
(p. ej. `s3:https://s3.<región>.io.cloud.ovh.net/mi-bucket/wiki`) y agrega las credenciales
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.

## 10. Actualizar la wiki

```bash
cd /srv/wiki/app && sudo git pull origin main
sudo systemctl restart wiki
```

## 11. Mover la biblioteca a otro servicio

Toda la información vive en carpetas legibles:

```
/srv/wiki/data/biblioteca/<Categoría>/<Subcategoría>/.../<ficha>/
    ficha.json                   ← historial de versiones
    v1.0/<ficha>_v1.0.pdf        ← PDF
    v1.0/datos.json + img/       ← contenido para volver a editar
```

Basta con copiar `biblioteca/` al nuevo destino con `rsync -aH` (o `tar`). La opción `-H`
conserva los enlaces: las imágenes que no cambian entre versiones son el mismo archivo en
disco y sin `-H` se copiarían duplicadas (funciona igual, pero ocupa más). Si agregas o
mueves carpetas a mano, entra como `admin_user` → **Papelera → Reconstruir índice**
(o reinicia el servicio).

## 12. Agregar otro subdominio (sitio de HTML estático)

Ejemplo con `fichas.aysen.app`; para otro sitio usa la plantilla
`deploy/caddy/sitios/plantilla-estatico.caddy.ejemplo` y cambia `NOMBRE`.

```bash
# 1) archivos del sitio
sudo mkdir -p /srv/fichas/public
sudo cp -r /ruta/del/html/* /srv/fichas/public/      # index.html y demás archivos
sudo chmod -R a+rX /srv/fichas

# 2) configuración de Caddy
sudo cp /srv/wiki/app/deploy/caddy/sitios/fichas.caddy /etc/caddy/sitios/
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
curl -sI -H "Host: fichas.aysen.app" http://127.0.0.1/ | head -1   # → HTTP/1.1 200 OK
```

3) En Cloudflare: agrega el *Public Hostname* `fichas.aysen.app` → `http://localhost:80` en el
   mismo túnel, y protégelo con Cloudflare Access (sección 8.3).

Quitar un sitio: borrar su archivo de `/etc/caddy/sitios/`, `sudo systemctl reload caddy` y
eliminar su *Public Hostname* en Cloudflare.

## Diagnóstico

| Qué revisar          | Comando                                   |
|----------------------|-------------------------------------------|
| Logs del backend     | `journalctl -u wiki -f`                   |
| Logs de Caddy        | `journalctl -u caddy -f`                  |
| Sitios activos       | `ls /etc/caddy/sitios/`                   |
| Estado del túnel     | `systemctl status cloudflared`            |
| Usuarios con clave   | `sudo -u wiki env WIKI_DATA_DIR=/srv/wiki/data node /srv/wiki/app/server/cli.js usuarios` |
| Último respaldo      | `journalctl -u wiki-respaldo -n 20 --no-pager` |
| Auditoría de cambios | `sudo tail -f /srv/wiki/data/config/auditoria.log` |
