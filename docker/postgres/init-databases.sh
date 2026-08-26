#!/bin/bash
#
# Cria o segundo database usado pelo WAHA para guardar as sessões do WhatsApp.
# Roda uma única vez, na primeira inicialização do volume do Postgres.
#
# O database principal (POSTGRES_DB) é criado pela própria imagem; aqui só
# acrescentamos o do WAHA, mantendo os dois isolados no mesmo servidor.
#
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE ' || quote_ident('${WAHA_POSTGRES_DB}')
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${WAHA_POSTGRES_DB}')\gexec

    GRANT ALL PRIVILEGES ON DATABASE ${WAHA_POSTGRES_DB} TO ${POSTGRES_USER};
EOSQL

echo "[init] database '${WAHA_POSTGRES_DB}' pronto para o WAHA"
