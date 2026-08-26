import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { ProblemDetails } from './common/errors/problem-details';
import { AppConfig } from './config';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * Documentação OpenAPI.
 *
 * São **dois documentos separados**:
 *
 * - `/docs` — a API pública (`/v1`), para os sistemas integradores.
 * - `/docs/admin` — as rotas do painel, que não interessam ao integrador.
 *
 * As rotas `/internal/*` ficam fora dos dois: publicar o endpoint de webhook
 * interno seria entregar mapa da superfície de ataque. O script de exportação
 * falha se alguma vazar.
 */

const DESCRICAO_PUBLICA = `
Gateway de WhatsApp multi-sistema. Conecte números, envie e receba mensagens, e
acompanhe tudo pelo painel.

## Começando

1. Peça uma **API key** ao administrador do gateway.
2. Confirme que ela funciona: \`GET /v1/me\`.
3. Crie uma sessão: \`POST /v1/sessions\`.
4. Busque o QR code: \`GET /v1/sessions/{id}/qr\` e escaneie com o WhatsApp.
5. Quando \`status\` virar \`WORKING\`, envie: \`POST /v1/messages/text\`.

O guia completo, com exemplos em curl, Node e PHP, está em \`docs/integracao.md\`.

## Autenticação

Envie sua chave no header:

\`\`\`
X-API-Key: wgw_live_a1b2c3d4e5f6_seu-segredo
\`\`\`

O header \`Authorization: Bearer <chave>\` também é aceito, para clientes que só
sabem mandar credencial dessa forma.

### Isolamento

A chave identifica a sua aplicação. Você enxerga e opera **apenas** as sessões
que a sua própria aplicação criou. Sessões de outros sistemas respondem **404**,
não 403 — não confirmamos sequer que o id existe.

## Erros

Toda resposta de erro segue **RFC 7807** (\`application/problem+json\`):

\`\`\`json
{
  "type": "https://gateway.w51/errors/session-not-working",
  "title": "Sessão não conectada",
  "status": 409,
  "detail": "A sessão ainda não foi conectada. Escaneie o QR code em GET /v1/sessions/{id}/qr.",
  "instance": "/v1/messages/text",
  "requestId": "01JCQ8Z5X9K2M4N6P8R0T2V4W6"
}
\`\`\`

O \`type\` é estável e legível por máquina — use-o para tratar casos específicos.
O \`detail\` é a explicação em português. **Guarde o \`requestId\`**: é por ele que
localizamos o log da sua requisição.

## Repetição segura de envios

Envios **não são retentados automaticamente** por nós: um tempo esgotado pode
significar "entregue, resposta perdida", e repetir duplicaria a mensagem no
aparelho do destinatário.

Para ter retry seguro, mande o header \`Idempotency-Key\` com um identificador
seu. Repetir a requisição com a mesma chave devolve o resultado original em vez
de enviar de novo. Vale por 24 horas.

## Limite de requisições

Cada chave tem um limite próprio. As respostas trazem \`X-RateLimit-Limit\`,
\`X-RateLimit-Remaining\` e, ao estourar, \`Retry-After\` com os segundos de espera.

## Paginação

As listagens usam **cursor**, não offset. Passe o \`nextCursor\` da resposta em
\`?cursor=\` para a próxima página; quando vier \`null\`, acabou. Cursor não repete
nem pula registros quando chegam mensagens durante a navegação.
`.trim();

/**
 * Gera um operationId único.
 *
 * Usar só o nome do método colide: vários controllers têm `list` e `findOne`, e
 * `operationId` duplicado quebra os geradores de client — que é justamente para
 * o que a especificação serve.
 */
function operationId(controller: string, metodo: string): string {
  const recurso = controller.replace(/Controller$/, '');
  return `${recurso.charAt(0).toLowerCase()}${recurso.slice(1)}_${metodo}`;
}

function construirBuilder(config?: AppConfig) {
  const builder = new DocumentBuilder()
    .setTitle('WhatsApp Gateway W51')
    .setDescription(DESCRICAO_PUBLICA)
    .setVersion('1.0')
    .setLicense('Proprietário', '')
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header',
        description: 'Chave da sua aplicação, emitida no painel administrativo.',
      },
      'ApiKeyAuth',
    )
    .addTag('Conta', 'Confirme sua credencial e veja o que ela permite.')
    .addTag(
      'Sessões',
      'Conectar números de WhatsApp e acompanhar o estado da conexão. ' +
        'Cada sessão é um número; o QR code é como ele se conecta.',
    )
    .addTag(
      'Mensagens',
      'Enviar mensagens de todos os tipos e consultar o histórico do que passou por aqui.',
    )
    .addTag(
      'Chats & Contatos',
      'Ler conversas direto do aparelho conectado — inclui histórico anterior à conexão — ' +
        'e verificar se um número tem WhatsApp.',
    )
    .addTag('Mídia', 'Baixar arquivos enviados e recebidos.')
    .addTag('Webhooks', 'Receber eventos no seu sistema, sem precisar consultar.');

  // Um documento sem `servers` não diz onde a API vive, e ferramentas o
  // recusam. Em exportação (sem config) usamos a porta padrão documentada.
  builder.addServer(`http://localhost:${config?.port ?? 3001}`, 'Desenvolvimento');
  builder.addServer('https://{host}', 'Produção', {
    host: { default: 'gateway.seu-dominio.com', description: 'Domínio da sua instalação.' },
  });

  return builder.build();
}

/**
 * Acrescenta as respostas de erro comuns a toda operação.
 *
 * Feito aqui, e não com decorators em cada rota, por dois motivos: seriam
 * centenas de linhas repetidas, e a repetição garantiria que alguma rota nova
 * ficasse sem — deixando o integrador sem saber que aquele endpoint pode
 * devolver 401.
 *
 * Só acrescenta o que ainda não foi declarado: uma rota que documenta o próprio
 * 404 com descrição específica mantém a dela.
 */
function acrescentarErrosComuns(documento: OpenAPIObject): OpenAPIObject {
  const referencia = { $ref: '#/components/schemas/ProblemDetails' };
  const conteudo = { 'application/problem+json': { schema: referencia } };

  const comuns: Record<string, string> = {
    '401': 'Credencial ausente, inválida ou revogada.',
    '403': 'A chave não possui o escopo necessário para esta operação.',
    '422': 'Dados inválidos. O campo `errors` detalha por campo.',
    '429': 'Limite de requisições excedido. Veja o header `Retry-After`.',
    '500': 'Erro interno. Informe o `requestId` ao acionar o suporte.',
  };

  for (const metodos of Object.values(documento.paths ?? {})) {
    for (const [metodo, operacao] of Object.entries(metodos as Record<string, unknown>)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(metodo)) continue;

      const op = operacao as { responses?: Record<string, unknown> };
      op.responses ??= {};

      for (const [codigo, descricao] of Object.entries(comuns)) {
        op.responses[codigo] ??= { description: descricao, content: conteudo };
      }
    }
  }

  return documento;
}

/**
 * Remove tudo que não é da API pública — rotas **e** schemas órfãos.
 *
 * Filtrar apenas os caminhos deixaria os DTOs do painel em `components`: o
 * escaneamento roda sobre a aplicação inteira. Sobrariam schemas como
 * `CreatedApiKeyResponse`, revelando a estrutura interna das credenciais a quem
 * lesse a especificação pública.
 */
function apenasPublicas(documento: OpenAPIObject): OpenAPIObject {
  documento.paths = Object.fromEntries(
    Object.entries(documento.paths ?? {}).filter(
      ([caminho]) => !caminho.startsWith('/admin') && !caminho.startsWith('/internal'),
    ),
  );

  return podarSchemasOrfaos(documento);
}

/**
 * Mantém apenas os schemas alcançáveis a partir das rotas.
 *
 * Percorre em largura porque um schema referencia outros — remover só os
 * citados diretamente deixaria dependências penduradas.
 */
function podarSchemasOrfaos(documento: OpenAPIObject): OpenAPIObject {
  const schemas = documento.components?.schemas;
  if (!schemas) return documento;

  const referenciados = new Set<string>();

  const coletar = (valor: unknown): void => {
    if (Array.isArray(valor)) {
      valor.forEach(coletar);
      return;
    }
    if (typeof valor !== 'object' || valor === null) return;

    for (const [chave, item] of Object.entries(valor)) {
      if (chave === '$ref' && typeof item === 'string') {
        const nome = item.split('/').pop();
        if (nome) referenciados.add(nome);
      } else {
        coletar(item);
      }
    }
  };

  coletar(documento.paths);

  // Fecho transitivo: um schema mantido pode referenciar outros.
  let cresceu = true;
  while (cresceu) {
    cresceu = false;
    for (const nome of [...referenciados]) {
      const antes = referenciados.size;
      coletar(schemas[nome]);
      if (referenciados.size !== antes) cresceu = true;
    }
  }

  // ProblemDetails é injetado nas respostas de erro depois desta poda.
  referenciados.add('ProblemDetails');

  documento.components!.schemas = Object.fromEntries(
    Object.entries(schemas).filter(([nome]) => referenciados.has(nome)),
  );

  return documento;
}

/** Usado pelo script de exportação, que não sobe o servidor HTTP. */
export function construirDocumentoPublico(
  app: INestApplication,
  swagger: typeof SwaggerModule,
  _builder: typeof DocumentBuilder,
): OpenAPIObject {
  const documento = swagger.createDocument(app, construirBuilder(), {
    deepScanRoutes: true,
    extraModels: [ProblemDetails],
    operationIdFactory: operationId,
  });

  return acrescentarErrosComuns(apenasPublicas(documento));
}

export function setupSwagger(app: INestApplication, config: AppConfig): void {
  if (!config.get('SWAGGER_ENABLED')) return;

  const publico = acrescentarErrosComuns(
    apenasPublicas(
      SwaggerModule.createDocument(app, construirBuilder(config), {
        deepScanRoutes: true,
        extraModels: [ProblemDetails],
        operationIdFactory: operationId,
      }),
    ),
  );

  SwaggerModule.setup('docs', app, publico, {
    jsonDocumentUrl: 'docs-json',
    customSiteTitle: 'WhatsApp Gateway W51 — API',
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      docExpansion: 'none',
      tryItOutEnabled: true,
    },
  });

  // --- documento do painel ---
  const adminBuilder = new DocumentBuilder()
    .setTitle('WhatsApp Gateway W51 — Painel')
    .setDescription(
      'Rotas administrativas, usadas pelo painel. Não destinadas a sistemas integradores — ' +
        'para esses, veja /docs.',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'BearerAuth')
    .build();

  const admin = SwaggerModule.createDocument(app, adminBuilder, { deepScanRoutes: true });
  admin.paths = Object.fromEntries(
    Object.entries(admin.paths ?? {}).filter(([caminho]) => caminho.startsWith('/admin')),
  );

  SwaggerModule.setup('docs/admin', app, admin, {
    jsonDocumentUrl: 'docs/admin-json',
    customSiteTitle: 'WhatsApp Gateway W51 — Painel',
  });
}
