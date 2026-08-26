import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { GATEWAY_VERSION } from '@gateway/shared';

import { Public } from './common/decorators/public.decorator';
import { AppConfig } from './config';

/**
 * Raiz da API.
 *
 * Um `GET /` que devolve 404 é hostil: a primeira coisa que alguém faz ao
 * receber uma URL é abri-la no navegador. Esta rota aponta o caminho.
 */
@ApiExcludeController()
@Controller()
export class AppController {
  constructor(private readonly config: AppConfig) {}

  @Public()
  @Get()
  index() {
    return {
      name: 'WhatsApp Gateway W51',
      version: GATEWAY_VERSION,
      documentation: this.config.get('SWAGGER_ENABLED') ? '/docs' : null,
      health: '/health',
      authentication: 'Envie sua chave no header X-API-Key.',
    };
  }
}
