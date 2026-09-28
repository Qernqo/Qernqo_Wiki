# Instalación en servidor local con Docker (Ubuntu Server)

Arquitectura final:

```
Usuario ─► Cloudflare Access (login por correo) ─► Túnel Cloudflare
                                                       │
  Servidor local (Docker) ─────────────────────────────┼──────────────────────────────
                                                       ▼
                               contenedor cloudflared ─► contenedor caddy :8080
                                                            ├─ /            → public/ (del repo)
                                                            ├─ /archivos/*  → /srv/wiki/data/biblioteca
                                                            └─ /api/*       → contenedor wiki :3000 (Node.js)

  /srv/wiki/data  ◄── restic (en el servidor) ──► disco USB externo, todos los días a las 02:30
```

- **No se abren puertos**, ni en el router ni en el servidor, y **no se necesita IP pública**:
  el túnel sale desde el servidor hacia Cloudflare.
- El HTTPS lo pone Cloudflare; dentro del servidor todo viaja en HTTP por la red de Docker.
- El contenedor `wiki` **no tiene salida a Internet**; solo Caddy lo alcanza.
- Los contenedores corren con el sistema de archivos en solo lectura, sin privilegios y con
  límite de memoria. Se reinician solos si fallan o si el servidor se reinicia.
- Los datos (biblioteca, papelera, claves) viven **fuera de los contenedores**, en
  `/srv/wiki/data`: se pueden respaldar, copiar o mover como carpetas normales.

Todos los comandos se ejecutan como un usuario con `sudo`.

### Tamaño

Estimación para ~500 procedimientos con 10 imágenes cada uno e historial de versiones:

| Uso                                                                | Estimado |
|--------------------------------------------------------------------|----------|
| Sistema, Docker e imágenes (Node, Caddy, cloudflared)              | ~6 GB    |
| Biblioteca (las imágenes repetidas entre versiones no se duplican) | ~5 GB    |
| Respaldo incremental (en el USB)                                   | ~6 GB    |

Memoria: la wiki usa ~100–200 MB; el conjunto funciona con holgura en 2 GB de RAM o más.

---

## 1. Preparar el sistema

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git ca-certificates curl unattended-upgrades
sudo timedatectl set-timezone America/Santiago
sudo dpkg-reconfigure -plow unattended-upgrades   # actualizaciones de seguridad automáticas
```

El servidor debe quedar encendido y sin suspensión. En un equipo de escritorio o notebook
usado como servidor:

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

## 2. Instalar Docker y Docker Compose

Desde el repositorio oficial de Docker (trae el plugin `docker compose`):

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo docker run --rm hello-world      # prueba: debe mostrar "Hello from Docker!"
```

Docker queda activado al inicio del sistema.

## 3. Descargar la wiki y crear la carpeta de datos

```bash
sudo mkdir -p /srv/wiki
# (repositorio privado: usa una "deploy key" de solo lectura o un token)
sudo git clone -b main https://github.com/Qernqo/Qernqo_Wiki.git /srv/wiki/app

# datos: deben pertenecer al usuario 1000, con el que corre el contenedor de la wiki
sudo install -d -o 1000 -g 1000 /srv/wiki/data
```

> Crea la carpeta de datos **antes** del primer arranque. Si no existe, Docker la crea como
> `root` y la wiki no podrá escribir en ella (se corrige con `sudo chown -R 1000:1000 /srv/wiki/data`).

## 4. Crear el túnel de Cloudflare

1. En **Cloudflare Zero Trust** → **Networks → Tunnels** → **Create a tunnel** → tipo *Cloudflared*.
2. Nombre: `wiki-soporte-ti`. En la pantalla de instalación elige **Docker** y copia **solo el
   token**: el texto largo que aparece después de `--token` en el comando que muestra Cloudflare.
   No ejecutes ese comando: el contenedor `cloudflared` ya viene en esta instalación.
3. En **Public Hostname** agrega:
   - Subdominio: `wiki` · Dominio: `aysen.app`
   - Service: **HTTP** → `caddy:8080`

   `caddy` es el nombre del contenedor dentro de la red de Docker; no uses `localhost`.

Guarda el token en el archivo de variables:

```bash
cd /srv/wiki/app
sudo cp .env.ejemplo .env
sudo chmod 600 .env
sudo nano .env          # pega el token en TUNNEL_TOKEN= ; WIKI_DATOS=/srv/wiki/data
```

## 5. Construir la wiki y crear las claves de los usuarios

```bash
cd /srv/wiki/app
sudo docker compose build

sudo docker compose run --rm wiki node server/cli.js clave admin_user
sudo docker compose run --rm wiki node server/cli.js clave up_user
sudo docker compose run --rm wiki node server/cli.js usuarios      # ambos "con clave"
```

Cada clave debe tener al menos 10 caracteres. Para cambiar una clave más adelante se usa el
mismo comando; las sesiones abiertas de ese usuario se cierran.

## 6. Levantar la wiki

```bash
cd /srv/wiki/app
sudo docker compose up -d
sudo docker compose ps          # wiki "healthy"; caddy y cloudflared "Up"
```

Comprobaciones:

```bash
# Caddy responde dentro del servidor (debe mostrar "HTTP/1.1 200 OK")
sudo docker compose exec caddy wget -S -q -O /dev/null http://localhost:8080/ 2>&1 | head -1
# el túnel quedó conectado (debe mostrar "Registered tunnel connection")
sudo docker compose logs cloudflared | grep -i registered
```

En el panel de Cloudflare el túnel debe aparecer como **HEALTHY**.

## 7. Proteger con Cloudflare Access (login por correo)

1. **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Dominio: `wiki.aysen.app`.
3. Política **Allow** → *Include* → **Emails ending in** `@saesa.cl`
   (o *Emails* con la lista exacta de correos autorizados).
4. Método de login: **One-time PIN** (código enviado al correo).
5. En el panel del dominio: **SSL/TLS → Edge Certificates → Always Use HTTPS = activado**.
   La wiki marca su cookie de sesión como solo-HTTPS.
6. En el panel del dominio: **Speed → Optimization → Content Optimization → Rocket Loader =
   desactivado**. Rocket Loader inyecta un script de Cloudflare que la política de seguridad de
   la wiki (CSP) bloquea, y la página dejaría de funcionar. Por lo mismo, no actives otras
   funciones que inyectan scripts en las páginas (p. ej. *Email Address Obfuscation* o el
   *beacon* automático de Web Analytics).

> Los nombres de los menús de Cloudflare pueden variar levemente, pero los pasos son los mismos.

Con esto, cualquiera que entre a `https://wiki.aysen.app` primero se valida con su correo
(Cloudflare) y luego ve la biblioteca. Para crear o editar procedimientos usa el botón **Ingresar**
(arriba a la derecha) con `up_user` o `admin_user`.

## 8. Respaldo diario en disco USB (incremental con restic)

El respaldo corre **en el servidor** (fuera de Docker) y usa **restic**: cifrado, y cada día
guarda solo lo nuevo o modificado. Conserva 7 respaldos diarios, 4 semanales y 6 mensuales,
y el repositorio ocupa aproximadamente lo mismo que los datos. Los domingos verifica la
integridad del repositorio.

### 8.1 Preparar el disco USB (una sola vez)

Identifica el disco (compara la salida con el USB conectado y desconectado):

```bash
lsblk -o NAME,SIZE,FSTYPE,LABEL,MODEL
```

Si el disco es nuevo o se puede borrar, dale formato ext4 (⚠ **borra todo su contenido**;
reemplaza `sdX1` por la partición correcta):

```bash
sudo mkfs.ext4 -L respaldo-wiki /dev/sdX1
```

Móntalo siempre en la misma ruta, identificándolo por su UUID:

```bash
sudo blkid /dev/sdX1                       # copia el UUID="…"
sudo mkdir -p /mnt/respaldo-usb
echo 'UUID=<UUID-DEL-DISCO> /mnt/respaldo-usb ext4 defaults,nofail,x-systemd.device-timeout=10s 0 2' | sudo tee -a /etc/fstab
sudo systemctl daemon-reload
sudo mount -a && findmnt /mnt/respaldo-usb  # debe mostrar el disco
```

`nofail` permite que el servidor arranque aunque el USB no esté conectado.

### 8.2 Instalar restic y crear la clave del respaldo

```bash
sudo apt install -y restic
sudo install -d -m 700 /etc/wiki
openssl rand -base64 32 | sudo tee /etc/wiki/restic.pass >/dev/null
sudo chmod 600 /etc/wiki/restic.pass
sudo cat /etc/wiki/restic.pass      # ⚠ guárdala en tu gestor de contraseñas
```

> **Importante:** sin esta clave los respaldos **no se pueden recuperar**. Guárdala fuera
> del servidor.

### 8.3 Activar el respaldo automático (todos los días a las 02:30)

```bash
sudo cp /srv/wiki/app/deploy/wiki-respaldo.service /srv/wiki/app/deploy/wiki-respaldo.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wiki-respaldo.timer
sudo systemctl start wiki-respaldo.service      # primera copia (crea el repositorio en el USB)
journalctl -u wiki-respaldo -n 20 --no-pager    # resultado
```

Ver las copias disponibles:

```bash
sudo restic -r /mnt/respaldo-usb/wiki-restic --password-file /etc/wiki/restic.pass snapshots
```

**Si el USB no está montado**, el respaldo de ese día se detiene con error
(`el disco de respaldo no está montado`) y **no escribe nada en el disco interno**. El respaldo
no envía avisos: revísalo de vez en cuando.

```bash
systemctl status wiki-respaldo --no-pager     # "status=0/SUCCESS" = correcto
journalctl -u wiki-respaldo -n 20 --no-pager  # "ADVERTENCIA" = copia creada con algún archivo omitido
```

### 8.4 Restaurar

```bash
cd /srv/wiki/app
sudo docker compose stop wiki caddy
# 1) extraer la copia más reciente (o un ID de la lista de snapshots) a una carpeta temporal
sudo restic -r /mnt/respaldo-usb/wiki-restic --password-file /etc/wiki/restic.pass \
     restore latest --target /tmp/wiki-restaurar
# 2) reemplazar los datos actuales (-H conserva los enlaces entre versiones)
sudo rsync -aH --delete /tmp/wiki-restaurar/srv/wiki/data/ /srv/wiki/data/
sudo chown -R 1000:1000 /srv/wiki/data
sudo rm -r /tmp/wiki-restaurar
sudo docker compose start wiki caddy
```

> El USB protege ante borrados, errores y fallas del disco del servidor, pero **no** ante un
> robo, incendio o daño eléctrico que afecte a ambos. Cuando sea posible, guarda una segunda
> copia fuera del lugar (otro USB rotado periódicamente o un almacenamiento en la nube:
> restic admite S3, Backblaze B2, etc. cambiando `RESTIC_REPOSITORY`).

## 9. Actualizar

Nueva versión de la wiki:

```bash
cd /srv/wiki/app
sudo git pull origin main
sudo docker compose up -d --build
```

Usa siempre `--build`: el código de la API vive dentro de la imagen y la interfaz se lee desde
el repositorio; así ambas quedan en la misma versión.

Una vez al mes, actualiza también Caddy, cloudflared y la imagen base de Node:

```bash
cd /srv/wiki/app
sudo docker compose pull
sudo docker compose build --pull
sudo docker compose up -d
sudo docker image prune -f          # borra imágenes antiguas
```

## 10. Mover la biblioteca a otro servicio

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
(o reinicia con `sudo docker compose restart wiki`).

Para llevar la wiki completa a otro servidor: instala según esta guía (pasos 1 a 3), copia
`/srv/wiki/data` con `sudo rsync -aH` y el archivo `.env`, y levanta con el paso 6.

## Diagnóstico

Todos los comandos desde `/srv/wiki/app`:

| Qué revisar                 | Comando                                              |
|-----------------------------|------------------------------------------------------|
| Estado de los contenedores  | `sudo docker compose ps`                             |
| Logs de la wiki             | `sudo docker compose logs -f wiki`                   |
| Logs de Caddy               | `sudo docker compose logs -f caddy`                  |
| Estado del túnel            | `sudo docker compose logs --tail 20 cloudflared`     |
| Wiki responde en el servidor | `sudo docker compose exec caddy wget -S -q -O /dev/null http://localhost:8080/ 2>&1 \| head -1` |
| Usuarios con clave          | `sudo docker compose run --rm wiki node server/cli.js usuarios` |
| Memoria y CPU               | `sudo docker stats --no-stream`                      |
| Último respaldo             | `journalctl -u wiki-respaldo -n 20 --no-pager`       |
| USB montado                 | `findmnt /mnt/respaldo-usb`                          |
| Auditoría de cambios        | `sudo tail -f /srv/wiki/data/config/auditoria.log`   |

Problemas comunes:

| Síntoma | Causa probable |
|---|---|
| La wiki arranca y se reinicia con `EACCES` en los logs | La carpeta de datos no pertenece al usuario 1000: `sudo chown -R 1000:1000 /srv/wiki/data` |
| Cloudflare muestra error 502 / 1033 | El hostname del túnel no apunta a `caddy:8080`, o el contenedor `cloudflared` está detenido |
| `docker compose` pide `TUNNEL_TOKEN` | Falta el archivo `.env` o el token está vacío (paso 4) |
| No se puede ingresar (el login no se mantiene) | Se está entrando por `http://`: activa *Always Use HTTPS* (paso 7.5) |
| La página se ve en blanco | Rocket Loader u otra función que inyecta scripts está activa (paso 7.6) |
