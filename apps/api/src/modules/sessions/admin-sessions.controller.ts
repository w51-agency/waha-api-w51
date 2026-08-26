import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { NotFoundError, ValidationError } from '../../common/errors/problem-details';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminGuard } from '../admin-auth/admin.guard';
import { AuditService } from '../audit/audit.service';

import { SessionsService, toSessionResponse } from './sessions.service';

import type { AuthenticatedApiKey } from '../api-keys/api-key.types';
import type { Request } from 'express';

/**
 * Sessões pela ótica do painel.
 *
 * As rotas `/v1/sessions` são autenticadas por API key e **filtradas pela
 * aplicação dona**. O painel precisa do oposto: ver e operar tudo, escolhendo a
 * aplicação ao criar.
 *
 * O serviço é o mesmo — o que muda é quem chama e com qual escopo. Duplicar a
 * lógica aqui faria as duas versões divergirem na primeira correção.
 */
@ApiTags('Admin')
@ApiBearerAuth('BearerAuth')
@UseGuards(AdminGuard)
@Controller('admin/sessions')
export class AdminSessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar todas as sessões, de todas as aplicações' })
  @ApiQuery({ name: 'applicationId', required: false })
  @ApiQuery({ name: 'status', required: false })
  async list(
    @Query('applicationId') applicationId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    const sessoes = await this.prisma.session.findMany({
      where: {
        ...(applicationId ? { applicationId } : {}),
        ...(status ? { status: status as never } : {}),
        ...(search
          ? {
              OR: [
                { label: { contains: search, mode: 'insensitive' as const } },
                { phoneNumber: { contains: search } },
                { pushName: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      include: { application: { select: { id: true, name: true, slug: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    return sessoes.map((s) => ({ ...toSessionResponse(s), application: s.application }));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de uma sessão' })
  async findOne(@Param('id') id: string) {
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: { application: { select: { id: true, name: true, slug: true } } },
    });

    if (!session) throw new NotFoundError('Sessão não encontrada.', 'session-not-found');

    const atualizada = await this.sessions.findOne(id, session.applicationId);

    return { ...atualizada, application: session.application };
  }

  @Post()
  @ApiOperation({
    summary: 'Criar uma sessão pelo painel',
    description: 'Exige `applicationId` — o painel escolhe a qual sistema a sessão pertence.',
  })
  async create(@Body() dto: { applicationId: string; label?: string }, @Req() req: Request) {
    if (!dto.applicationId) {
      throw new ValidationError('Escolha a qual aplicação esta sessão pertence.');
    }

    const identidade = await this.identidadeDaAplicacao(dto.applicationId);

    const sessao = await this.sessions.create({ label: dto.label }, identidade, req);

    // A sessão nasce marcada como criada pelo painel, não por integração — a
    // distinção importa na auditoria.
    await this.prisma.session.update({
      where: { id: sessao.id },
      data: { createdVia: 'DASHBOARD' },
    });

    await this.audit.admin('session.created', {
      username: req.admin?.username,
      resourceType: 'session',
      resourceId: sessao.id,
      metadata: { label: dto.label ?? null, applicationId: dto.applicationId },
      request: req,
    });

    return sessao;
  }

  @Get(':id/qr')
  @ApiOperation({ summary: 'QR code da sessão' })
  async qr(@Param('id') id: string, @Req() req: Request) {
    const session = await this.buscar(id);
    const identidade = await this.identidadeDaAplicacao(session.applicationId);

    const qr = await this.sessions.getQr(id, identidade, req);

    await this.audit.admin('session.qr.requested', {
      username: req.admin?.username,
      resourceType: 'session',
      resourceId: id,
      request: req,
    });

    return qr;
  }

  @Post(':id/pairing-code')
  @ApiOperation({ summary: 'Código de pareamento' })
  async pairingCode(
    @Param('id') id: string,
    @Body() dto: { phoneNumber: string },
    @Req() req: Request,
  ) {
    const session = await this.buscar(id);
    const identidade = await this.identidadeDaAplicacao(session.applicationId);

    return this.sessions.requestPairingCode(id, dto.phoneNumber, identidade, req);
  }

  @Post(':id/:acao')
  @ApiOperation({
    summary: 'Ação de ciclo de vida',
    description: 'Ações aceitas: start, stop, restart, logout.',
  })
  async acao(@Param('id') id: string, @Param('acao') acao: string, @Req() req: Request) {
    const permitidas = ['start', 'stop', 'restart', 'logout'] as const;

    if (!permitidas.includes(acao as (typeof permitidas)[number])) {
      throw new ValidationError(`Ação "${acao}" não existe. Use: ${permitidas.join(', ')}.`);
    }

    const session = await this.buscar(id);
    const identidade = await this.identidadeDaAplicacao(session.applicationId);

    const resultado = await this.sessions[acao as (typeof permitidas)[number]](id, identidade, req);

    await this.audit.admin(`session.${acao}`, {
      username: req.admin?.username,
      resourceType: 'session',
      resourceId: id,
      request: req,
    });

    return resultado;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir a sessão' })
  async remove(@Param('id') id: string, @Req() req: Request) {
    const session = await this.buscar(id);
    const identidade = await this.identidadeDaAplicacao(session.applicationId);

    const resultado = await this.sessions.remove(id, identidade, req);

    await this.audit.admin('session.deleted', {
      username: req.admin?.username,
      resourceType: 'session',
      resourceId: id,
      metadata: { name: session.name, phoneNumber: session.phoneNumber },
      request: req,
    });

    return resultado;
  }

  @Get(':id/timeline')
  @ApiOperation({
    summary: 'Linha do tempo da sessão',
    description: 'Responde "quem pediu o QR desta sessão e quando ela conectou".',
  })
  async timeline(@Param('id') id: string) {
    await this.buscar(id);

    return this.prisma.auditLog.findMany({
      where: { resourceType: 'session', resourceId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  private async buscar(id: string) {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) throw new NotFoundError('Sessão não encontrada.', 'session-not-found');
    return session;
  }

  /**
   * Monta a identidade que o `SessionsService` espera.
   *
   * O serviço foi escrito para operar em nome de uma API key. O painel não tem
   * uma, então construímos uma identidade sintética com a aplicação correta —
   * mantendo o filtro de posse intacto, o que garante que a lógica de isolamento
   * continue sendo exercitada mesmo pelo caminho administrativo.
   */
  private async identidadeDaAplicacao(applicationId: string): Promise<AuthenticatedApiKey> {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { id: true, name: true, slug: true },
    });

    if (!application) {
      throw new NotFoundError('Aplicação não encontrada.', 'application-not-found');
    }

    return {
      // Id vazio sinaliza "não veio de uma API key". O serviço trata isso
      // gravando `createdByApiKeyId: null` — um id inventado violaria a chave
      // estrangeira de `api_keys`.
      id: '',
      name: 'painel',
      prefix: 'painel',
      scopes: [],
      application,
    };
  }
}
