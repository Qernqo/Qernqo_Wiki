#!/usr/bin/env bash
# Respaldo incremental y cifrado de la wiki con restic.
# Solo guarda lo nuevo o modificado (deduplicación), por lo que el repositorio
# ocupa ~1,1 veces el tamaño de los datos aunque se conserven muchas copias.
#
# Para respaldar fuera del servidor más adelante basta con cambiar
# RESTIC_REPOSITORY (p. ej. s3:https://s3.<región>.io.cloud.ovh.net/mi-bucket/wiki)
# y definir AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
set -euo pipefail

DATA_DIR="${WIKI_DATA_DIR:-/srv/wiki/data}"
export RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-/var/backups/wiki-restic}"
export RESTIC_PASSWORD_FILE="${RESTIC_PASSWORD_FILE:-/etc/wiki/restic.pass}"

# ¿Existe el repositorio? Solo se crea si realmente no existe; cualquier otro
# error (clave incorrecta, permisos, red) se informa tal cual y detiene el respaldo.
if ! error=$(restic cat config 2>&1 >/dev/null); then
  if grep -qiE 'does not exist|no such file|Is there a repository' <<<"$error"; then
    echo "Inicializando repositorio de respaldo en $RESTIC_REPOSITORY"
    restic init
  else
    echo "ERROR: no se pudo abrir el repositorio de respaldo: $error" >&2
    exit 1
  fi
fi

incluir=()
for d in biblioteca papelera config; do
  [[ -d "$DATA_DIR/$d" ]] && incluir+=("$DATA_DIR/$d")
done

# Código 3 = copia creada, pero algún archivo no se pudo leer (p. ej. un
# temporal que desapareció durante la copia): se avisa y se continúa.
codigo=0
restic backup --tag wiki --host wiki "${incluir[@]}" || codigo=$?
if [[ $codigo -eq 3 ]]; then
  echo "ADVERTENCIA: respaldo creado, pero algunos archivos no se pudieron leer (ver arriba)" >&2
elif [[ $codigo -ne 0 ]]; then
  echo "ERROR: el respaldo falló (código $codigo)" >&2
  exit "$codigo"
fi

# retención: 7 diarios, 4 semanales y 6 mensuales
restic forget --tag wiki --host wiki --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune

# verificación de integridad los domingos
if [[ "$(date +%u)" == "7" ]]; then
  restic check
fi

restic stats --mode raw-data latest | grep -i 'total size' || true
