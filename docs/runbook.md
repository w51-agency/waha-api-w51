# Runbook

O que fazer quando algo dá errado. Organizado pelo sintoma, não pelo componente.

Em todos os comandos, `PROD` é o compose de produção:

```bash
alias dc='docker compose -f docker-compose.prod.yml'
```

---

## Primeiro: onde olhar

```bash
dc ps                                       # quem está de pé
docker compose -f docker-compose.prod.yml exec web wget -qO- http://localhost/api/health/ready | jq .   # o que a API enxerga (sem porta no host em produção)
dc logs --tail 100 api                      # o que a API disse
```

O `/health/ready` aponta a dependência culpada:

```json
{ "status": "error", "details": { "waha": { "status": "down", "message": "..." } } }
```

**Todo erro da API carrega um `requestId`.** Se alguém reportar um problema, peça esse
valor e busque no log:

```bash
dc logs api | grep "01JCQ8Z5X9K2M4N6P8R0T2V4W6"
```

---

## Um número caiu

**Sintomas:** a sessão aparece como "Parado" ou "Falhou"; envios devolvem 409.

Números caem: o usuário desvincula o aparelho, troca de celular, ou fica muito tempo sem
internet. Não é necessariamente defeito do gateway.

```bash
# O que o painel diz
curl -s localhost:8080/api/admin/sessions -H "authorization: Bearer $TOKEN" | jq '.[] | {label, status, phoneNumber}'

# O que o WAHA diz
dc exec api sh -c 'curl -s http://waha:3000/api/sessions -H "x-api-key: $WAHA_API_KEY"' | jq '.[] | {name, status}'
```

**Se os dois discordam**, a reconciliação corrige em até um minuto (roda por cron). Para
forçar, basta abrir o detalhe da sessão no painel — a leitura sincroniza.

A mesma reconciliação também cuida de duas situações que só aparecem ao trocar de ambiente
ou resetar o banco:

- **Webhook apontando para o host errado** (a sessão foi criada quando o gateway respondia
  em `host.docker.internal`, e agora ele roda em `api`, ou vice-versa). O WAHA guarda a URL
  original para sempre; o cron a substitui pela `GATEWAY_INTERNAL_URL` atual e pelo segredo
  do banco. Procure `Webhook da sessão ... atualizado` no log da API.
- **Sessão órfã** — existe no WAHA com o carimbo do gateway, mas não no banco. Ficaria
  reiniciando e batendo webhook com 401 em loop. O cron a remove do WAHA; procure
  `existia no WAHA mas não no banco` no log. Sessões sem o carimbo não são tocadas.

**"Falhou" logo depois de pedir o QR** normalmente é só o QR que expirou sem ser escaneado:
o WAHA tenta alguns códigos e depois para a sessão. Reinicie pelo painel e escaneie dentro
de ~1 minuto.

**Se o WAHA também diz que caiu:**

1. Reinicie a sessão pelo painel (**Números → ⋮ → Reiniciar**)
2. Se voltar para "Aguardando QR", o pareamento foi desfeito — o usuário precisa escanear
   de novo
3. Se ficar em "Falhou" repetidamente, veja o log: `dc logs waha | grep <nome-da-sessão>`

---

## Nenhuma mensagem chega

**Sintomas:** envios funcionam, mas nada aparece como recebido.

O caminho de entrada é: WhatsApp → WAHA → webhook → gateway. Verifique nessa ordem.

```bash
# 1. O WAHA está entregando? Procure erros de webhook.
dc logs waha | grep -i webhook | tail -20

# 2. O gateway está recebendo?
dc logs api | grep internal/waha/webhook | tail -20

# 3. Eventos registrados nos últimos 10 minutos
dc exec postgres psql -U gateway -d gateway -c \
  "select event_type, count(*) from inbound_events
   where received_at > now() - interval '10 minutes' group by event_type;"
```

**401 na ingestão** significa assinatura inválida. Quase sempre é o `webhookSecret` da
sessão fora de sincronia com o que o WAHA tem — acontece se a sessão foi recriada no WAHA
por fora. Solução: recriar a sessão pelo painel.

**Nada nos logs** significa que o WAHA não está chamando. Confira o `GATEWAY_INTERNAL_URL`:

```bash
dc exec api printenv GATEWAY_INTERNAL_URL   # deve ser http://api:3001 em produção
```

Em produção **não** pode ser `host.docker.internal` — isso é configuração de
desenvolvimento, onde a API roda fora do container.

---

## Um integrador não recebe os webhooks dele

```bash
TOKEN=...  # login no painel
curl -s localhost:8080/api/admin/webhook-endpoints -H "authorization: Bearer $TOKEN" | jq '.[] | {url, active, consecutiveFailures, disabledReason}'
```

**`active: false` com `disabledReason` preenchido** — o endpoint foi desligado
automaticamente após falhas consecutivas demais. O motivo diz qual foi o último erro.
Depois de corrigir do lado do integrador, reative pelo painel (**Webhooks → Reativar**),
o que também zera o contador.

**Entregas presas em `RETRYING`** — o endpoint responde erro ou demora demais. Veja o
histórico no painel: ele traz o código HTTP e o corpo da resposta de cada tentativa.

Lembre o integrador de que o endpoint precisa **responder 2xx rapidamente** e processar de
forma assíncrona. Entregas que estouram o tempo limite são retentadas, o que costuma piorar
a carga do lado dele.

---

## A fila de webhooks travou

```bash
dc exec redis redis-cli LLEN bull:webhook-delivery:wait
dc exec redis redis-cli LLEN bull:webhook-delivery:active
```

**`active` alto e parado** indica trabalhos presos. Reiniciar a API os devolve à fila:

```bash
dc restart api
```

**`wait` crescendo sem parar** significa que a produção supera o consumo. Verifique se
algum endpoint está lento; um destino que demora 10s por entrega segura a concorrência
inteira.

---

## A API não sobe

```bash
dc logs api --tail 50
```

**"Configuração inválida"** — a validação de ambiente lista exatamente quais variáveis
estão faltando ou malformadas. Corrija o `.env` e suba de novo.

**"Cannot find module"** — a imagem foi construída incompleta. Reconstrua sem cache:

```bash
dc build --no-cache api && dc up -d api
```

**Fica reiniciando** — quase sempre é dependência indisponível. O `depends_on` cobre a
subida inicial, mas se o Postgres cair depois, a API o acompanha:

```bash
dc ps
dc logs postgres --tail 30
```

---

## O painel abre mas não mostra dados

**Erro 502 no `/api`** — a API está fora do ar (veja acima).

**Carrega mas fica desatualizado** — a conexão ao vivo caiu. O indicador na barra superior
mostra "reconectando" em vez de "ao vivo". Causa mais comum: um proxy na frente do painel
com buffer ligado. O SSE precisa de `proxy_buffering off` (nginx) ou `flush_interval -1`
(Caddy).

**Sessão expira toda hora** — verifique se `JWT_SECRET` mudou entre reinícios. Se o `.env`
foi regenerado com `--force`, todos os tokens existentes foram invalidados.

---

## O disco encheu

```bash
df -h
docker system df
```

Os suspeitos, em ordem:

```bash
# 1. Mídia recebida — o maior de longe
dc exec waha du -sh /app/media

# 2. Log dos containers (rotacionado em 20MB×5 por serviço)
du -sh /var/lib/docker/containers/*/*-json.log | sort -h | tail -5

# 3. Backups
du -sh backups/

# 4. Imagens antigas
docker image prune -a
```

Para conter o crescimento da mídia, defina um tempo de vida no `.env`:

```bash
WHATSAPP_FILES_LIFETIME=604800   # 7 dias, em segundos
```

O padrão é `0` (nunca remove), porque apagar mídia que o integrador ainda não baixou é pior
do que gastar disco. Ajuste conforme o volume.

### Tabelas que crescem

```sql
-- Maiores tabelas
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 5;
```

`messages` é a que mais cresce (o campo `raw` guarda o payload completo). `inbound_events` e
`audit_logs` têm expurgo automático, controlado por `AUDIT_RETENTION_DAYS`.

---

## Perdi a senha do painel

Ela está no `.env`:

```bash
grep ADMIN_PASSWORD .env
```

Para trocar: edite o valor e reinicie a API. Não há recuperação por e-mail — é usuário
único por configuração, por decisão de projeto.

---

## Perdi uma API key

Não há recuperação: só o hash argon2 é guardado. Emita outra pelo painel e revogue a antiga.

Se a chave **vazou**, revogue primeiro — o efeito é imediato, sem esperar cache.

---

## Preciso descobrir quem fez algo

A auditoria responde. No painel, **Auditoria**, com filtros por ação, autor e período.

Por SQL, quando o painel não está acessível:

```sql
-- Quem pediu QR desta sessão e quando
SELECT created_at, actor_type, actor_label, action, ip
FROM audit_logs
WHERE resource_type = 'session' AND resource_id = '<id>'
ORDER BY created_at;

-- Tentativas de login recusadas nas últimas 24h
SELECT created_at, ip, metadata
FROM audit_logs
WHERE action = 'admin.login.failed' AND created_at > now() - interval '24 hours'
ORDER BY created_at DESC;
```

Uma sequência de `admin.login.failed` do mesmo IP é sinal de alguém tentando entrar. O rate
limit já barra (5 tentativas por 5 minutos), mas vale bloquear no firewall.

---

## Restaurar de um backup

```bash
ls -1t backups/*.sql.gz | head
./scripts/restore.sh backups/gateway-AAAAMMDD-HHMMSS.sql.gz
dc restart api waha
```

O script pede o nome do database como confirmação — restaurar o dump do `waha` sobre o
`gateway` seria um estrago silencioso.

**Restaure os dois** se estiver recuperando de perda total: sem o `waha`, os números vêm
desconectados e todos precisarão escanear o QR de novo.

---

## Emergência: derrubar tudo com segurança

```bash
./scripts/backup.sh          # sempre antes
dc stop                      # para sem destruir nada
```

`dc down` remove os containers mas **preserva os volumes**. Só `dc down -v` apaga dados — e
esse comando não tem volta.
