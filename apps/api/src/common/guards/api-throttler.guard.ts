import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import type { Request } from 'express';

/**
 * Rate limit por API key, com IP como alternativa.
 *
 * Chavear apenas por IP puniria todos os clientes atrás de um mesmo NAT ou
 * proxy corporativo por causa de um só — e, pior, permitiria que um integrador
 * com várias saídas de rede contornasse o limite trocando de IP. A chave é a
 * unidade de cobrança e de responsabilidade, então é ela que deve ser contada.
 *
 * Requisições ainda não autenticadas caem no IP, que é tudo o que se sabe delas.
 */
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Request): Promise<string> {
    if (req.apiKey) return `key:${req.apiKey.id}`;
    return `ip:${req.ip ?? 'desconhecido'}`;
  }
}
