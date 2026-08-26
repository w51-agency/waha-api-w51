import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { LRUCache } from 'lru-cache';

import {
  generateApiKey,
  parseApiKey,
  verifyApiKeySecret,
} from '../../common/crypto/api-key.crypto';
import { UnauthorizedError } from '../../common/errors/problem-details';
import { AppConfig } from '../../config';
import { PrismaService } from '../../prisma/prisma.service';

import { AuthenticatedApiKey } from './api-key.types';

import { API_SCOPES, type ApiScope } from '@gateway/shared';

/** Resultado negativo também é cacheado, para que chave inválida repetida não martele o banco. */
type CacheEntry = { ok: true; value: AuthenticatedApiKey } | { ok: false };

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  /**
   * Cache de verificação.
   *
   * O argon2id custa ~23 ms por verificação — deliberadamente, para resistir a
   * força bruta. Pagar isso a cada requisição limitaria a API a algumas dezenas
   * de requisições por segundo por núcleo. O TTL curto (60 s) é o que mantém a
   * revogação praticamente imediata mesmo sem invalidação explícita; e a
   * invalidação explícita, que existe, torna o efeito instantâneo.
   *
   * A chave do cache é o SHA-256 do valor completo: a chave em claro nunca fica
   * residente na memória do cache.
   */
  private readonly cache = new LRUCache<string, CacheEntry>({
    max: 5_000,
    ttl: 60_000,
  });

  /** Escritas de `lastUsedAt` são agrupadas: uma por chave por minuto, no máximo. */
  private readonly lastUsedPending = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** Gera uma nova chave. O valor em claro só existe no retorno desta chamada. */
  async generate(): Promise<{ plaintext: string; prefix: string; hash: string }> {
    return generateApiKey(this.config.get('API_KEY_PREFIX'));
  }

  /**
   * Resolve uma chave em claro para a identidade que ela representa.
   *
   * Lança `UnauthorizedError` com **a mesma mensagem** para todos os motivos de
   * falha — inexistente, revogada, expirada, aplicação inativa. Distinguir os
   * casos ajudaria mais quem está sondando do que quem está integrando.
   */
  async authenticate(plaintext: string): Promise<AuthenticatedApiKey> {
    const cacheKey = createHash('sha256').update(plaintext).digest('hex');

    const cached = this.cache.get(cacheKey);
    if (cached) {
      if (!cached.ok) throw new UnauthorizedError();
      this.touchLastUsed(cached.value.id);
      return cached.value;
    }

    const parsed = parseApiKey(plaintext);
    if (!parsed) {
      this.cache.set(cacheKey, { ok: false });
      throw new UnauthorizedError();
    }

    const record = await this.prisma.apiKey.findUnique({
      where: { prefix: parsed.prefix },
      include: { application: true },
    });

    if (!record) {
      this.logger.debug(`Chave inexistente: prefixo ${parsed.prefix}`);
      this.cache.set(cacheKey, { ok: false });
      throw new UnauthorizedError();
    }

    // O segredo é verificado antes de qualquer checagem de estado. Sair mais
    // cedo por "revogada" daria a quem tem só o prefixo (que é público) a
    // confirmação de que a chave existiu.
    const secretOk = await verifyApiKeySecret(parsed.secret, record.hash);

    const invalido =
      !secretOk ||
      record.revokedAt !== null ||
      (record.expiresAt !== null && record.expiresAt < new Date()) ||
      !record.application.active;

    if (invalido) {
      this.logger.debug(
        `Autenticação recusada para ${parsed.prefix}: ` +
          `segredo=${secretOk} revogada=${record.revokedAt !== null} ` +
          `expirada=${record.expiresAt !== null && record.expiresAt < new Date()} ` +
          `appAtiva=${record.application.active}`,
      );
      this.cache.set(cacheKey, { ok: false });
      throw new UnauthorizedError();
    }

    const identity: AuthenticatedApiKey = {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      scopes: normalizeScopes(record.scopes),
      application: {
        id: record.application.id,
        name: record.application.name,
        slug: record.application.slug,
      },
    };

    this.cache.set(cacheKey, { ok: true, value: identity });
    this.touchLastUsed(identity.id);

    return identity;
  }

  /**
   * Esvazia o cache.
   *
   * Chamado ao revogar chave ou desativar aplicação. Sem isso, a credencial
   * continuaria valendo por até 60 s — janela curta, mas inaceitável: revogar
   * uma chave é justamente o que se faz quando ela vazou.
   *
   * Limpa tudo em vez de só a entrada afetada porque o cache é chaveado pelo
   * hash do valor em claro, que não temos ao revogar (só o hash argon2). O
   * cache é pequeno e se repovoa em segundos.
   */
  invalidateCache(): void {
    this.cache.clear();
  }

  /**
   * Atualiza `lastUsedAt` sem bloquear a requisição.
   *
   * Uma escrita por requisição transformaria toda chamada de leitura em uma
   * escrita no banco. O agrupamento por minuto mantém o dado útil — o painel
   * mostra "usada há 3 minutos", não "há 3 segundos" — a um custo desprezível.
   */
  private touchLastUsed(apiKeyId: string): void {
    const agora = Date.now();
    const ultimo = this.lastUsedPending.get(apiKeyId) ?? 0;
    if (agora - ultimo < 60_000) return;

    this.lastUsedPending.set(apiKeyId, agora);

    void this.prisma.apiKey
      .update({ where: { id: apiKeyId }, data: { lastUsedAt: new Date() } })
      .catch((error: unknown) => {
        // Falha aqui é irrelevante para o cliente: a requisição dele já foi
        // autenticada. Registrar e seguir.
        this.logger.warn(`Não foi possível atualizar lastUsedAt de ${apiKeyId}: ${String(error)}`);
      });
  }
}

/**
 * Lista de escopos vazia significa "todos".
 *
 * É o padrão conveniente: quem cria uma chave sem pensar em escopos recebe uma
 * que funciona. Restringir é uma escolha explícita.
 */
function normalizeScopes(scopes: string[]): ApiScope[] {
  if (scopes.length === 0) return [...API_SCOPES];
  return scopes.filter((s): s is ApiScope => (API_SCOPES as readonly string[]).includes(s));
}
