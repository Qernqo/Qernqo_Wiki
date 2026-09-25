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

# crear el repositorio la primera vez
if ! restic cat config >/dev/null 2>&1; then
  echo "Inicializando repositorio de respaldo en $RESTIC_REPOSITORY"
  restic init
fi

incluir=()
for d in biblioteca papelera config; do
  [[ -d "$DATA_DIR/$d" ]] && incluir+=("$DATA_DIR/$d")
done

restic backup --tag wiki --host wiki "${incluir[@]}"

# retención: 7 diarios, 4 semanales y 6 mensuales
restic forget --tag wiki --host wiki --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune

# verificación de integridad los domingos
if [[ "$(date +%u)" == "7" ]]; then
  restic check
fi

restic stats --mode raw-data latest | grep -i 'total size' || true
