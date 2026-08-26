import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from '../app.module';
import { construirDocumentoPublico } from '../swagger';

/**
 * Exporta a especificação OpenAPI para `docs/`.
 *
 * Roda a partir do build (não via tsx) porque o AppModule carrega o client do
 * Prisma e módulos com decorators — compilar isso em tempo de execução é
 * frágil, e o CI usaria o build de qualquer forma.
 *
 * Além de escrever o arquivo, **verifica a cobertura**: falha se alguma rota
 * interna vazou, ou se alguma operação pública está sem summary ou sem
 * segurança declarada. Documentação com buracos só aparece para quem está
 * integrando — e aí já é tarde.
 */
async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();

  const documento = construirDocumentoPublico(app, SwaggerModule, DocumentBuilder);

  const destino = resolve(process.cwd(), '../../docs');
  mkdirSync(destino, { recursive: true });
  writeFileSync(resolve(destino, 'openapi.json'), `${JSON.stringify(documento, null, 2)}\n`);

  const rotas = Object.keys(documento.paths ?? {});
  const operacoes = rotas.reduce(
    (soma, rota) => soma + Object.keys(documento.paths?.[rota] ?? {}).length,
    0,
  );

  process.stdout.write(`docs/openapi.json: ${rotas.length} rotas, ${operacoes} operações\n`);

  let falhou = false;

  const internas = rotas.filter((r) => r.startsWith('/internal') || r.startsWith('/admin'));
  if (internas.length > 0) {
    process.stderr.write(`ERRO: rotas internas no documento público:\n${internas.join('\n')}\n`);
    falhou = true;
  }

  const semSummary: string[] = [];
  const semSeguranca: string[] = [];

  for (const [rota, metodos] of Object.entries(documento.paths ?? {})) {
    for (const [metodo, operacao] of Object.entries(metodos as Record<string, unknown>)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(metodo)) continue;

      const op = operacao as { summary?: string; security?: unknown[] };
      const identificacao = `${metodo.toUpperCase()} ${rota}`;

      if (!op.summary) semSummary.push(identificacao);
      if (!op.security?.length) semSeguranca.push(identificacao);
    }
  }

  if (semSummary.length > 0) {
    process.stderr.write(`ERRO: sem summary:\n  ${semSummary.join('\n  ')}\n`);
    falhou = true;
  }

  if (semSeguranca.length > 0) {
    process.stderr.write(`ERRO: sem segurança declarada:\n  ${semSeguranca.join('\n  ')}\n`);
    falhou = true;
  }

  if (!falhou) process.stdout.write('Cobertura da documentação: OK\n');

  await app.close();
  process.exit(falhou ? 1 : 0);
}

void main().catch((erro: unknown) => {
  process.stderr.write(`Falha ao exportar: ${String((erro as Error)?.stack ?? erro)}\n`);
  process.exit(1);
});
