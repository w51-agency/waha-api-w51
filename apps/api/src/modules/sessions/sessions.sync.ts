import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { WahaClient } from '../waha/waha.client';

import { mapStatus } from './sessions.service';

import { SessionStatus } from '@gateway/shared';

const LOCK_KEY = 'sessions:sync:lock';
const LOCK_TTL_SEGUNDOS = 55;

/**
 * Reconciliação periódica entre o estado local e o do WAHA.
 *
 * Existe porque **webhook se perde**. Se o gateway estiver fora do ar no
 * instante em que uma sessão conecta, o WAHA retenta — mas se todas as
 * tentativas falharem, o número nunca é gravado e a funcionalidade principal do
 * produto some sem deixar rastro.
 *
 * Este job é a rede de segurança: compara os status, corrige as divergências e,
 * o mais importante, **completa o vínculo de sessões que estão WORKING mas sem
 * número** consultando o `/me` do WAHA.
 */
@Injectable()
export class SessionsSyncService {
  private readonly logger = new Logger(SessionsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly waha: WahaClient,
    private readonly redis: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async reconcile(): Promise<void> {
    // Lock no Redis: com mais de uma instância da API, todas acordariam no
    // mesmo minuto e fariam o mesmo trabalho, multiplicando a carga no WAHA.
    const obtido = await this.redis.client.set(LOCK_KEY, '1', 'EX', LOCK_TTL_SEGUNDOS, 'NX');
    if (!obtido) return;

    try {
      await this.executar();
    } catch (erro) {
      this.logger.warn(`Reconciliação falhou: ${String(erro)}`);
    }
  }

  private async executar(): Promise<void> {
    const locais = await this.prisma.session.findMany();
    if (locais.length === 0) return;

    let remotas;
    try {
      remotas = await this.waha.listSessions(true);
    } catch (erro) {
      this.logger.warn(`WAHA indisponível na reconciliação: ${String(erro)}`);
      return;
    }

    const porNome = new Map(remotas.map((s) => [s.name, s]));
    let corrigidas = 0;
    let vinculadas = 0;

    for (const local of locais) {
      const remota = porNome.get(local.name);

      if (!remota) {
        // Sumiu do WAHA sem passar por aqui. Marcar FAILED torna o problema
        // visível no painel em vez de deixar a sessão parecendo saudável.
        if (local.status !== SessionStatus.FAILED) {
          await this.prisma.session.update({
            where: { id: local.id },
            data: { status: SessionStatus.FAILED, lastStatusAt: new Date() },
          });
          this.logger.warn(`Sessão ${local.name} não existe mais no WAHA — marcada FAILED`);
          corrigidas++;
        }
        continue;
      }

      const status = mapStatus(remota.status);

      if (status !== local.status) {
        await this.prisma.session.update({
          where: { id: local.id },
          data: {
            status,
            lastStatusAt: new Date(),
            ...(status === SessionStatus.WORKING && !local.connectedAt
              ? { connectedAt: new Date() }
              : {}),
            ...(status !== SessionStatus.WORKING && local.status === SessionStatus.WORKING
              ? { disconnectedAt: new Date() }
              : {}),
          },
        });
        corrigidas++;
      }

      // O caso que mais importa: conectada, mas sem o número gravado — sinal de
      // que o webhook `session.status=WORKING` se perdeu.
      if (status === SessionStatus.WORKING && !local.phoneNumber) {
        const me = remota.me ?? (await this.waha.getMe(local.name).catch(() => null));

        if (me?.id) {
          await this.prisma.session.update({
            where: { id: local.id },
            data: {
              waId: me.id,
              phoneNumber: me.id.split('@')[0] ?? null,
              pushName: me.pushName ?? null,
              connectedAt: local.connectedAt ?? new Date(),
            },
          });
          this.logger.log(
            `Vínculo recuperado: ${local.name} -> ${me.id} (webhook havia se perdido)`,
          );
          vinculadas++;
        }
      }
    }

    if (corrigidas > 0 || vinculadas > 0) {
      this.logger.log(
        `Reconciliação: ${corrigidas} status corrigido(s), ${vinculadas} vínculo(s) recuperado(s)`,
      );
    }
  }
}
