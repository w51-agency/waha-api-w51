import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

import { DeliveryStatus, Direction, MessageStatus, SessionStatus } from '@gateway/shared';

export type Granularidade = 'hour' | 'day';

export interface PontoSerie {
  bucket: string;
  inbound: number;
  outbound: number;
  total: number;
}

/**
 * Agregações para o painel.
 *
 * Duas decisões que sustentam isto em escala:
 *
 * 1. **Agregar no banco, não na aplicação.** Contar mensagens carregando
 *    registros para o Node não escala. Tudo aqui sai de `GROUP BY` usando os
 *    índices da tarefa 03.
 * 2. **Cache curto.** O painel recarrega com frequência e as métricas toleram
 *    alguns segundos de defasagem; sem cache, cada abertura de dashboard viraria
 *    meia dúzia de varreduras.
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async overview(): Promise<Record<string, unknown>> {
    return this.cacheado('overview', 30, async () => {
      const agora = new Date();
      const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
      const seteDias = new Date(agora.getTime() - 7 * 86_400_000);
      const trintaDias = new Date(agora.getTime() - 30 * 86_400_000);

      const [
        porStatus,
        totalSessoes,
        hoje,
        ultimos7,
        ultimos30,
        porStatusMensagem,
        endpointsComFalha,
        aplicacoes,
      ] = await Promise.all([
        this.prisma.session.groupBy({ by: ['status'], _count: true }),
        this.prisma.session.count(),
        this.prisma.message.count({ where: { timestamp: { gte: inicioHoje } } }),
        this.prisma.message.count({ where: { timestamp: { gte: seteDias } } }),
        this.prisma.message.count({ where: { timestamp: { gte: trintaDias } } }),
        this.prisma.message.groupBy({
          by: ['status'],
          where: { direction: Direction.OUTBOUND, timestamp: { gte: trintaDias } },
          _count: true,
        }),
        this.prisma.webhookEndpoint.count({ where: { disabledAt: { not: null } } }),
        this.prisma.application.count({ where: { active: true } }),
      ]);

      const sessoesPorStatus = Object.fromEntries(
        porStatus.map((s) => [s.status, s._count]),
      ) as Record<string, number>;

      const enviadas = porStatusMensagem.reduce((soma, s) => soma + s._count, 0);
      const entregues = porStatusMensagem
        .filter((s) => s.status === MessageStatus.DELIVERED || s.status === MessageStatus.READ)
        .reduce((soma, s) => soma + s._count, 0);
      const falhas = porStatusMensagem
        .filter((s) => s.status === MessageStatus.FAILED)
        .reduce((soma, s) => soma + s._count, 0);

      return {
        sessions: {
          total: totalSessoes,
          connected: sessoesPorStatus[SessionStatus.WORKING] ?? 0,
          awaitingQr: sessoesPorStatus[SessionStatus.SCAN_QR_CODE] ?? 0,
          stopped: sessoesPorStatus[SessionStatus.STOPPED] ?? 0,
          failed: sessoesPorStatus[SessionStatus.FAILED] ?? 0,
          byStatus: sessoesPorStatus,
        },
        messages: { today: hoje, last7Days: ultimos7, last30Days: ultimos30 },
        delivery: {
          sent: enviadas,
          delivered: entregues,
          failed: falhas,
          // Percentual só faz sentido com denominador: sem envios, "0%" seria
          // enganoso e "100%" também.
          rate: enviadas > 0 ? Number(((entregues / enviadas) * 100).toFixed(1)) : null,
        },
        applications: { active: aplicacoes },
        alerts: {
          disabledWebhookEndpoints: endpointsComFalha,
          failedSessions: sessoesPorStatus[SessionStatus.FAILED] ?? 0,
        },
      };
    });
  }

  /**
   * Série temporal de mensagens.
   *
   * Preenche os intervalos vazios com zero: um gráfico com lacunas sugere falha
   * de coleta, quando na verdade não houve tráfego.
   */
  async messagesSeries(params: {
    granularity: Granularidade;
    from: Date;
    to: Date;
    applicationId?: string;
    sessionId?: string;
  }): Promise<{ series: PontoSerie[]; granularity: Granularidade }> {
    const { granularity, from, to } = params;

    const registros = await this.prisma.message.findMany({
      where: {
        timestamp: { gte: from, lte: to },
        ...(params.applicationId ? { applicationId: params.applicationId } : {}),
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      },
      select: { timestamp: true, direction: true },
    });

    const buckets = new Map<string, { inbound: number; outbound: number }>();

    for (const registro of registros) {
      const chave = bucketKey(registro.timestamp, granularity);
      const atual = buckets.get(chave) ?? { inbound: 0, outbound: 0 };

      if (registro.direction === Direction.INBOUND) atual.inbound++;
      else atual.outbound++;

      buckets.set(chave, atual);
    }

    const series: PontoSerie[] = [];
    const passo = granularity === 'hour' ? 3_600_000 : 86_400_000;

    for (let t = truncar(from, granularity); t <= to.getTime(); t += passo) {
      const chave = bucketKey(new Date(t), granularity);
      const valores = buckets.get(chave) ?? { inbound: 0, outbound: 0 };

      series.push({
        bucket: chave,
        inbound: valores.inbound,
        outbound: valores.outbound,
        total: valores.inbound + valores.outbound,
      });
    }

    return { series, granularity };
  }

  async byApplication(): Promise<unknown[]> {
    return this.cacheado('by-application', 60, async () => {
      const trintaDias = new Date(Date.now() - 30 * 86_400_000);

      const [aplicacoes, mensagens, sessoes] = await Promise.all([
        this.prisma.application.findMany({
          select: { id: true, name: true, slug: true, active: true },
        }),
        this.prisma.message.groupBy({
          by: ['applicationId'],
          where: { timestamp: { gte: trintaDias } },
          _count: true,
          _max: { timestamp: true },
        }),
        this.prisma.session.groupBy({
          by: ['applicationId'],
          where: { status: SessionStatus.WORKING },
          _count: true,
        }),
      ]);

      const porMensagens = new Map(mensagens.map((m) => [m.applicationId, m]));
      const porSessoes = new Map(sessoes.map((s) => [s.applicationId, s._count]));

      return aplicacoes
        .map((app) => ({
          ...app,
          messagesLast30Days: porMensagens.get(app.id)?._count ?? 0,
          connectedSessions: porSessoes.get(app.id) ?? 0,
          lastActivityAt: porMensagens.get(app.id)?._max.timestamp ?? null,
        }))
        .sort((a, b) => b.messagesLast30Days - a.messagesLast30Days);
    });
  }

  async bySession(): Promise<unknown[]> {
    return this.cacheado('by-session', 60, async () => {
      const trintaDias = new Date(Date.now() - 30 * 86_400_000);

      const [sessoes, mensagens] = await Promise.all([
        this.prisma.session.findMany({
          include: { application: { select: { name: true, slug: true } } },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.message.groupBy({
          by: ['sessionId'],
          where: { timestamp: { gte: trintaDias } },
          _count: true,
        }),
      ]);

      const porSessao = new Map(mensagens.map((m) => [m.sessionId, m._count]));

      return sessoes.map((s) => ({
        id: s.id,
        label: s.label,
        phoneNumber: s.phoneNumber,
        status: s.status,
        application: s.application,
        connectedAt: s.connectedAt,
        qrRequestCount: s.qrRequestCount,
        messagesLast30Days: porSessao.get(s.id) ?? 0,
      }));
    });
  }

  async deliveryBreakdown(): Promise<unknown> {
    return this.cacheado('delivery', 60, async () => {
      const trintaDias = new Date(Date.now() - 30 * 86_400_000);

      const [mensagens, entregas] = await Promise.all([
        this.prisma.message.groupBy({
          by: ['status'],
          where: { direction: Direction.OUTBOUND, timestamp: { gte: trintaDias } },
          _count: true,
        }),
        this.prisma.webhookDelivery.groupBy({
          by: ['status'],
          where: { createdAt: { gte: trintaDias } },
          _count: true,
        }),
      ]);

      return {
        messages: Object.fromEntries(mensagens.map((m) => [m.status, m._count])),
        webhookDeliveries: Object.fromEntries(entregas.map((d) => [d.status, d._count])),
        abandonedDeliveries:
          entregas.find((d) => d.status === DeliveryStatus.ABANDONED)?._count ?? 0,
      };
    });
  }

  private async cacheado<T>(chave: string, ttl: number, calcular: () => Promise<T>): Promise<T> {
    const completa = `metrics:${chave}`;
    const cacheado = await this.redis.client.get(completa);

    if (cacheado) return JSON.parse(cacheado) as T;

    const valor = await calcular();
    await this.redis.client.setex(completa, ttl, JSON.stringify(valor));

    return valor;
  }
}

function truncar(data: Date, granularidade: Granularidade): number {
  const d = new Date(data);
  d.setMinutes(0, 0, 0);
  if (granularidade === 'day') d.setHours(0);
  return d.getTime();
}

function bucketKey(data: Date, granularidade: Granularidade): string {
  const iso = data.toISOString();
  return granularidade === 'hour' ? `${iso.slice(0, 13)}:00:00Z` : iso.slice(0, 10);
}
