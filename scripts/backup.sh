#!/usr/bin/env bash
#
# Backup dos dois databases: `gateway` (aplicações, chaves, sessões, mensagens,
# auditoria) e `waha` (as sessões de WhatsApp em si).
#
# Os dois importam. Restaurar só o `gateway` deixaria os números desconectados,
# exigindo escanear todos os QR de novo.
#
# Uso:
#   ./scripts/backup.sh                    # usa o compose de produção
#   COMPOSE=docker-compose.yml ./scripts/backup.sh
#
# Agendamento sugerido (crontab -e), diário às 3h:
#   0 3 * * * cd /caminho/do/projeto && ./scripts/backup.sh >> backups/backup.log 2>&1
#
set -euo pipefail

cd "$(dirname "$0")/.."

set -a
# shellcheck disable=SC1091
[[ -f .env ]] && source .env
set +a

COMPOSE="${COMPOSE:-docker-compose.prod.yml}"
DESTINO="${BACKUP_DIR:-backups}"
RETENCAO_DIAS="${BACKUP_RETENTION_DAYS:-14}"
USUARIO="${POSTGRES_USER:-gateway}"
CARIMBO=$(date +%Y%m%d-%H%M%S)

mkdir -p "$DESTINO"

echo "[$(date '+%F %T')] Iniciando backup"

for banco in "${POSTGRES_DB:-gateway}" "${WAHA_POSTGRES_DB:-waha}"; do
  arquivo="$DESTINO/${banco}-${CARIMBO}.sql.gz"

  # --clean --if-exists deixa o dump auto-suficiente: a restauração não exige
  # um database vazio, o que costuma ser exatamente o que não se tem numa
  # emergência.
  docker compose -f "$COMPOSE" exec -T postgres \
    pg_dump -U "$USUARIO" --clean --if-exists --no-owner "$banco" \
    | gzip -9 > "$arquivo"

  tamanho=$(du -h "$arquivo" | cut -f1)
  echo "  $banco -> $arquivo ($tamanho)"

  # Um dump truncado passa despercebido até a hora de restaurar. Conferir a
  # integridade do gzip agora custa segundos.
  if ! gzip -t "$arquivo"; then
    echo "  ERRO: o arquivo de $banco está corrompido" >&2
    exit 1
  fi
done

echo "[$(date '+%F %T')] Removendo backups com mais de $RETENCAO_DIAS dias"
find "$DESTINO" -name '*.sql.gz' -mtime "+$RETENCAO_DIAS" -print -delete | sed 's/^/  removido: /'

echo "[$(date '+%F %T')] Concluído."
