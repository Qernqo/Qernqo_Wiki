#!/usr/bin/env bash
# Respaldo diario de la wiki: comprime biblioteca, papelera y configuración.
set -euo pipefail

DATA_DIR="${WIKI_DATA_DIR:-/srv/wiki/data}"
DESTINO="${WIKI_RESPALDOS:-/var/backups/wiki}"
DIAS="${WIKI_RESPALDO_DIAS:-30}"

mkdir -p "$DESTINO"
incluir=()
for d in biblioteca papelera config; do
  [[ -d "$DATA_DIR/$d" ]] && incluir+=("$d")
done

archivo="$DESTINO/wiki-$(date +%F).tar.gz"
tar -czf "$archivo.tmp" -C "$DATA_DIR" "${incluir[@]}"
mv "$archivo.tmp" "$archivo"
chmod 600 "$archivo"

# conservar solo los últimos $DIAS días
find "$DESTINO" -maxdepth 1 -name 'wiki-*.tar.gz' -mtime "+$DIAS" -delete
echo "Respaldo creado: $archivo ($(du -h "$archivo" | cut -f1))"
