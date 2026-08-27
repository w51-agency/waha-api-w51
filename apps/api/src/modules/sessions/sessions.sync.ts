import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { SessionStatus, type WahaSession } from '@gateway/shared';

import { AppConfig } from '../../config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { WahaClient } from '../waha/waha.client';

import { buildSessionConfig, mapStatus } from './sessions.service';

import type { Application, Session } from '../../generated/prisma/client';

const LOCK_KEY = 'sessions:sync:lock';
const LOCK_TTL_SEGUNDOS = 55;

/** Chave de metadado que o gateway carimba em toda sessão que cria no WAHA. */
const METADATA_SESSION_ID = 'gateway.session.id';

/**
 * Reconciliação periódica entre o estado local e o do WAHA.
 *
 * Existe porque **webhook se perde**. Se o gateway estiver fora do ar no
 * instante em que uma sessão conecta, o WAHA retenta — mas se todas as
 * tentativas falharem, o número nunca é gravado e a funcionalidade principal do
 * produto some sem deixar rastro.
 *
 * Este job é a rede de segurança. A cada minuto:
 *
 * 1. Corrige status divergentes e **completa o vínculo de sessões WORKING sem
 *    número** consultando o `/me` do WAHA.
 * 2. Garante que o webhook de cada sessão aponta para **este** gateway, com o
 *    segredo que está no banco — a URL muda quando o gateway troca de host
 *    (dev → produção) e o WAHA guarda a antiga para sempre.
 * 3. Remove do WAHA sessões que **este gateway criou** mas que já não existem
 *    no banco (banco resetado, ambiente trocado). Sem isto elas ficam
 *    reiniciando, ocupando memória e batendo webhook em loop com 401.
 *
 * Sessões no WAHA sem o carimbo do gateway não são tocadas: podem ser de outro
 * sistema apontando para o mesmo WAHA.
 */
@Injectable()
export class SessionsSyncService {
  private readonly logger = new Logger(SessionsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly waha: WahaClient,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
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
    const locais = await this.prisma.session.findMany({ include: { application: true } });

    let remotas: WahaSession[];
    try {
      remotas = await this.waha.listSessions(true);
    } catch (erro) {
      this.logger.warn(`WAHA indisponível na reconciliação: ${String(erro)}`);
      return;
    }

    const porNome = new Map(remotas.map((s) => [s.name, s]));
    const resumo = { corrigidas: 0, vinculadas: 0, webhooks: 0, removidas: 0 };

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
          resumo.corrigidas++;
        }
        continue;
      }

      if (await this.corrigirWebhook(local, remota)) resumo.webhooks++;

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
        resumo.corrigidas++;
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
          resumo.vinculadas++;
        }
      }
    }

    resumo.removidas = await this.removerOrfas(remotas, new Set(locais.map((s) => s.name)));

    if (Object.values(resumo).some((n) => n > 0)) {
      this.logger.log(
        `Reconciliação: ${resumo.corrigidas} status corrigido(s), ${resumo.vinculadas} vínculo(s) ` +
          `recuperado(s), ${resumo.webhooks} webhook(s) atualizado(s), ${resumo.removidas} órfã(s) removida(s)`,
      );
    }
  }

  /**
   * O WAHA guarda a configuração dada na criação e nunca a revisita. Se a URL
   * interna do gateway mudou (outro host, outra porta), o segredo não bate com
   * o do banco ou o carimbo de identidade sumiu, todo evento daquela sessão
   * chega em 401 ou em lugar nenhum — e a sessão parece saudável no painel
   * enquanto nada é registrado. Reescrevemos a configuração inteira esperada.
   */
  private async corrigirWebhook(
    local: Session & { application: Application },
    remota: WahaSession,
  ): Promise<boolean> {
    const esperada = buildSessionConfig(
      this.config,
      {
        applicationId: local.applicationId,
        applicationSlug: local.application.slug,
        sessionId: local.id,
        apiKeyId: local.createdByApiKeyId,
      },
      local.webhookSecret,
    );
    const webhookEsperado = esperada.webhooks![0]!;
    const atual = remota.config?.webhooks?.[0];

    const igual =
      atual !== undefined &&
      atual.url === webhookEsperado.url &&
      atual.hmac?.key === webhookEsperado.hmac?.key &&
      remota.config?.metadata?.[METADATA_SESSION_ID] === local.id;
    if (igual) return false;

    try {
      await this.waha.updateSession(local.name, { ...remota.config, ...esperada });
      this.logger.warn(
        `Webhook da sessão ${local.name} apontava para ${atual?.url ?? '(nenhum)'} — atualizado para ${webhookEsperado.url}`,
      );
      return true;
    } catch (erro) {
      this.logger.warn(`Não foi possível atualizar o webhook de ${local.name}: ${String(erro)}`);
      return false;
    }
  }

  /**
   * Sessões que carregam o carimbo do gateway mas não existem mais no banco.
   * Só apagamos o que é comprovadamente nosso — o metadado é a prova.
   */
  private async removerOrfas(remotas: WahaSession[], conhecidas: Set<string>): Promise<number> {
    let removidas = 0;

    for (const remota of remotas) {
      if (conhecidas.has(remota.name)) continue;
      if (!remota.config?.metadata?.[METADATA_SESSION_ID]) continue;

      try {
        await this.waha.deleteSession(remota.name);
        this.logger.warn(
          `Sessão ${remota.name} existia no WAHA mas não no banco — removida do WAHA`,
        );
        removidas++;
      } catch (erro) {
        this.logger.warn(`Não foi possível remover a órfã ${remota.name}: ${String(erro)}`);
      }
    }

    return removidas;
  }
}
