import { HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';

import { GATEWAY_VERSION } from '@gateway/shared';

import { AppConfig } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

type CheckState = 'up' | 'down';

export interface ReadinessReport {
  status: 'ok' | 'error';
  version: string;
  uptime: number;
  details: Record<string, { status: CheckState; message?: string }>;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
  ) {}

  liveness() {
    return {
      status: 'ok' as const,
      version: GATEWAY_VERSION,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<ReadinessReport> {
    const [postgres, redis, waha] = await Promise.all([
      this.prisma.healthCheck(),
      this.redis.healthCheck(),
      this.checkWaha(),
    ]);

    const details = {
      postgres: toDetail(postgres, 'Não foi possível consultar o Postgres.'),
      redis: toDetail(redis, 'Não foi possível alcançar o Redis.'),
      waha: toDetail(waha, 'O serviço de WhatsApp (WAHA) não respondeu.'),
    };

    const healthy = postgres && redis && waha;
    const report: ReadinessReport = {
      status: healthy ? 'ok' : 'error',
      version: GATEWAY_VERSION,
      uptime: Math.round(process.uptime()),
      details,
    };

    if (!healthy) {
      // 503 e não 200-com-corpo-de-erro: orquestradores olham o código, não o corpo.
      throw new ServiceUnavailableException(report, {
        cause: new Error('readiness'),
        description: 'Dependência indisponível',
      });
    }

    return report;
  }

  /**
   * Verificação leve do WAHA.
   *
   * Vai direto com fetch em vez de usar o WahaClient (tarefa 07) de propósito:
   * o cliente tem retry com backoff, e o readiness precisa de uma resposta
   * rápida e binária. Um retry aqui atrasaria a sonda além do timeout do
   * orquestrador e provocaria justamente o reinício que ele deveria evitar.
   */
  private async checkWaha(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);

    try {
      const response = await fetch(`${this.config.get('WAHA_BASE_URL')}/health`, {
        signal: controller.signal,
        headers: { 'x-api-key': this.config.get('WAHA_API_KEY') },
      });
      return response.status === HttpStatus.OK;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function toDetail(ok: boolean, failureMessage: string) {
  return ok ? { status: 'up' as const } : { status: 'down' as const, message: failureMessage };
}
