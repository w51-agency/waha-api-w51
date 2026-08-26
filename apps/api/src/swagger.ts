import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppConfig } from './config';

import type { INestApplication } from '@nestjs/common';

/**
 * Documentação OpenAPI.
 *
 * São **dois documentos separados**, de propósito:
 *
 * - `/docs` — a API pública (`/v1`), destinada aos sistemas integradores.
 * - `/docs/admin` — as rotas do painel, que não interessam ao integrador.
 *
 * As rotas `/internal/*` ficam fora dos dois: publicar o endpoint de webhook
 * interno seria entregar mapa da superfície de ataque a quem estiver sondando.
 *
 * A cobertura completa (exemplos, catálogo de erros, coleções) é a tarefa 15;
 * aqui fica a fundação.
 */
export function setupSwagger(app: INestApplication, config: AppConfig): void {
  if (!config.get('SWAGGER_ENABLED')) return;

  const descricao = [
    'Gateway de WhatsApp multi-sistema.',
    '',
    '## Autenticação',
    '',
    'Envie sua chave no header `X-API-Key`:',
    '',
    '```',
    'X-API-Key: wgw_live_a1b2c3d4e5f6_seu-segredo',
    '```',
    '',
    'A chave identifica a sua aplicação. Você enxerga e opera **apenas** as sessões',
    'que a sua própria aplicação criou — sessões de outros sistemas respondem 404.',
    '',
    '## Erros',
    '',
    'Toda resposta de erro segue o formato `application/problem+json` (RFC 7807),',
    'com `type`, `title`, `status`, `detail` e `requestId`. Guarde o `requestId`:',
    'é por ele que localizamos o log da sua requisição.',
  ].join('\n');

  const builder = new DocumentBuilder()
    .setTitle('WhatsApp Gateway W51')
    .setDescription(descricao)
    .setVersion('1.0')
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header',
        description: 'Chave da sua aplicação, emitida no painel administrativo.',
      },
      'ApiKeyAuth',
    )
    .addTag('Conta', 'Dados da aplicação autenticada.')
    .addTag('Sessões', 'Conectar números de WhatsApp e acompanhar o estado da conexão.')
    .addTag('Mensagens', 'Enviar mensagens e consultar o histórico.')
    .addTag('Chats & Contatos', 'Ler conversas e verificar números direto do aparelho.')
    .addTag('Mídia', 'Baixar arquivos recebidos e enviados.')
    .addTag('Webhooks', 'Receber eventos no seu sistema.')
    .addServer(`http://localhost:${config.port}`, 'Desenvolvimento')
    .build();

  const publicDoc = SwaggerModule.createDocument(app, builder, {
    include: [],
    deepScanRoutes: true,
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
  });

  // Remove tudo que não é da API pública — nem admin, nem internal.
  publicDoc.paths = Object.fromEntries(
    Object.entries(publicDoc.paths ?? {}).filter(
      ([path]) => !path.startsWith('/admin') && !path.startsWith('/internal'),
    ),
  );

  SwaggerModule.setup('docs', app, publicDoc, {
    jsonDocumentUrl: 'docs-json',
    customSiteTitle: 'WhatsApp Gateway W51 — API',
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      docExpansion: 'none',
    },
  });

  // --- documento do painel ---
  const adminBuilder = new DocumentBuilder()
    .setTitle('WhatsApp Gateway W51 — Painel')
    .setDescription('Rotas administrativas. Uso interno do painel; não destinadas a integradores.')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'BearerAuth')
    .build();

  const adminDoc = SwaggerModule.createDocument(app, adminBuilder, { deepScanRoutes: true });
  adminDoc.paths = Object.fromEntries(
    Object.entries(adminDoc.paths ?? {}).filter(([path]) => path.startsWith('/admin')),
  );

  SwaggerModule.setup('docs/admin', app, adminDoc, {
    jsonDocumentUrl: 'docs/admin-json',
    customSiteTitle: 'WhatsApp Gateway W51 — Painel',
  });
}
