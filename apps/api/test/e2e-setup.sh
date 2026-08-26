#!/usr/bin/env bash
#
# Prepara o banco dos testes e2e.
#
# Usa um database separado (gateway_test) e o recria do zero: rodar e2e contra o
# banco de desenvolvimento apagaria dados reais entre execuções.
#
set -euo pipefail

cd "$(dirname "$0")/../../.."

set -a
# shellcheck disable=SC1091
[[ -f .env ]] && source .env
set +a

DB_TESTE="${POSTGRES_DB:-gateway}_test"

echo "Recriando o database $DB_TESTE"

docker compose exec -T postgres psql -U "${POSTGRES_USER:-gateway}" -d postgres \
  -c "DROP DATABASE IF EXISTS ${DB_TESTE} WITH (FORCE);" \
  -c "CREATE DATABASE ${DB_TESTE};" >/dev/null

# Substitui apenas o nome do database, que é o último segmento do caminho.
# Uma troca ingênua de "/gateway" pegaria o "//gateway" do próprio esquema
# (postgresql://gateway:senha@...) e produziria uma URL inválida.
export DATABASE_URL=$(echo "$DATABASE_URL" | sed -E "s#/${POSTGRES_DB:-gateway}(\?|$)#/${DB_TESTE}\1#")

echo "Aplicando migrations"
cd apps/api
pnpm exec prisma migrate deploy >/dev/null

echo "Pronto."
