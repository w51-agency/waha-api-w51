import { Controller, Get, Param, Query, Req, Sse, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Observable, interval, map, merge } from 'rxjs';

import { CurrentApplication } from '../../common/decorators/current-app.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UnauthorizedError, ValidationError } from '../../common/errors/problem-details';
import { AppConfig } from '../../config';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminGuard } from '../admin-auth/admin.guard';
import { EventsBus } from '../events/events.bus';

import { MetricsService, type Granularidade } from './metrics.service';

import type { AuthenticatedApiKey } from '../api-keys/api-key.types';
import type { MessageEvent } from '@nestjs/common';
import type { Request } from 'express';

/** Intervalo do heartbeat, abaixo do timeout típico de proxy (30–60 s). */
const HEARTBEAT_MS = 25_000;

@ApiTags('Admin')
@ApiBearerAuth('BearerAuth')
@Controller('admin')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly prisma: PrismaService,
    private readonly bus: EventsBus,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  @UseGuards(AdminGuard)
  @Get('metrics/overview')
  @ApiOperation({ summary: 'Visão geral do sistema' })
  overview() {
    return this.metrics.overview();
  }

  @UseGuards(AdminGuard)
  @Get('metrics/messages')
  @ApiOperation({ summary: 'Série temporal de mensagens' })
  @ApiQuery({ name: 'granularity', enum: ['hour', 'day'], required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ISO 8601. Padrão: 30 dias atrás.' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO 8601. Padrão: agora.' })
  messages(
    @Query('granularity') granularity?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('applicationId') applicationId?: string,
    @Query('sessionId') sessionId?: string,
  ) {
    const granularidade: Granularidade = granularity === 'hour' ? 'hour' : 'day';

    const fim = to ? new Date(to) : new Date();
    const inicio = from
      ? new Date(from)
      : new Date(fim.getTime() - (granularidade === 'hour' ? 1 : 30) * 86_400_000);

    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
      throw new ValidationError('Datas inválidas: use o formato ISO 8601.');
    }

    // Um intervalo horário longo demais geraria milhares de pontos, inutilizando
    // o gráfico e pesando a consulta.
    const maxDias = granularidade === 'hour' ? 7 : 365;
    if (fim.getTime() - inicio.getTime() > maxDias * 86_400_000) {
      throw new ValidationError(
        `Com granularidade "${granularidade}", o intervalo máximo é de ${maxDias} dias.`,
      );
    }

    return this.metrics.messagesSeries({
      granularity: granularidade,
      from: inicio,
      to: fim,
      applicationId,
      sessionId,
    });
  }

  @UseGuards(AdminGuard)
  @Get('metrics/applications')
  @ApiOperation({ summary: 'Volume por aplicação' })
  byApplication() {
    return this.metrics.byApplication();
  }

  @UseGuards(AdminGuard)
  @Get('metrics/sessions')
  @ApiOperation({ summary: 'Volume por sessão' })
  bySession() {
    return this.metrics.bySession();
  }

  @UseGuards(AdminGuard)
  @Get('metrics/delivery')
  @ApiOperation({ summary: 'Distribuição de entrega' })
  delivery() {
    return this.metrics.deliveryBreakdown();
  }

  // ===========================================================================
  //  Auditoria
  // ===========================================================================

  @UseGuards(AdminGuard)
  @Get('audit-logs')
  @ApiOperation({ summary: 'Trilha de auditoria' })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'actorType', required: false, enum: ['ADMIN', 'API_KEY', 'SYSTEM'] })
  @ApiQuery({ name: 'resourceType', required: false })
  @ApiQuery({ name: 'resourceId', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async auditLogs(
    @Query('action') action?: string,
    @Query('actorType') actorType?: string,
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
    @Query('from') from?: string,
    @Query('limit') limit?: string,
  ) {
    const take = Math.min(Number(limit ?? 100), 500);

    const registros = await this.prisma.auditLog.findMany({
      where: {
        ...(action ? { action } : {}),
        ...(actorType ? { actorType: actorType as never } : {}),
        ...(resourceType ? { resourceType } : {}),
        ...(resourceId ? { resourceId } : {}),
        ...(from ? { createdAt: { gte: new Date(from) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    return registros.map((r) => ({ ...r, description: descrever(r) }));
  }

  @UseGuards(AdminGuard)
  @Get('audit-logs/resource/:type/:id')
  @ApiOperation({
    summary: 'Linha do tempo de um recurso',
    description: 'Responde "quem conectou este número e quando".',
  })
  async resourceTimeline(@Param('type') type: string, @Param('id') id: string) {
    const registros = await this.prisma.auditLog.findMany({
      where: { resourceType: type, resourceId: id },
      orderBy: { createdAt: 'asc' },
    });

    return registros.map((r) => ({ ...r, description: descrever(r) }));
  }

  // ===========================================================================
  //  SSE
  // ===========================================================================

  /**
   * Fluxo de eventos ao vivo do painel.
   *
   * O token vai na query string porque a API `EventSource` do navegador **não
   * permite headers customizados** — é uma limitação da especificação, não uma
   * escolha. Mitigado pela vida curta do access token e pelo fato de a conexão
   * ser sempre local ao painel.
   *
   * Fora do rate limit: é uma conexão longa, não uma sequência de requisições.
   */
  @Public()
  @SkipThrottle()
  @Sse('events')
  @ApiExcludeEndpoint()
  async events(@Query('token') token: string): Promise<Observable<MessageEvent>> {
    try {
      await this.jwt.verifyAsync(token ?? '', { secret: this.config.get('JWT_SECRET') });
    } catch {
      // Sem o catch, o erro cru do JWT vira 500 — e o painel não conseguiria
      // distinguir "preciso renovar o token" de "o servidor quebrou".
      throw new UnauthorizedError(
        'Token inválido ou expirado. Renove a sessão antes de reconectar.',
        'invalid-token',
      );
    }

    const eventos = this.bus.todos().pipe(map((e): MessageEvent => ({ type: e.type, data: e })));

    // Sem o heartbeat, proxies encerram a conexão ociosa e o painel fica sem
    // atualizações sem que ninguém perceba.
    const batimento = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'heartbeat', data: { at: new Date().toISOString() } })),
    );

    return merge(eventos, batimento);
  }
}

@ApiTags('Sessões')
@ApiSecurity('ApiKeyAuth')
@Controller('v1/sessions')
export class SessionEventsController {
  constructor(private readonly bus: EventsBus) {}

  /**
   * Fluxo ao vivo das sessões da aplicação.
   *
   * Autenticado pelo guard global de API key, como as demais rotas `/v1`.
   */
  @SkipThrottle()
  @Sse(':id/events')
  @ApiOperation({
    summary: 'Acompanhar uma sessão em tempo real',
    description:
      'Fluxo Server-Sent Events com as mudanças de estado e as mensagens da sessão. ' +
      'Útil para saber o instante em que o QR foi lido, sem ficar consultando.',
  })
  events(
    @Param('id') sessionId: string,
    @CurrentApplication() app: AuthenticatedApiKey['application'],
    @Req() _req: Request,
  ): Observable<MessageEvent> {
    const eventos = this.bus
      .daAplicacao(app.id, sessionId)
      .pipe(map((e): MessageEvent => ({ type: e.type, data: e })));

    const batimento = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'heartbeat', data: { at: new Date().toISOString() } })),
    );

    return merge(eventos, batimento);
  }
}

/**
 * Descrição legível de uma ação auditada.
 *
 * Guardamos `recurso.verbo` para poder filtrar; a frase é montada na leitura,
 * para que melhorá-la não exija reescrever o histórico.
 */
function descrever(registro: {
  action: string;
  actorLabel: string | null;
  metadata: unknown;
}): string {
  const ator = registro.actorLabel ?? 'sistema';
  const meta = (registro.metadata ?? {}) as Record<string, unknown>;

  const frases: Record<string, string> = {
    'application.created': `Aplicação "${String(meta.name ?? '')}" criada por ${ator}`,
    'application.updated': `Aplicação atualizada por ${ator}`,
    'application.activated': `Aplicação reativada por ${ator}`,
    'application.deactivated': `Aplicação desativada por ${ator}`,
    'application.deleted': `Aplicação excluída por ${ator}`,
    'apikey.created': `Chave "${String(meta.name ?? '')}" emitida por ${ator}`,
    'apikey.revoked': `Chave "${String(meta.name ?? '')}" revogada por ${ator}`,
    'apikey.rotated': `Chave rotacionada por ${ator}`,
    'session.created': `Sessão "${String(meta.label ?? meta.name ?? '')}" criada por ${ator}`,
    'session.qr.requested': `QR code solicitado por ${ator}${meta.requestNumber ? ` (${String(meta.requestNumber)}ª vez)` : ''}`,
    'session.pairing_code.requested': `Código de pareamento solicitado por ${ator} para ${String(meta.phoneNumber ?? '')}`,
    'session.start': `Sessão iniciada por ${ator}`,
    'session.stop': `Sessão parada por ${ator}`,
    'session.restart': `Sessão reiniciada por ${ator}`,
    'session.logout': `Número desconectado por ${ator}`,
    'session.deleted': `Sessão excluída por ${ator}${meta.phoneNumber ? ` (número ${String(meta.phoneNumber)})` : ''}`,
    'admin.login': `Login no painel por ${ator}`,
    'admin.login.failed': `Tentativa de login recusada`,
  };

  return frases[registro.action] ?? `${registro.action} por ${ator}`;
}
