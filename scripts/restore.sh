#!/usr/bin/env bash
#
# Restaura um backup gerado por scripts/backup.sh.
#
# DESTRUTIVO: sobrescreve o conteúdo atual do database.
#
# Uso:
#   ./scripts/restore.sh backups/gateway-20260826-030000.sql.gz
#
set -euo pipefail

cd "$(dirname "$0")/.."

ARQUIVO="${1:-}"

if [[ -z "$ARQUIVO" ]]; then
  echo "Uso: $0 <arquivo.sql.gz>"
  echo
  echo "Backups disponíveis:"
  ls -1t backups/*.sql.gz 2>/dev/null | head -20 | sed 's/^/  /' || echo "  (nenhum)"
  exit 1
fi

[[ -f "$ARQUIVO" ]] || { echo "Arquivo não encontrado: $ARQUIVO" >&2; exit 1; }

set -a
# shellcheck disable=SC1091
[[ -f .env ]] && source .env
set +a

COMPOSE="${COMPOSE:-docker-compose.prod.yml}"
USUARIO="${POSTGRES_USER:-gateway}"

# O nome do database vem do próprio arquivo: restaurar o dump do `waha` sobre o
# `gateway` seria um estrago silencioso.
BANCO=$(basename "$ARQUIVO" | sed -E 's/-[0-9]{8}-[0-9]{6}\.sql\.gz$//')

echo "Arquivo : $ARQUIVO"
echo "Database: $BANCO"
echo
echo "Isto SOBRESCREVE o conteúdo atual de \"$BANCO\"."
printf 'Digite o nome do database para confirmar: '
read -r confirmacao

[[ "$confirmacao" == "$BANCO" ]] || { echo "Confirmação não confere. Abortado."; exit 1; }

gzip -t "$ARQUIVO" || { echo "O arquivo está corrompido." >&2; exit 1; }

echo "Restaurando…"
gunzip -c "$ARQUIVO" | docker compose -f "$COMPOSE" exec -T postgres \
  psql -U "$USUARIO" -d "$BANCO" -v ON_ERROR_STOP=1 --quiet

echo "Concluído."
echo
echo "Reinicie os serviços para que reconectem com o estado restaurado:"
echo "  docker compose -f $COMPOSE restart api waha"
