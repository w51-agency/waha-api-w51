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
# Onde o painel escuta. Deixe em 127.0.0.1 e coloque um proxy com TLS na frente.
BIND_ADDRESS=127.0.0.1
WEB_PORT=8080

# Origens que podem chamar a API pelo navegador
CORS_ORIGINS=https://gateway.seu-dominio.com

TZ=America/Sao_Paulo
```

> **Portas.** Todas vêm daqui. Se `8080` conflitar com algo, troque `WEB_PORT` — nenhuma
> imagem precisa ser reconstruída.

## 3. Suba

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
curl -s localhost:${WEB_PORT:-8080}/api/health/ready
```

Deve responder `"status":"ok"` com `postgres`, `redis` e `waha` em `up`.

---

## 4. Coloque TLS na frente

**O painel trafega credenciais e o conteúdo das conversas.** Não o exponha em HTTP.

O jeito mais simples é o Caddy, que resolve o certificado sozinho:

```caddy
# /etc/caddy/Caddyfile
gateway.seu-dominio.com {
    reverse_proxy 127.0.0.1:8080

    # Server-Sent Events: sem desligar o buffer, o painel para de receber
    # atualizações em tempo real sem dar sinal.
    @sse path /api/admin/events
    reverse_proxy @sse 127.0.0.1:8080 {
        flush_interval -1
    }
}
```

Com nginx, o equivalente é `proxy_buffering off` no bloco de `/api/admin/events` —
o mesmo cuidado que o nginx interno do painel já toma.

---

## 5. Primeiro acesso

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

Só o painel publica porta. Verificado:

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/    # 200
nc -z localhost 3001 && echo "API exposta"       # fechada
nc -z localhost 3000 && echo "WAHA exposto"      # fechada
nc -z localhost 5432 && echo "Postgres exposto"  # fechada
nc -z localhost 6379 && echo "Redis exposto"     # fechada
```

O WAHA exposto seria uma sessão de WhatsApp de alguém à mercê da internet. A API só é
alcançável pelo proxy do painel, que aplica os mesmos cabeçalhos de segurança.

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
