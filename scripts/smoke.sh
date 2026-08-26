#!/usr/bin/env bash
#
# Verificação de fumaça: compila, sobe a API e confere que ela responde.
#
# Existe porque `build` e `lint` verdes não garantem que a aplicação sobe. A
# injeção de dependência do NestJS só é resolvida em tempo de execução, então um
# provider mal declarado — ou um `import type` que apagou o metadado de tipo —
# passa por toda a verificação estática e só falha no boot.
#
# Uso:  ./scripts/smoke.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${API_PORT:-3001}"
LOG=$(mktemp)
PID=""

cleanup() {
  [[ -n "$PID" ]] && kill "$PID" 2>/dev/null || true
  rm -f "$LOG"
}
trap cleanup EXIT

falhar() {
  echo "  FALHOU: $1"
  echo
  echo "--- log da aplicação ---"
  tail -30 "$LOG"
  exit 1
}

echo "Compilando..."
pnpm --filter @gateway/shared build >/dev/null
pnpm --filter @gateway/api build >/dev/null

echo "Subindo a API na porta $PORT..."
set -a
# shellcheck disable=SC1091
[[ -f .env ]] && source .env
set +a
API_PORT="$PORT" node apps/api/dist/src/main.js > "$LOG" 2>&1 &
PID=$!

# Espera até 30s pela subida, checando também se o processo morreu.
for i in $(seq 1 30); do
  if ! kill -0 "$PID" 2>/dev/null; then
    falhar "o processo encerrou durante a subida"
  fi
  if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    break
  fi
  [[ $i -eq 30 ]] && falhar "a API não respondeu em 30s"
  sleep 1
done

echo "  liveness   ok"

READY=$(curl -s "http://localhost:${PORT}/health/ready")
echo "$READY" | grep -q '"status":"ok"' || falhar "readiness reprovou: $READY"
echo "  readiness  ok (postgres, redis, waha)"

curl -sf "http://localhost:${PORT}/" >/dev/null || falhar "a raiz não respondeu"
echo "  raiz       ok"

if grep -q '"SWAGGER_ENABLED":true\|SWAGGER_ENABLED=true' .env 2>/dev/null; then
  curl -sf "http://localhost:${PORT}/docs" >/dev/null || falhar "a documentação não abriu"
  echo "  /docs      ok"
fi

echo
echo "Fumaça passou."
