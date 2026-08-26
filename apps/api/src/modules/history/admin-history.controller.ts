import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { NotFoundError } from '../../common/errors/problem-details';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminGuard } from '../admin-auth/admin.guard';

import { HistoryService } from './history.service';

import type { ListMessagesQuery } from './dto/history.dto';
import type { Response } from 'express';

/**
 * Histórico pela ótica do painel.
 *
 * Igual ao `/v1/messages`, mas sem o filtro por aplicação — o painel vê tudo — e
 * com o `applicationId` como filtro opcional em vez de obrigatório.
 */
@ApiTags('Admin')
@ApiBearerAuth('BearerAuth')
@UseGuards(AdminGuard)
@Controller('admin/messages')
export class AdminHistoryController {
  constructor(
    private readonly history: HistoryService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Histórico de mensagens de todas as aplicações' })
  @ApiQuery({ name: 'applicationId', required: false })
  async list(@Query() query: ListMessagesQuery & { applicationId?: string }) {
    // Quando não há aplicação escolhida, consultamos todas — o serviço exige
    // uma, então percorremos as ativas e mesclamos. Para a escala do painel
    // (dezenas de aplicações) isso é mais simples do que duplicar a consulta.
    if (query.applicationId) {
      return this.history.listMessages(query.applicationId, query);
    }

    if (query.sessionId) {
      const sessao = await this.prisma.session.findUnique({
        where: { id: query.sessionId },
        select: { applicationId: true },
      });
      if (!sessao) throw new NotFoundError('Sessão não encontrada.', 'session-not-found');
      return this.history.listMessages(sessao.applicationId, query);
    }

    return this.listarTodas(query);
  }

  @Get('export')
  @ApiOperation({ summary: 'Exportar em CSV' })
  async export(
    @Query() query: ListMessagesQuery & { applicationId?: string },
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="mensagens.csv"');
    res.write('﻿');

    const aplicacoes = query.applicationId
      ? [query.applicationId]
      : (await this.prisma.application.findMany({ select: { id: true } })).map((a) => a.id);

    let primeiraLinha = true;

    for (const applicationId of aplicacoes) {
      for await (const linha of this.history.exportCsv(applicationId, query)) {
        // O cabeçalho vem de cada geração; só a primeira o escreve.
        if (linha.startsWith('data,')) {
          if (!primeiraLinha) continue;
          primeiraLinha = false;
        }
        res.write(linha);
      }
    }

    res.end();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de uma mensagem' })
  async findOne(@Param('id') id: string, @Query('includeRaw') includeRaw?: string) {
    const mensagem = await this.prisma.message.findUnique({
      where: { id },
      select: { applicationId: true },
    });

    if (!mensagem) throw new NotFoundError('Mensagem não encontrada.', 'message-not-found');

    return this.history.findMessage(id, mensagem.applicationId, includeRaw === 'true');
  }

  /**
   * Consulta agregada quando nenhuma aplicação foi escolhida.
   *
   * Busca por aplicação e mescla ordenando por data. O corte final devolve
   * exatamente o limite pedido, e o cursor da última linha continua válido
   * porque a ordenação é a mesma em todas as consultas.
   */
  private async listarTodas(query: ListMessagesQuery) {
    const aplicacoes = await this.prisma.application.findMany({ select: { id: true } });

    if (aplicacoes.length === 0) return { data: [], nextCursor: null, hasMore: false };

    const limite = query.limit ?? 50;

    const paginas = await Promise.all(
      aplicacoes.map((a) => this.history.listMessages(a.id, { ...query, limit: limite })),
    );

    const todas = paginas
      .flatMap((p) => p.data)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const pagina = todas.slice(0, limite);
    const temMais = todas.length > limite || paginas.some((p) => p.hasMore);

    return {
      data: pagina,
      // Reaproveita o cursor da página com mais resultados: como todas usam a
      // mesma ordenação, ele continua apontando para o ponto certo.
      nextCursor: temMais ? (paginas.find((p) => p.nextCursor)?.nextCursor ?? null) : null,
      hasMore: temMais,
    };
  }
}
