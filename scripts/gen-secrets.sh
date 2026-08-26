#!/usr/bin/env bash
#
# Gera os segredos do .env. Idempotente: só preenche o que estiver vazio,
# preservando valores que você já tenha ajustado à mão.
#
# Uso:
#   ./scripts/gen-secrets.sh          # preenche o que falta
#   ./scripts/gen-secrets.sh --force  # regenera TUDO (invalida sessões e tokens)
#
set -euo pipefail

cd "$(dirname "$0")/.."

FORCE=false
[[ "${1:-}" == "--force" ]] && FORCE=true

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "  .env criado a partir de .env.example"
fi

# 32 bytes aleatórios em base64 url-safe, sem padding
# Lê o valor de uma variável do .env, descartando comentário inline e espaços.
# Sem isso, "PORT=3000  # comentário" viraria o valor "3000  # comentário".
read_var() {
  grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed -e 's/[[:space:]]*#.*$//' -e 's/[[:space:]]*$//'
}

gen() { openssl rand -base64 32 | tr -d '\n=' | tr '+/' '-_'; }
# senha legível o bastante para digitar, forte o bastante para não ser adivinhada
gen_pass() { openssl rand -base64 18 | tr -d '\n=' | tr '+/' 'Aa'; }

set_var() {
  local key="$1" value="$2"
  local current
  current=$(read_var "$key")

  if [[ -n "$current" && "$FORCE" == false ]]; then
    echo "  $key já definido, mantido"
    return
  fi

  # o delimitador | evita colisão com / e + presentes em base64
  if grep -qE "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    echo "${key}=${value}" >> .env
  fi
  echo "  $key gerado"
}

echo "Gerando segredos em .env"
$FORCE && echo "  MODO --force: todos os segredos serão substituídos"

PG_PASS_EXISTING=$(read_var POSTGRES_PASSWORD)
set_var POSTGRES_PASSWORD "$(gen_pass)"
set_var WAHA_API_KEY "$(gen)"
set_var WAHA_WEBHOOK_HMAC_KEY "$(gen)"
set_var JWT_SECRET "$(gen)"
set_var JWT_REFRESH_SECRET "$(gen)"
set_var ADMIN_PASSWORD "$(gen_pass)"

# DATABASE_URL precisa embutir a senha do Postgres — reconstruída sempre que a
# senha muda, senão a API tenta conectar com credencial velha.
PG_USER=$(read_var POSTGRES_USER)
PG_PASS=$(read_var POSTGRES_PASSWORD)
PG_DB=$(read_var POSTGRES_DB)
PG_PORT=$(read_var POSTGRES_PORT)

if [[ "$PG_PASS" != "$PG_PASS_EXISTING" || "$FORCE" == true ]]; then
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://${PG_USER}:${PG_PASS}@localhost:${PG_PORT}/${PG_DB}?schema=public|" .env
  echo "  DATABASE_URL reconstruída com a senha nova"
fi

# REDIS_URL acompanha a porta escolhida
R_PORT=$(read_var REDIS_PORT)
sed -i "s|^REDIS_URL=.*|REDIS_URL=redis://localhost:${R_PORT}|" .env

# WAHA_BASE_URL e GATEWAY_INTERNAL_URL acompanham as portas escolhidas
W_PORT=$(read_var WAHA_PORT)
A_PORT=$(read_var API_PORT)
sed -i "s|^WAHA_BASE_URL=.*|WAHA_BASE_URL=http://localhost:${W_PORT}|" .env
sed -i "s|^GATEWAY_INTERNAL_URL=.*|GATEWAY_INTERNAL_URL=http://host.docker.internal:${A_PORT}|" .env

chmod 600 .env

echo
echo "Pronto. Credenciais do painel:"
echo "  usuário: $(read_var ADMIN_USERNAME)"
echo "  senha:   $(read_var ADMIN_PASSWORD)"
echo
echo "O .env está em modo 600 e no .gitignore. Guarde a senha acima."
