# Instalación en Vultr (Ubuntu 24.04 LTS)

Arquitectura final:

```
Usuario ─► Cloudflare Access (login por correo) ─► Túnel Cloudflare
        ─► cloudflared (en el servidor) ─► Caddy :80 ─┬─ /            → /srv/wiki/app/public
                                                     ├─ /archivos/*  → /srv/wiki/data/biblioteca
                                                     └─ /api/*       → Node.js :3000 (systemd: wiki)
```

- **No se abren puertos** a Internet: el túnel sale desde el servidor hacia Cloudflare.
- El HTTPS lo pone Cloudflare; Caddy trabaja solo en HTTP local.
- El backend **no usa dependencias npm**: basta con Node.js.

Todos los comandos se ejecutan como un usuario con `sudo`.

---

## 1. Preparar el sistema

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl gpg debian-keyring debian-archive-keyring apt-transport-https ufw
sudo timedatectl set-timezone America/Santiago
```

Firewall (solo SSH; el túnel no necesita puertos de entrada):

```bash
sudo ufw allow OpenSSH
sudo ufw enable
```

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

sudo mkdir -p /srv/wiki /etc/wiki /var/backups/wiki
sudo git clone https://github.com/qernqo/qernqo_wiki.git /srv/wiki/app
#  (repositorio privado: usa una "deploy key" de solo lectura o un token)

sudo mkdir -p /srv/wiki/data
sudo chown -R wiki:wiki /srv/wiki/data /var/backups/wiki
sudo chmod 755 /srv/wiki /srv/wiki/data
sudo chmod +x /srv/wiki/app/deploy/respaldo.sh

sudo cp /srv/wiki/app/deploy/wiki.env.ejemplo /etc/wiki/wiki.env
```

## 5. Crear las claves de los usuarios

La wiki tiene dos usuarios fijos:

| Usuario      | Permisos                                          |
|--------------|---------------------------------------------------|
| `admin_user` | Acceso total (incluye eliminar y papelera)        |
| `up_user`    | Crear y modificar fichas y categorías (no elimina)|

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

## 7. Configurar Caddy

```bash
sudo cp /srv/wiki/app/deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
curl -sI http://127.0.0.1/ | head -1          # → HTTP/1.1 200 OK
```

> Si quieres entrar también directamente desde la red interna (VPC de Vultr), agrega la IP
> privada del servidor en la línea `bind` del Caddyfile y permite el puerto 80 solo desde esa
> red: `sudo ufw allow from 10.0.0.0/8 to any port 80 proto tcp` (ajusta el rango).

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
2. Nombre: `wiki-soporte-ti`. Elige *Debian / 64-bit* y copia el comando que aparece:
   ```bash
   sudo cloudflared service install <TOKEN_QUE_ENTREGA_CLOUDFLARE>
   ```
   Ejecútalo en el servidor. El túnel queda como servicio y arranca solo.
3. En **Public Hostname** agrega:
   - Subdominio: `wiki` · Dominio: `tu-dominio.cl`
   - Service: **HTTP** → `localhost:80`

### 8.3 Proteger con Cloudflare Access (login por correo)

1. **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Dominio: `wiki.tu-dominio.cl`.
3. Política **Allow** → *Include* → **Emails ending in** `@saesa.cl`
   (o *Emails* con la lista exacta de correos autorizados).
4. Método de login: **One-time PIN** (código enviado al correo).

> Los nombres de los menús de Cloudflare pueden variar levemente, pero los pasos son los mismos.

Con esto, cualquiera que entre a `https://wiki.tu-dominio.cl` primero se valida con su correo
(Cloudflare) y luego ve la biblioteca. Para crear o editar fichas usa el botón **Ingresar**
(arriba a la derecha) con `up_user` o `admin_user`.

## 9. Respaldo diario

```bash
sudo cp /srv/wiki/app/deploy/wiki-respaldo.service /srv/wiki/app/deploy/wiki-respaldo.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wiki-respaldo.timer
sudo systemctl start wiki-respaldo.service      # prueba inmediata
ls -lh /var/backups/wiki/
```

Se guarda `wiki-AAAA-MM-DD.tar.gz` todos los días a las 02:30 y se conservan 30 días.
Recomendado: activar también los *Automatic Backups* de Vultr o copiar `/var/backups/wiki`
a otro lugar, porque un respaldo en el mismo servidor no protege ante la pérdida del servidor.

Restaurar un respaldo:

```bash
sudo systemctl stop wiki
sudo -u wiki tar -xzf /var/backups/wiki/wiki-AAAA-MM-DD.tar.gz -C /srv/wiki/data
sudo systemctl start wiki
```

## 10. Actualizar la wiki

```bash
cd /srv/wiki/app && sudo git pull
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

Basta con copiar `biblioteca/` (por ejemplo con `rsync -a`) al nuevo destino. Si agregas o
mueves carpetas a mano, entra como `admin_user` → **Papelera → Reconstruir índice**
(o reinicia el servicio).

## Diagnóstico

| Qué revisar          | Comando                                   |
|----------------------|-------------------------------------------|
| Logs del backend     | `journalctl -u wiki -f`                   |
| Logs de Caddy        | `journalctl -u caddy -f`                  |
| Estado del túnel     | `systemctl status cloudflared`            |
| Usuarios con clave   | `sudo -u wiki env WIKI_DATA_DIR=/srv/wiki/data node /srv/wiki/app/server/cli.js usuarios` |
| Auditoría de cambios | `sudo tail -f /srv/wiki/data/config/auditoria.log` |
