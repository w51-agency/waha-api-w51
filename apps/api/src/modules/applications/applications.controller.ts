import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { AdminGuard } from '../admin-auth/admin.guard';
import { AuditService } from '../audit/audit.service';

import { ApplicationsService } from './applications.service';
import { CreateApiKeyDto, CreateApplicationDto, UpdateApplicationDto } from './dto/application.dto';

import type { Request } from 'express';

@ApiTags('Admin')
@ApiBearerAuth('BearerAuth')
@UseGuards(AdminGuard)
@Controller('admin')
export class ApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly audit: AuditService,
  ) {}

  // ===========================================================================
  //  Aplicações
  // ===========================================================================

  @Post('applications')
  @ApiOperation({ summary: 'Cadastrar um sistema integrador' })
  async create(@Body() dto: CreateApplicationDto, @Req() req: Request) {
    const app = await this.applications.create(dto);

    await this.audit.admin('application.created', {
      username: req.admin?.username,
      resourceType: 'application',
      resourceId: app.id,
      metadata: { name: app.name, slug: app.slug },
      request: req,
    });

    return app;
  }

  @Get('applications')
  @ApiOperation({ summary: 'Listar aplicações com contagens' })
  list() {
    return this.applications.list();
  }

  @Get('applications/:id')
  @ApiOperation({ summary: 'Detalhe da aplicação, com as chaves emitidas' })
  findOne(@Param('id') id: string) {
    return this.applications.findOne(id);
  }

  @Patch('applications/:id')
  @ApiOperation({
    summary: 'Editar aplicação',
    description:
      'O slug é imutável: ele compõe o nome interno das sessões já criadas. ' +
      'Desativar corta o acesso de todas as chaves imediatamente.',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateApplicationDto, @Req() req: Request) {
    const app = await this.applications.update(id, dto);

    await this.audit.admin(
      dto.active === false
        ? 'application.deactivated'
        : dto.active === true
          ? 'application.activated'
          : 'application.updated',
      {
        username: req.admin?.username,
        resourceType: 'application',
        resourceId: id,
        metadata: { ...dto },
        request: req,
      },
    );

    return app;
  }

  @Delete('applications/:id')
  @ApiOperation({
    summary: 'Excluir aplicação',
    description:
      'Apaga permanentemente sessões, histórico de mensagens e chaves. ' +
      'Exige `?confirm=<slug>` como confirmação.',
  })
  @ApiQuery({ name: 'confirm', description: 'O slug da aplicação, como confirmação.' })
  async remove(@Param('id') id: string, @Query('confirm') confirm: string, @Req() req: Request) {
    const resultado = await this.applications.remove(id, confirm ?? '');

    await this.audit.admin('application.deleted', {
      username: req.admin?.username,
      resourceType: 'application',
      resourceId: id,
      metadata: resultado,
      request: req,
    });

    return resultado;
  }

  // ===========================================================================
  //  API keys
  // ===========================================================================

  @Post('applications/:id/api-keys')
  @ApiOperation({
    summary: 'Emitir uma API key',
    description:
      'O campo `secret` da resposta é a **única** vez que a chave aparece. ' +
      'Não é possível recuperá-la depois.',
  })
  async createApiKey(
    @Param('id') applicationId: string,
    @Body() dto: CreateApiKeyDto,
    @Req() req: Request,
  ) {
    const chave = await this.applications.createApiKey(applicationId, dto);

    await this.audit.admin('apikey.created', {
      username: req.admin?.username,
      resourceType: 'api_key',
      resourceId: chave.id,
      // O prefixo é público; o segredo jamais entra em auditoria.
      metadata: { name: chave.name, prefix: chave.prefix, applicationId, scopes: chave.scopes },
      request: req,
    });

    return chave;
  }

  @Get('applications/:id/api-keys')
  @ApiOperation({ summary: 'Listar chaves da aplicação' })
  listApiKeys(@Param('id') applicationId: string) {
    return this.applications.listApiKeys(applicationId);
  }

  @Delete('api-keys/:keyId')
  @ApiOperation({
    summary: 'Revogar uma chave',
    description:
      'Efeito imediato. Revogar a última chave ativa exige `?force=true`, ' +
      'porque deixaria a aplicação sem acesso.',
  })
  @ApiQuery({ name: 'force', required: false, type: Boolean })
  async revoke(@Param('keyId') keyId: string, @Query('force') force: string, @Req() req: Request) {
    const chave = await this.applications.revokeApiKey(keyId, force === 'true');

    await this.audit.admin('apikey.revoked', {
      username: req.admin?.username,
      resourceType: 'api_key',
      resourceId: keyId,
      metadata: { name: chave.name, prefix: chave.prefix },
      request: req,
    });

    return chave;
  }

  @Post('api-keys/:keyId/rotate')
  @ApiOperation({
    summary: 'Rotacionar uma chave',
    description: 'Revoga a atual e emite outra com os mesmos escopos, em uma transação.',
  })
  async rotate(@Param('keyId') keyId: string, @Req() req: Request) {
    const nova = await this.applications.rotateApiKey(keyId);

    await this.audit.admin('apikey.rotated', {
      username: req.admin?.username,
      resourceType: 'api_key',
      resourceId: nova.id,
      metadata: { previousKeyId: keyId, newPrefix: nova.prefix },
      request: req,
    });

    return nova;
  }
}
