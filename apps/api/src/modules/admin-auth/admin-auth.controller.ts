import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../../common/decorators/public.decorator';

import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from './admin.guard';
import { LoginDto, RefreshDto } from './dto/login.dto';
import { LoginResponse } from './dto/login.response';

import type { Request } from 'express';

@ApiTags('Admin')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  /**
   * Limite agressivo e por IP: com um único usuário administrativo, o login é o
   * ponto onde força bruta compensa. Cinco tentativas por cinco minutos deixa
   * espaço para engano humano e nenhum para varredura automatizada.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Entrar no painel' })
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.auth.login(dto.username, dto.password);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 300_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Renovar a sessão',
    description:
      'Troca o refreshToken por um par novo. O token anterior é consumido; ' +
      'reusá-lo derruba a sessão inteira, por segurança.',
  })
  refresh(@Body() dto: RefreshDto): Promise<LoginResponse> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Encerrar a sessão' })
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @UseGuards(AdminGuard)
  @ApiBearerAuth('BearerAuth')
  @Get('me')
  @ApiOperation({ summary: 'Identidade da sessão atual' })
  me(@Req() request: Request) {
    return { username: request.admin?.username };
  }
}
