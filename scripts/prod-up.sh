#!/usr/bin/env bash
#
# Sobe (ou atualiza) o gateway em produção com um comando só.
#
#   ./scripts/prod-up.sh
#
# O que faz, na ordem — tudo idempotente, pode rodar quantas vezes quiser:
#   1. garante que a rede compartilhada com o Nginx Proxy Manager existe
#   2. acha o container do NPM (pela imagem jc21/nginx-proxy-manager) e o liga
#      nessa rede, se ainda não estiver
#   3. docker compose -f docker-compose.prod.yml up -d --build
#   4. confere, de dentro do NPM, que o painel responde
#
# Sem NPM na máquina, avisa e sobe mesmo assim: o painel fica acessível só
# quando algum proxy entrar na rede (ou com docker-compose.port.yml).
#
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.prod.yml"

# Lê PROXY_NETWORK do .env sem carregar o arquivo inteiro no ambiente.
NET=$(grep -E '^PROXY_NETWORK=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '[:space:]' || true)
NET=${NET:-npm-proxy}

echo "==> rede do proxy: $NET"
if ! docker network inspect "$NET" >/dev/null 2>&1; then
  docker network create "$NET" >/dev/null
  echo "    criada"
else
  echo "    já existe"
fi

NPM=$(docker ps --filter ancestor=jc21/nginx-proxy-manager --format '{{.Names}}' | head -1 || true)
if [[ -z "$NPM" ]]; then
  # imagem com tag explícita não casa no filtro por ancestor sem tag; tenta pelo nome da imagem
  NPM=$(docker ps --format '{{.Names}} {{.Image}}' | awk '$2 ~ /nginx-proxy-manager/ {print $1; exit}' || true)
fi

if [[ -n "$NPM" ]]; then
  echo "==> Nginx Proxy Manager: $NPM"
  if docker network inspect "$NET" --format '{{range .Containers}}{{.Name}} {{end}}' | grep -qw "$NPM"; then
    echo "    já está na rede $NET"
  else
    docker network connect "$NET" "$NPM"
    echo "    conectado à rede $NET"
  fi
else
  echo "!!  nenhum container do Nginx Proxy Manager em execução."
  echo "    Subindo mesmo assim; o painel só será alcançável quando um proxy entrar na rede $NET"
  echo "    (ou com: $COMPOSE -f docker-compose.port.yml up -d web)."
fi

echo "==> subindo o gateway"
$COMPOSE up -d --build

echo "==> estado"
$COMPOSE ps

if [[ -n "${NPM:-}" ]]; then
  echo "==> teste: NPM -> painel"
  for i in $(seq 1 30); do
    if out=$(docker exec "$NPM" wget -qO- --timeout=3 http://waha-gateway-w51-web/api/health/ready 2>/dev/null); then
      echo "    $out"
      echo
      echo "OK. No NPM, cadastre o Proxy Host apontando para  waha-gateway-w51-web : 80"
      echo "(docs/deploy.md, seção 5 — não esqueça o bloco de SSE na aba Advanced)."
      exit 0
    fi
    sleep 2
  done
  echo "!!  o NPM não conseguiu falar com o painel em 60s. Veja: $COMPOSE logs web api"
  exit 1
fi
