import { Injectable, Logger } from '@nestjs/common';

import { ActorType } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';

import type { Request } from 'express';

export interface AuditInput {
  actorType: ActorType;
  actorId?: string | null;
  actorLabel?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  request?: Request;
}

/**
 * Trilha de auditoria.
 *
 * Responde, meses depois, "quem conectou este número e quando".
 *
 * A gravação **nunca propaga erro**: auditoria que derruba a operação auditada
 * é pior do que auditoria ausente. Falha aqui vira log de aviso.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          actorLabel: input.actorLabel ?? null,
          action: input.action,
          resourceType: input.resourceType ?? null,
          resourceId: input.resourceId ?? null,
          ip: extrairIp(input.request),
          userAgent: input.request?.headers['user-agent']?.slice(0, 500) ?? null,
          metadata: (input.metadata ?? undefined) as never,
        },
      });
    } catch (erro) {
      this.logger.warn(`Falha ao registrar auditoria "${input.action}": ${String(erro)}`);
    }
  }

  /** Atalho para ações do painel. */
  admin(action: string, input: Omit<AuditInput, 'action' | 'actorType'> & { username?: string }) {
    return this.record({
      ...input,
      actorType: ActorType.ADMIN,
      actorId: input.username ?? null,
      actorLabel: input.username ?? 'admin',
      action,
    });
  }

  /** Atalho para ações disparadas por uma API key. */
  apiKey(
    action: string,
    input: Omit<AuditInput, 'action' | 'actorType'> & { apiKeyId: string; apiKeyLabel: string },
  ) {
    return this.record({
      ...input,
      actorType: ActorType.API_KEY,
      actorId: input.apiKeyId,
      actorLabel: input.apiKeyLabel,
      action,
    });
  }
}

/**
 * Extrai o IP real do cliente.
 *
 * Atrás do nginx do painel (tarefa 16) e de qualquer proxy reverso, `req.ip`
 * seria o IP do proxy. O `trust proxy` do express já resolve isso, mas manter a
 * leitura explícita documenta a dependência.
 */
function extrairIp(request?: Request): string | null {
  if (!request) return null;
  return (request.ip ?? request.socket?.remoteAddress ?? null)?.slice(0, 45) ?? null;
}
