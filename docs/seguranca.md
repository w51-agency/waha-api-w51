# Segurança

O que está protegido, como, e o que continua exigindo cuidado de quem opera.

---

## O que este sistema guarda

Vale começar pelo que está em jogo, porque isso justifica as decisões:

- **Sessões de WhatsApp ativas.** Quem controla o gateway pode enviar mensagens em nome dos
  números conectados.
- **Conteúdo de conversas.** Mensagens recebidas e enviadas, com mídia.
- **Credenciais de sistemas integrados.** As API keys.

Não é um sistema de baixo risco.

---

## Superfície exposta

Em produção, **um único serviço publica porta**: o painel (nginx). Verificável:

```bash
docker compose -f docker-compose.prod.yml ps
```

WAHA, API, Postgres e Redis existem só na rede interna do Docker. O WAHA em particular
**nunca** deve ser exposto — ele não tem controle de acesso por aplicação, e alcançá-lo
diretamente permite operar qualquer sessão.

O painel deve ficar atrás de um proxy com TLS. Ele trafega credenciais e conteúdo de
conversas.

---

## Autenticação

### Sistemas integradores — API key

Formato: `wgw_live_{prefixo}_{segredo}`.

- O **prefixo** é público e indexado; localiza o registro em uma query.
- O **segredo** é verificado com **argon2id** (perfil OWASP: 19 MiB, 2 iterações), medido em
  ~23 ms. Deliberadamente caro, para resistir a força bruta offline caso o banco vaze.
- Só o hash é persistido. O valor em claro existe **uma única vez**, na resposta de criação.

Um cache LRU de 60 s evita pagar o argon2 a cada requisição. Revogação, rotação e
desativação de aplicação **invalidam o cache imediatamente** — verificado: 200 antes,
401 no instante seguinte.

Toda recusa devolve a mesma mensagem, independentemente do motivo (inexistente, revogada,
expirada, aplicação inativa). Distinguir ajudaria mais quem sonda do que quem integra.

### Painel — usuário único

`ADMIN_USERNAME` e `ADMIN_PASSWORD` vêm do ambiente. Três cuidados compensam a simplicidade:

1. Senha comparada com **argon2id**, nunca por igualdade de string.
2. **Usuário inexistente também paga o custo do hash** — sem isso, o tempo de resposta
   revelaria qual nome existe. Medido: 28 ms com usuário certo, 30 ms com inexistente.
3. **5 tentativas por 5 minutos por IP** no login. Com uma credencial só, força bruta é o
   risco real.

Refresh tokens vivem no Redis com **detecção de reuso**: um token usado duas vezes invalida
a família inteira e força novo login. Se alguém copiou o token, não há como saber qual das
duas partes é a legítima.

---

## Isolamento entre aplicações

A garantia mais importante da API pública: **cada chave enxerga e opera apenas as sessões
da própria aplicação.**

Recursos de outra aplicação respondem **404, nunca 403**. Um 403 confirmaria que o id
existe, permitindo mapear os recursos alheios por tentativa.

Coberto por testes e2e que exercitam **todas** as rotas com a credencial errada — sessões,
QR, ciclo de vida, mensagens, mídia, webhooks e listagens.

---

## Webhooks

### Entrada (WAHA → gateway)

- **HMAC-SHA512 sobre o corpo bruto.** O corpo é preservado (`rawBody`) porque reserializar
  o JSON mudaria a ordem das chaves e invalidaria a assinatura.
- **Segredo por sessão**, não global: comprometer uma sessão não permite forjar eventos das
  outras.
- **Janela de tempo** contra replay (`WEBHOOK_TOLERANCE_SECONDS`, padrão 300 s).
- **Idempotência** por `event.id` — o WAHA retenta até 15 vezes.

### Saída (gateway → integrador)

- `X-Gateway-Signature: t=<unix>,v1=<hmac-sha256>`, onde o HMAC cobre `"{t}.{corpo}"`.
- **O timestamp entra no que é assinado.** Assinar só o corpo deixaria uma entrega
  capturada reenviável para sempre. Há teste que tenta exatamente esse ataque.
- **HTTPS obrigatório** em produção (`ALLOW_INSECURE_WEBHOOKS=false`).
- Endereços de rede interna são **recusados**, e a validação resolve o DNS antes de aprovar
  — checar só o texto da URL deixaria passar um domínio apontando para IP privado.

---

## Proteção contra SSRF

`file.url` no envio de mídia vem de fora e é buscada pelo WAHA, que roda **dentro da nossa
rede**. Bloqueados e testados:

```
169.254.169.254   metadados de instância em nuvem
localhost         (resolve para ::1)
127.x  10.x  192.168.x  172.16-31.x  100.64.x (CGNAT)  0.x
IPv6: ::1, fd00::, fe80::
protocolos que não sejam http/https
```

A checagem resolve o DNS antes de aprovar.

---

## Dados sensíveis em log

O logger tem **redaction** para `authorization`, `x-api-key`, `x-webhook-hmac`,
`x-gateway-signature`, `password`, `secret`, `hash`, `token`, `refreshToken` e
`webhookSecret`.

Verificado plantando segredos em header e corpo: nenhum apareceu em claro; os campos saem
como `[oculto]`.

Em produção, `WAHA_PRINT_QR=false` — o QR é uma credencial de conexão e não deve ficar no
log do container.

---

## O que não vaza nas respostas

- **Hash de chave e segredo**: a serialização é campo a campo, não espalhamento do registro
  do Prisma. Com espalhamento, um campo sensível novo no schema vazaria sozinho.
- **URL interna do WAHA**: substituída pela rota do proxy autenticado. Verificado — zero
  ocorrências de `waha:3000` em qualquer resposta.
- **Detalhe interno em 5xx**: stack trace vai para o log com o `requestId`; o cliente recebe
  mensagem genérica e esse id.
- **Rotas internas na documentação**: `/internal/*` e `/admin/*` ficam fora do documento
  OpenAPI público, e os schemas do painel são podados. O script de exportação **falha** se
  alguma vazar.

---

## Rate limit

Contado **por API key**, não por IP. Chavear por IP puniria todos os clientes atrás de um
mesmo NAT e permitiria contornar o limite trocando de saída de rede.

Contador no Redis: com mais de uma instância da API, um contador por processo multiplicaria
o limite real pelo número de réplicas.

Sondas de saúde ficam fora do limite — o healthcheck do Docker as dispara a cada 10 s.

---

## O que continua sendo responsabilidade de quem opera

Nada disto o software resolve sozinho:

- **Coloque TLS na frente.** Sem isso, credenciais trafegam em claro.
- **Restrinja o acesso ao painel.** Ele controla todos os números. Firewall, VPN ou lista
  de IPs, conforme o caso.
- **Guarde o `.env` como um cofre.** Ele contém todos os segredos. Modo 600 (o
  `gen-secrets.sh` já aplica) e nunca no controle de versão.
- **Revogue chaves ao desligar uma integração.** Chave esquecida é acesso permanente.
- **Teste a restauração do backup.** Um backup nunca restaurado é uma suposição.
- **Acompanhe `admin.login.failed`.** Uma sequência do mesmo IP é alguém tentando entrar.
- **Mantenha o WAHA atualizado**, com a versão fixada e promovida após teste.

---

## Limitações conhecidas

Ditas explicitamente, porque limitação não documentada vira surpresa:

- **Usuário único no painel.** Não há papéis nem trilha por pessoa — a auditoria registra
  "admin". Foi decisão de escopo; multiusuário exigiria tabela de usuários e sessões.
- **Sem 2FA.** Pelo mesmo motivo. O rate limit no login é a mitigação disponível.
- **Token de sessão na query string do SSE.** A API `EventSource` do navegador não permite
  cabeçalhos — é limitação da especificação. Mitigado pela vida curta do access token
  (15 min).
- **Token na query em rotas de mídia e exportação.** Mesmo motivo: `<img src>` e
  `window.open` não enviam cabeçalhos. É **opt-in por rota** (`@AceitaTokenNaQuery`), não
  global — verificado que as demais rotas recusam.
- **O conteúdo das mensagens fica em claro no banco.** Criptografia em repouso, se
  necessária, deve ser feita no nível do disco ou do Postgres.
