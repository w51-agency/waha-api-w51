#!/usr/bin/env node
/**
 * Gera as coleções Insomnia e Postman a partir de docs/openapi.json.
 *
 * Derivadas da especificação, não escritas à mão: coleções mantidas
 * manualmente divergem da API em semanas e passam a ensinar o errado.
 *
 * Uso: node scripts/gen-collections.mjs   (depois de `pnpm openapi:export`)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(readFileSync(resolve(raiz, 'docs/openapi.json'), 'utf8'));
const destino = resolve(raiz, 'docs/collections');
mkdirSync(destino, { recursive: true });

const METODOS = ['get', 'post', 'put', 'patch', 'delete'];
const VARIAVEIS = {
  baseUrl: 'http://localhost:3001',
  apiKey: 'wgw_live_troque_por_sua_chave',
  sessionId: '',
  messageId: '',
  endpointId: '',
};

function* operacoes() {
  for (const [caminho, metodos] of Object.entries(spec.paths ?? {})) {
    for (const [metodo, op] of Object.entries(metodos)) {
      if (METODOS.includes(metodo)) yield { caminho, metodo, op };
    }
  }
}

const corpoDe = (op) => op.requestBody?.content?.['application/json']?.example ?? { sessionId: '' };
const temCorpo = (op) => Boolean(op.requestBody?.content?.['application/json']);

// --- Insomnia ---
const recursos = [
  {
    _id: 'wrk_gateway',
    _type: 'workspace',
    name: spec.info.title,
    description: 'API pública do gateway. Configure baseUrl e apiKey no ambiente.',
  },
  { _id: 'env_base', _type: 'environment', parentId: 'wrk_gateway', name: 'Base', data: VARIAVEIS },
];

const grupos = new Map();
for (const tag of (spec.tags ?? []).map((t) => t.name)) {
  const id = `fld_${tag.toLowerCase().replace(/[^a-z]/g, '_')}`;
  grupos.set(tag, id);
  recursos.push({ _id: id, _type: 'request_group', parentId: 'wrk_gateway', name: tag });
}

let ordem = 0;
for (const { caminho, metodo, op } of operacoes()) {
  ordem++;
  const tag = op.tags?.[0] ?? 'Conta';
  const requisicao = {
    _id: `req_${ordem}`,
    _type: 'request',
    parentId: grupos.get(tag) ?? 'wrk_gateway',
    name: op.summary ?? `${metodo.toUpperCase()} ${caminho}`,
    description: (op.description ?? '').slice(0, 500),
    method: metodo.toUpperCase(),
    url: '{{ _.baseUrl }}' + caminho.replace(/\{/g, '{{ _.').replace(/\}/g, ' }}'),
    metaSortKey: ordem,
    headers: [{ name: 'X-API-Key', value: '{{ _.apiKey }}' }],
  };

  if (temCorpo(op)) {
    requisicao.headers.push({ name: 'Content-Type', value: 'application/json' });
    requisicao.body = {
      mimeType: 'application/json',
      text: JSON.stringify(corpoDe(op), null, 2),
    };
  }

  recursos.push(requisicao);
}

writeFileSync(
  resolve(destino, 'insomnia.json'),
  `${JSON.stringify({ _type: 'export', __export_format: 4, __export_source: 'waha-gateway-w51', resources: recursos }, null, 2)}\n`,
);

// --- Postman ---
const porTag = new Map();
for (const { caminho, metodo, op } of operacoes()) {
  const tag = op.tags?.[0] ?? 'Conta';
  const item = {
    name: op.summary ?? `${metodo.toUpperCase()} ${caminho}`,
    request: {
      method: metodo.toUpperCase(),
      header: [{ key: 'X-API-Key', value: '{{apiKey}}' }],
      url: {
        raw: '{{baseUrl}}' + caminho.replace(/\{/g, '{{').replace(/\}/g, '}}'),
        host: ['{{baseUrl}}'],
        path: caminho.replace(/^\//, '').split('/'),
      },
      description: (op.description ?? '').slice(0, 500),
    },
  };

  if (temCorpo(op)) {
    item.request.header.push({ key: 'Content-Type', value: 'application/json' });
    item.request.body = {
      mode: 'raw',
      raw: JSON.stringify(corpoDe(op), null, 2),
      options: { raw: { language: 'json' } },
    };
  }

  if (!porTag.has(tag)) porTag.set(tag, []);
  porTag.get(tag).push(item);
}

writeFileSync(
  resolve(destino, 'postman.json'),
  `${JSON.stringify(
    {
      info: {
        name: spec.info.title,
        description: 'API pública do gateway. Configure baseUrl e apiKey nas variáveis.',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [...porTag].map(([name, item]) => ({ name, item })),
      variable: Object.entries(VARIAVEIS).map(([key, value]) => ({ key, value })),
    },
    null,
    2,
  )}\n`,
);

const total = [...operacoes()].length;
console.log(`Coleções geradas: ${total} requisições (insomnia.json, postman.json)`);
