import { Injectable, Logger } from '@nestjs/common';

import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/problem-details';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiKeyService } from '../api-keys/api-key.service';

import type {
  CreateApiKeyDto,
  CreateApplicationDto,
  UpdateApplicationDto,
} from './dto/application.dto';
import type {
  ApiKeyResponse,
  ApplicationDetailResponse,
  ApplicationResponse,
  CreatedApiKeyResponse,
} from './dto/application.response';
import type { ApiKey, Application } from '../../generated/prisma/client';

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeyService,
  ) {}

  // ===========================================================================
  //  Aplicações
  // ===========================================================================

  async create(dto: CreateApplicationDto): Promise<ApplicationResponse> {
    const slug = dto.slug ?? slugify(dto.name);

    if (!slug) {
      throw new ValidationError(
        'Não foi possível derivar um slug a partir do nome. Informe um slug explicitamente.',
      );
    }

    const existente = await this.prisma.application.findUnique({ where: { slug } });
    if (existente) {
      throw new ConflictError(`Já existe uma aplicação com o slug "${slug}".`, 'duplicate-slug');
    }

    const application = await this.prisma.application.create({
      data: { name: dto.name, slug, description: dto.description ?? null },
    });

    return toApplicationResponse(application);
  }

  async list(): Promise<ApplicationResponse[]> {
    const trintaDias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const applications = await this.prisma.application.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { sessions: true } },
      },
    });

    // As contagens que dependem de filtro (chaves ativas, sessões conectadas,
    // mensagens do período) não cabem no `_count` do Prisma, que só conta
    // relações inteiras. Agrupamentos separados evitam N+1.
    const [chavesAtivas, conectadas, mensagens] = await Promise.all([
      this.prisma.apiKey.groupBy({
        by: ['applicationId'],
        where: { revokedAt: null },
        _count: true,
      }),
      this.prisma.session.groupBy({
        by: ['applicationId'],
        where: { status: 'WORKING' },
        _count: true,
      }),
      this.prisma.message.groupBy({
        by: ['applicationId'],
        where: { timestamp: { gte: trintaDias } },
        _count: true,
      }),
    ]);

    const porApp = (
      grupos: Array<{ applicationId: string; _count: number }>,
    ): Map<string, number> => new Map(grupos.map((g) => [g.applicationId, g._count]));

    const mapaChaves = porApp(chavesAtivas as never);
    const mapaConectadas = porApp(conectadas as never);
    const mapaMensagens = porApp(mensagens as never);

    return applications.map((app) => ({
      ...toApplicationResponse(app),
      counts: {
        sessions: app._count.sessions,
        connectedSessions: mapaConectadas.get(app.id) ?? 0,
        activeApiKeys: mapaChaves.get(app.id) ?? 0,
        messagesLast30Days: mapaMensagens.get(app.id) ?? 0,
      },
    }));
  }

  async findOne(id: string): Promise<ApplicationDetailResponse> {
    const application = await this.prisma.application.findUnique({
      where: { id },
      include: { apiKeys: { orderBy: { createdAt: 'desc' } } },
    });

    if (!application) throw new NotFoundError('Aplicação não encontrada.', 'application-not-found');

    return {
      ...toApplicationResponse(application),
      apiKeys: application.apiKeys.map((k) => toApiKeyResponse(k, application.active)),
    };
  }

  async update(id: string, dto: UpdateApplicationDto): Promise<ApplicationResponse> {
    const application = await this.prisma.application.findUnique({ where: { id } });
    if (!application) throw new NotFoundError('Aplicação não encontrada.', 'application-not-found');

    const atualizada = await this.prisma.application.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });

    // Desativar precisa cortar o acesso na hora. Sem isto, as chaves em cache
    // continuariam válidas por até 60s — janela curta, mas inaceitável quando o
    // motivo da desativação é justamente conter um problema.
    if (dto.active !== undefined && dto.active !== application.active) {
      this.apiKeys.invalidateCache();
      this.logger.log(
        `Aplicação ${application.slug} ${dto.active ? 'reativada' : 'desativada'} — cache de chaves limpo`,
      );
    }

    return toApplicationResponse(atualizada);
  }

  /**
   * Exclui a aplicação e tudo que depende dela.
   *
   * Exige o slug como confirmação porque o cascade apaga sessões e histórico de
   * mensagens — e as sessões precisam ser removidas no WAHA antes, senão ficam
   * órfãs lá, consumindo memória e mantendo o WhatsApp logado. A remoção no WAHA
   * é feita pelo SessionsService (tarefa 09), que assina este método.
   */
  async remove(
    id: string,
    confirmSlug: string,
  ): Promise<{ deleted: true; sessionsRemoved: number }> {
    const application = await this.prisma.application.findUnique({
      where: { id },
      include: { sessions: true },
    });

    if (!application) throw new NotFoundError('Aplicação não encontrada.', 'application-not-found');

    if (confirmSlug !== application.slug) {
      throw new ValidationError(
        `Confirmação inválida. Para excluir, envie ?confirm=${application.slug}. ` +
          'Isso apagará permanentemente as sessões e o histórico de mensagens desta aplicação.',
      );
    }

    const sessionsRemoved = application.sessions.length;

    await this.prisma.application.delete({ where: { id } });
    this.apiKeys.invalidateCache();

    return { deleted: true, sessionsRemoved };
  }

  // ===========================================================================
  //  API keys
  // ===========================================================================

  async createApiKey(applicationId: string, dto: CreateApiKeyDto): Promise<CreatedApiKeyResponse> {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!application) throw new NotFoundError('Aplicação não encontrada.', 'application-not-found');

    if (dto.expiresAt && new Date(dto.expiresAt) <= new Date()) {
      throw new ValidationError('expiresAt precisa ser uma data futura.');
    }

    const gerada = await this.apiKeys.generate();

    const registro = await this.prisma.apiKey.create({
      data: {
        applicationId,
        name: dto.name,
        prefix: gerada.prefix,
        hash: gerada.hash,
        scopes: dto.scopes ?? [],
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });

    return {
      ...toApiKeyResponse(registro, application.active),
      secret: gerada.plaintext,
      warning:
        'Guarde esta chave agora — ela não será exibida novamente. ' +
        'Se perder, revogue esta e emita outra.',
    };
  }

  async listApiKeys(applicationId: string): Promise<ApiKeyResponse[]> {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { apiKeys: { orderBy: { createdAt: 'desc' } } },
    });

    if (!application) throw new NotFoundError('Aplicação não encontrada.', 'application-not-found');

    return application.apiKeys.map((k) => toApiKeyResponse(k, application.active));
  }

  async revokeApiKey(apiKeyId: string, force = false): Promise<ApiKeyResponse> {
    const chave = await this.prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      include: { application: true },
    });

    if (!chave) throw new NotFoundError('Chave não encontrada.', 'api-key-not-found');
    if (chave.revokedAt) return toApiKeyResponse(chave, chave.application.active);

    // Revogar a última chave ativa deixa a aplicação sem acesso. Costuma ser
    // engano, então exige confirmação — mas nunca é impedido.
    if (!force) {
      const ativas = await this.prisma.apiKey.count({
        where: { applicationId: chave.applicationId, revokedAt: null },
      });

      if (ativas <= 1) {
        throw new ConflictError(
          `"${chave.name}" é a última chave ativa de ${chave.application.name}. ` +
            'Revogá-la deixará a aplicação sem acesso à API. ' +
            'Para confirmar, repita a chamada com ?force=true.',
          'last-active-key',
        );
      }
    }

    const revogada = await this.prisma.apiKey.update({
      where: { id: apiKeyId },
      data: { revokedAt: new Date() },
    });

    this.apiKeys.invalidateCache();

    return toApiKeyResponse(revogada, chave.application.active);
  }

  /**
   * Revoga a chave atual e emite outra com os mesmos escopos.
   *
   * Em transação: uma rotação que revogasse sem conseguir emitir deixaria a
   * aplicação sem acesso.
   */
  async rotateApiKey(apiKeyId: string): Promise<CreatedApiKeyResponse> {
    const atual = await this.prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      include: { application: true },
    });

    if (!atual) throw new NotFoundError('Chave não encontrada.', 'api-key-not-found');

    const gerada = await this.apiKeys.generate();

    const nova = await this.prisma.$transaction(async (tx) => {
      await tx.apiKey.update({
        where: { id: apiKeyId },
        data: { revokedAt: new Date() },
      });

      return tx.apiKey.create({
        data: {
          applicationId: atual.applicationId,
          name: atual.name,
          prefix: gerada.prefix,
          hash: gerada.hash,
          scopes: atual.scopes,
          expiresAt: atual.expiresAt,
        },
      });
    });

    this.apiKeys.invalidateCache();

    return {
      ...toApiKeyResponse(nova, atual.application.active),
      secret: gerada.plaintext,
      warning: 'Chave anterior revogada. Guarde esta agora — ela não será exibida novamente.',
    };
  }
}

// =============================================================================
//  Serialização
// =============================================================================

function toApplicationResponse(app: Application): ApplicationResponse {
  return {
    id: app.id,
    name: app.name,
    slug: app.slug,
    description: app.description,
    active: app.active,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}

/**
 * Converte uma chave para resposta.
 *
 * Note o que **não** está aqui: `hash`. A serialização é explícita justamente
 * para que um campo sensível novo no schema não vaze por espalhamento de objeto.
 */
function toApiKeyResponse(key: ApiKey, applicationActive: boolean): ApiKeyResponse {
  const expirada = key.expiresAt !== null && key.expiresAt < new Date();

  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
    revokedAt: key.revokedAt,
    createdAt: key.createdAt,
    active: key.revokedAt === null && !expirada && applicationActive,
  };
}

/** Normaliza um nome para slug: minúsculas, sem acento, hifenizado. */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
