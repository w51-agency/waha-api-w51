#!/bin/sh
#
# Resolve o template do nginx com as variáveis de ambiente e sobe o servidor.
#
# É este passo que permite trocar a porta da API sem reconstruir a imagem.
#
set -eu

: "${API_HOST:=api}"
: "${API_PORT:=3001}"
: "${WEB_INTERNAL_PORT:=80}"
: "${BODY_LIMIT:=25mb}"

# O Express aceita "25mb"; o nginx exige "25m" e se recusa a subir com o sufixo
# completo. Como a variável é compartilhada pelos dois, a conversão acontece
# aqui — em vez de obrigar quem configura a lembrar de dois formatos.
NGINX_BODY_LIMIT=$(echo "$BODY_LIMIT" | sed -E 's/([0-9]+)\s*[kK][bB]?$/\1k/; s/([0-9]+)\s*[mM][bB]?$/\1m/; s/([0-9]+)\s*[gG][bB]?$/\1g/')

export API_HOST API_PORT WEB_INTERNAL_PORT
export BODY_LIMIT="$NGINX_BODY_LIMIT"

envsubst '${API_HOST} ${API_PORT} ${WEB_INTERNAL_PORT} ${BODY_LIMIT}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

echo "[painel] porta ${WEB_INTERNAL_PORT} | API em ${API_HOST}:${API_PORT} | corpo máx ${BODY_LIMIT}"

exec nginx -g 'daemon off;'
