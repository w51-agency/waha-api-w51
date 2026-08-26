import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '../common/decorators/public.decorator';

import { HealthService } from './health.service';

/**
 * Sondas de saúde.
 *
 * A distinção entre as duas importa para orquestradores:
 *
 * - **`/health`** (liveness) não toca em dependência alguma. Se ele falhar, o
 *   processo está travado e reiniciar resolve.
 * - **`/health/ready`** (readiness) verifica Postgres, Redis e WAHA. Se falhar,
 *   o processo está vivo mas não consegue trabalhar — reiniciar não ajuda, tirar
 *   do balanceador ajuda.
 *
 * Confundir as duas produz o pior dos mundos: um banco lento derruba todos os
 * containers em cascata.
 */
// Sondas ficam fora do rate limit de propósito: o healthcheck do Docker bate a
// cada poucos segundos e, somado a probes de balanceador, esgotaria a cota — o
// container seria marcado como não saudável por excesso de verificação de
// saúde, que é o oposto do que a sonda existe para fazer.
@SkipThrottle()
@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  liveness() {
    return this.health.liveness();
  }

  @Public()
  @Get('ready')
  readiness() {
    return this.health.readiness();
  }
}
