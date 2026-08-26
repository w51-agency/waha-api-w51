# Tarefas — WhatsApp Gateway W51

Fonte de verdade da execução. As tarefas rodam **em ordem numérica**. Cada arquivo tem
objetivo, contexto, checklist e critérios de aceite executáveis.

## Regras

- Um checkbox só é marcado (`[x]`) depois que a ação foi realmente feita.
- Um arquivo só é marcado como **CONCLUÍDA** depois que **todos** os critérios de aceite
  rodaram e passaram — comando executado, saída conferida.
- Se algo bloquear, anotar na seção *Notas* do próprio arquivo e seguir para o que não depende.

## Índice

| # | Tarefa | Status |
|---|---|---|
| [01](01-fundacao-monorepo.md) | Fundação do monorepo | ✅ concluída |
| [02](02-infra-docker-dev.md) | Infraestrutura Docker de dev | ✅ concluída |
| [03](03-modelagem-dados-prisma.md) | Modelagem de dados (Prisma) | ✅ concluída |
| [04](04-bootstrap-api-nestjs.md) | Bootstrap da API NestJS | ✅ concluída |
| [05](05-auth-api-key.md) | Autenticação por API key | ✅ concluída |
| [06](06-auth-painel-jwt.md) | Autenticação do painel (JWT) | ✅ concluída |
| [07](07-cliente-waha.md) | Cliente WAHA tipado | ✅ concluída |
| [08](08-aplicacoes-api-keys.md) | Aplicações e API keys (admin) | ✅ concluída |
| [09](09-sessoes-qr.md) | Sessões e fluxo de QR rastreado | ✅ concluída |
| [10](10-ingestao-webhooks-waha.md) | Ingestão de webhooks do WAHA | ✅ concluída |
| [11](11-envio-mensagens.md) | Envio de mensagens (texto e mídia) | ✅ concluída |
| [12](12-historico-chats-midia.md) | Histórico, chats e proxy de mídia | ✅ concluída |
| [13](13-webhooks-saida.md) | Webhooks de saída para integradores | ✅ concluída |
| [14](14-metricas-auditoria-sse.md) | Métricas, auditoria e SSE | ✅ concluída |
| [15](15-documentacao-openapi.md) | Documentação OpenAPI completa | ✅ concluída |
| [16](16-painel-fundacao.md) | Painel — fundação | ✅ concluída |
| [17](17-painel-sessoes-qr.md) | Painel — sessões e QR ao vivo | ✅ concluída |
| [18](18-painel-mensagens-metricas.md) | Painel — mensagens e métricas | ✅ concluída |
| [19](19-painel-apps-chaves-auditoria.md) | Painel — apps, chaves, webhooks e auditoria | ✅ concluída |
| [20](20-testes-producao-entrega.md) | Testes, produção e entrega | ✅ concluída |

## Estado

**20 de 20 tarefas concluídas.** O sistema está completo e verificado:

```
pnpm lint / typecheck / format:check / build   verdes
pnpm test        150 testes unitários
pnpm test:e2e     27 testes e2e
pnpm smoke        a aplicação sobe e responde
redocly lint      0 erros na especificação OpenAPI

produção          5 containers healthy, só o painel publicado
backup            restauração testada de verdade
```

## Convenções do projeto

- **Código e identificadores em inglês**; documentação, UI e mensagens de erro ao usuário em **PT-BR**.
- Nenhuma porta fixa em compose/Dockerfile/nginx/código — tudo por `.env` com default interpolado.
- O WAHA nunca é exposto publicamente; todo acesso externo passa pelo gateway.
- Segredos jamais em log (redaction no pino) e API key exibida uma única vez, na criação.
