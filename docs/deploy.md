# Deploy

Do servidor limpo ao primeiro número conectado.

---

## O que o servidor precisa

- **Docker** com Compose v2 (`docker compose version` deve responder)
- **4 GB de RAM** confortáveis. O WAHA sozinho usa ~360 MB por instância com o motor
  NOWEB; Postgres, Redis e a API somam pouco mais de 100 MB em repouso.
- **20 GB de disco.** As imagens ocupam ~600 MB; o resto é banco, mídia e log.

Não é preciso Node, pnpm nem Postgres instalados — tudo roda em container.

---

## 1. Obtenha o código

```bash
git clone <url-do-repositório> gateway-w51
cd gateway-w51
```

## 2. Configure

```bash
cp .env.example .env
./scripts/gen-secrets.sh
```

O script gera todos os segredos e **imprime a senha do painel**. Anote-a: ela não é
recuperável (só regenerável).

Ajuste o que fizer sentido no `.env`:

```bash
# Rede Docker compartilhada com o Nginx Proxy Manager (criada no passo 3)
PROXY_NETWORK=npm-proxy

# Origens que podem chamar a API pelo navegador
CORS_ORIGINS=https://gateway.seu-dominio.com

TZ=America/Sao_Paulo
```

> **Portas.** Em produção este projeto **não publica porta nenhuma no host**. Postgres,
> Redis, WAHA e API ficam numa rede própria (`waha-gateway-w51-prod_interna`), e só o
> painel entra também na rede do proxy. Por isso ele não conflita com nenhum outro
> projeto da máquina — mesmo outro Postgres na `5432` ou outro painel na `8080`.
> `WEB_PORT` e `BIND_ADDRESS` do `.env` só valem em dev ou com o override
> `docker-compose.port.yml`.

## 3. Crie a rede do proxy

Uma vez por servidor. O Nginx Proxy Manager precisa enxergar o painel pela rede Docker,
então os dois compartilham uma rede criada fora de qualquer compose — assim nenhum
projeto a cria nem a apaga ao subir ou descer:

```bash
docker network create npm-proxy
```

Ligue o container do NPM a ela. Descubra o nome dele com `docker ps` (costuma ser
`nginx-proxy-manager`, `npm-app-1` ou parecido):

```bash
docker network connect npm-proxy <container-do-npm>
```

Para que a ligação sobreviva a um `docker compose up` do NPM, acrescente a rede no
compose **dele**:

```yaml
# docker-compose.yml do Nginx Proxy Manager
services:
  app:
    networks:
      - default
      - npm-proxy

networks:
  npm-proxy:
    external: true
```

Se o NPM já tem uma rede externa própria, use-a: basta pôr o nome dela em
`PROXY_NETWORK` no `.env` e pular o `network create`.

## 4. Suba

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

O primeiro build leva alguns minutos. A ordem é garantida pelo compose: Postgres sobe,
as migrations rodam em um container próprio e **precisam terminar** antes de a API subir.

Confira:

```bash
docker compose -f docker-compose.prod.yml ps
```

Todos devem estar `healthy`, exceto `migrate`, que aparece como `Exited (0)` — ele é
efêmero por natureza.

```bash
docker compose -f docker-compose.prod.yml exec web wget -qO- http://localhost/api/health/ready
```

Deve responder `"status":"ok"` com `postgres`, `redis` e `waha` em `up`. (Não há porta no
host para testar com `curl` de fora — é assim de propósito.)

---

## 5. Cadastre no Nginx Proxy Manager

O painel trafega credenciais e o conteúdo das conversas: só exponha em HTTPS.

Confira antes que o NPM enxerga o painel pelo nome (o container chama-se
`waha-gateway-w51-web`, fixo):

```bash
docker exec <container-do-npm> wget -qO- http://waha-gateway-w51-web/api/health/live
```

Se responder JSON, siga. Se der *bad address*, o NPM não está na rede `npm-proxy` —
volte ao passo 3.

### Proxy Host

**Hosts → Proxy Hosts → Add Proxy Host**

| Aba | Campo | Valor |
|---|---|---|
| Details | Domain Names | `gateway.seu-dominio.com` |
| Details | Scheme | `http` |
| Details | Forward Hostname / IP | `waha-gateway-w51-web` |
| Details | Forward Port | `80` |
| Details | Cache Assets | **desligado** |
| Details | Block Common Exploits | ligado |
| Details | Websockets Support | ligado |
| SSL | SSL Certificate | *Request a new SSL Certificate* (Let's Encrypt) |
| SSL | Force SSL | ligado |
| SSL | HTTP/2 Support | ligado |
| SSL | HSTS Enabled | ligado |

**Cache Assets** precisa ficar desligado: ele faz o NPM guardar respostas por extensão e
o painel já controla cache dos próprios estáticos — com ele ligado, um deploy pode
servir `index.html` novo apontando para um bundle antigo.

### Aba Advanced — obrigatório

O painel recebe atualizações em tempo real (QR, status das sessões, mensagens) por
**Server-Sent Events** em `/api/admin/events`. O nginx do NPM, por padrão, guarda a
resposta em buffer e a entrega em blocos — o painel simplesmente para de atualizar,
sem erro. Cole em **Custom Nginx Configuration**:

```nginx
# Server-Sent Events: entrega imediata e conexão longa
location /api/admin/events {
    proxy_pass http://waha-gateway-w51-web;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection        '';
    proxy_buffering    off;
    proxy_cache        off;
    proxy_read_timeout 24h;
    chunked_transfer_encoding off;
}

# Envio de mídia pela API: precisa caber o BODY_LIMIT (25 MB por padrão)
client_max_body_size 25m;
```

Se mudar `BODY_LIMIT` no `.env`, ajuste `client_max_body_size` aqui também — o limite
mais baixo dos dois é o que vale.

### Confira

1. `https://gateway.seu-dominio.com` abre a tela de login com cadeado.
2. `curl -sI https://gateway.seu-dominio.com/api/health/live` responde `200`.
3. Logado, em **Números → Conectar número**, o QR aparece e **muda sozinho** a cada
   poucos segundos. Se ficar parado, o bloco de SSE acima não foi aplicado.
4. Em **Auditoria**, os registros mostram o seu IP público, não `172.x.x.x` — sinal de
   que `X-Forwarded-For` está chegando.

### Domínio em CORS_ORIGINS

O `.env` precisa ter exatamente a origem que o navegador usa:

```bash
CORS_ORIGINS=https://gateway.seu-dominio.com
```

Sem isso o login funciona pelo painel (mesma origem), mas chamadas de outro front
para a API são bloqueadas. Após mudar: `docker compose -f docker-compose.prod.yml up -d api`.

---

## 6. Primeiro acesso

1. Abra `https://gateway.seu-dominio.com`
2. Entre com `ADMIN_USERNAME` e a senha gerada
3. **Aplicações → Nova aplicação** — cadastre o primeiro sistema integrador
4. **Emitir chave** — copie o segredo; ele aparece uma única vez
5. **Números → Conectar número** — escolha a aplicação, escaneie o QR
6. Entregue a chave ao time que vai integrar, junto de `docs/integracao.md`

---

## Atualizações

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

As migrations rodam sozinhas antes de a API subir. **Faça backup antes** de qualquer
atualização que traga migration:

```bash
./scripts/backup.sh
```

### Atualizar o WAHA

A versão é fixada de propósito no `.env` (`WAHA_IMAGE`). `latest` muda debaixo dos pés e
transforma um `pull` de rotina em incidente.

Para atualizar: mude a tag, teste em um ambiente separado, e só então promova.

```bash
# .env
WAHA_IMAGE=devlikeapro/waha:noweb-2026.9.1
```

```bash
docker compose -f docker-compose.prod.yml pull waha
docker compose -f docker-compose.prod.yml up -d waha
```

As sessões sobrevivem: ficam no Postgres, não no container.

---

## Backup

```bash
./scripts/backup.sh
```

Salva **os dois** databases. O `gateway` guarda aplicações, chaves, histórico e auditoria;
o `waha` guarda as sessões de WhatsApp. Restaurar só o primeiro deixaria todos os números
desconectados, exigindo escanear os QR de novo.

Agende (`crontab -e`):

```cron
0 3 * * * cd /caminho/gateway-w51 && ./scripts/backup.sh >> backups/backup.log 2>&1
```

Retenção padrão: 14 dias (`BACKUP_RETENTION_DAYS`).

> **Teste a restauração.** Um backup nunca restaurado é uma suposição, não um backup.
> `./scripts/restore.sh backups/gateway-AAAAMMDD-HHMMSS.sql.gz`

---

## O que está exposto

Nada, diretamente. Verificado:

```bash
docker compose -f docker-compose.prod.yml ps --format '{{.Name}} {{.Ports}}'
# nenhuma linha deve conter "->" (mapeamento para o host)

docker network inspect npm-proxy --format '{{range .Containers}}{{.Name}} {{end}}'
# só o NPM e waha-gateway-w51-web
```

A única porta de entrada é o `443` do Nginx Proxy Manager. Ele alcança o painel; o painel
alcança a API; a API alcança WAHA, Postgres e Redis — cada salto numa rede que os
demais projetos da máquina não veem. O WAHA exposto seria uma sessão de WhatsApp de
alguém à mercê da internet.

### Acesso direto para depurar

Quando precisar bater no painel sem o proxy, publique a porta com o override — e só
enquanto durar a depuração:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.port.yml up -d web
curl -s localhost:8080/api/health/ready
docker compose -f docker-compose.prod.yml up -d web   # remove a porta
```

---

## Recursos e limites

Declarados no compose de produção, para que um problema não consuma o host:

| Serviço | Limite | Observação |
|---|---|---|
| waha | 2 GB | `WAHA_MEMORY_LIMIT` — ~360 MB por sessão ativa |
| api | 768 MB | `API_MEMORY_LIMIT` |
| postgres | 1 GB | |
| redis | 512 MB | `noeviction`: filas não podem ser despejadas |
| web | 128 MB | nginx servindo estáticos |

Com muitas sessões simultâneas, o WAHA é quem cresce — ajuste `WAHA_MEMORY_LIMIT`.

Log rotacionado em 20 MB × 5 arquivos por serviço. Sem isso, o disco enche em semanas.
