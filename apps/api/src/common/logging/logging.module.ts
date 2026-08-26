import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { AppConfig, ConfigModule } from '../../config';

import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Logging estruturado com pino.
 *
 * O ponto crítico aqui é a **redaction**: este sistema movimenta API keys,
 * senhas, segredos de HMAC e tokens JWT. Um log que os imprima em claro
 * transforma o arquivo de log — normalmente menos protegido que o banco — no elo
 * mais fraco. A lista abaixo é deliberadamente ampla; é mais barato censurar um
 * campo inofensivo do que descobrir depois que uma credencial vazou.
 */
@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),

          transport:
            config.get('LOG_FORMAT') === 'pretty'
              ? {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    singleLine: true,
                    translateTime: 'HH:MM:ss',
                    ignore: 'pid,hostname,req.headers,res.headers',
                  },
                }
              : undefined,

          // Correlaciona a requisição do começo ao fim. O cliente pode enviar o
          // seu próprio id; se não enviar, geramos.
          // O pino-http entrega IncomingMessage/ServerResponse crus, não os
          // tipos do express — daí as assinaturas abaixo.
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const existing = req.headers['x-request-id'];
            const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
            req.headers['x-request-id'] = id;
            res.setHeader('x-request-id', id);
            return id;
          },

          redact: {
            paths: [
              // credenciais em header
              'req.headers.authorization',
              'req.headers["x-api-key"]',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              // assinaturas de webhook
              'req.headers["x-webhook-hmac"]',
              'req.headers["x-gateway-signature"]',
              // credenciais em corpo
              'req.body.password',
              'req.body.apiKey',
              'req.body.secret',
              'req.body.token',
              'req.body.refreshToken',
              // objetos de domínio que carregam segredo
              '*.password',
              '*.hash',
              '*.secret',
              '*.apiKey',
              '*.plaintext',
              '*.accessToken',
              '*.refreshToken',
              '*.webhookSecret',
              // mídia em base64 não é segredo, mas entope o log
              'req.body.file.data',
            ],
            censor: '[oculto]',
          },

          // O healthcheck bate a cada poucos segundos: em nível info ele afogaria
          // o log e esconderia o que importa.
          autoLogging: {
            ignore: (req: IncomingMessage) => {
              const url = req.url ?? '';
              return url.startsWith('/health') || url === '/favicon.ico';
            },
          },

          customLogLevel: (_req, res, err) => {
            if (err || res.statusCode >= 500) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'info';
          },

          customSuccessMessage: (req: IncomingMessage, res: ServerResponse) =>
            `${req.method} ${req.url} ${res.statusCode}`,
        },
      }),
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
