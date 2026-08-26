import { randomUUID } from 'node:crypto';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Algorithm, hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';

import { UnauthorizedError } from '../../common/errors/problem-details';
import { AppConfig } from '../../config';
import { RedisService } from '../../redis/redis.service';

import { LoginResponse } from './dto/login.response';

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Prefixo das chaves de refresh no Redis. */
const REFRESH_PREFIX = 'admin:refresh:';
/** Prefixo do contador de famílias de token, para detectar reuso. */
const FAMILY_PREFIX = 'admin:family:';

interface RefreshRecord {
  family: string;
  username: string;
}

/**
 * Autenticação do painel — usuário único vindo do ambiente.
 *
 * Não há tabela de usuários: `ADMIN_USERNAME` e `ADMIN_PASSWORD` vêm do `.env`.
 * Isso mantém o escopo enxuto, mas concentra todo o acesso administrativo em uma
 * credencial só, o que exige três cuidados:
 *
 * 1. A senha é comparada com **argon2id**, contra um hash derivado na subida —
 *    não por igualdade de string.
 * 2. Usuário inexistente **também paga o custo do hash**, para que o tempo de
 *    resposta não revele se o nome está certo.
 * 3. Refresh tokens vivem no Redis com detecção de reuso: um token usado duas
 *    vezes invalida a família inteira, porque isso significa que alguém copiou
 *    um token que já foi consumido.
 */
@Injectable()
export class AdminAuthService implements OnModuleInit {
  private readonly logger = new Logger(AdminAuthService.name);

  private passwordHash!: string;
  /** Hash descartável usado para gastar tempo quando o usuário não confere. */
  private dummyHash!: string;

  constructor(
    private readonly config: AppConfig,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    const senha = this.config.get('ADMIN_PASSWORD');
    this.passwordHash = await argon2Hash(senha, ARGON2_OPTIONS);
    this.dummyHash = await argon2Hash(randomUUID(), ARGON2_OPTIONS);

    if (senha === 'troque-me' || senha.toLowerCase() === 'admin') {
      this.logger.warn(
        'ADMIN_PASSWORD está com um valor de exemplo. ' +
          'Rode ./scripts/gen-secrets.sh --force antes de expor o painel.',
      );
    }
  }

  async login(username: string, password: string): Promise<LoginResponse> {
    const usuarioEsperado = this.config.get('ADMIN_USERNAME');
    const usuarioConfere = username === usuarioEsperado;

    // Verificar sempre, mesmo com usuário errado: sair antes tornaria a
    // resposta mensuravelmente mais rápida e entregaria o nome de usuário.
    const senhaConfere = await argon2Verify(
      usuarioConfere ? this.passwordHash : this.dummyHash,
      password,
      ARGON2_OPTIONS,
    ).catch(() => false);

    if (!usuarioConfere || !senhaConfere) {
      throw new UnauthorizedError('Usuário ou senha inválidos.', 'invalid-credentials');
    }

    return this.issueTokens(usuarioEsperado, randomUUID());
  }

  /**
   * Troca um refresh token por um par novo.
   *
   * O token anterior é consumido no mesmo passo. Se ele já tiver sido consumido,
   * a família inteira é revogada: um refresh usado duas vezes significa que
   * alguém está com uma cópia, e não há como saber qual das duas partes é a
   * legítima — derrubar as duas e exigir novo login é a única resposta segura.
   */
  async refresh(refreshToken: string): Promise<LoginResponse> {
    const chave = `${REFRESH_PREFIX}${refreshToken}`;
    const bruto = await this.redis.client.getdel(chave);

    if (!bruto) {
      // Pode ser expirado, inexistente — ou reuso. Sem o registro não dá para
      // saber a família, então só resta recusar.
      throw new UnauthorizedError('Sessão expirada. Faça login novamente.', 'invalid-refresh');
    }

    const registro = JSON.parse(bruto) as RefreshRecord;

    const familiaValida = await this.redis.client.get(`${FAMILY_PREFIX}${registro.family}`);
    if (!familiaValida) {
      throw new UnauthorizedError('Sessão expirada. Faça login novamente.', 'invalid-refresh');
    }

    return this.issueTokens(registro.username, registro.family);
  }

  async logout(refreshToken: string): Promise<void> {
    const bruto = await this.redis.client.getdel(`${REFRESH_PREFIX}${refreshToken}`);
    if (!bruto) return;

    const registro = JSON.parse(bruto) as RefreshRecord;
    await this.revokeFamily(registro.family);
  }

  /** Derruba todos os tokens de uma família — usado no logout e na detecção de reuso. */
  async revokeFamily(family: string): Promise<void> {
    await this.redis.client.del(`${FAMILY_PREFIX}${family}`);
  }

  private async issueTokens(username: string, family: string): Promise<LoginResponse> {
    // Em segundos, não como "15m": o tipo do @nestjs/jwt só aceita literais de
    // duração conhecidos em tempo de compilação, e o valor vem de configuração.
    // Usar o mesmo parseDuration em tudo também evita que o TTL do token e o
    // `expiresIn` da resposta divirjam.
    const accessTtl = parseDuration(this.config.get('JWT_ACCESS_TTL'));

    const accessToken = await this.jwt.signAsync(
      { sub: username, role: 'admin' },
      {
        secret: this.config.get('JWT_SECRET'),
        expiresIn: accessTtl,
        jwtid: randomUUID(),
      },
    );

    const refreshToken = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    const ttlSegundos = parseDuration(this.config.get('JWT_REFRESH_TTL'));

    const registro: RefreshRecord = { family, username };
    await this.redis.client.setex(
      `${REFRESH_PREFIX}${refreshToken}`,
      ttlSegundos,
      JSON.stringify(registro),
    );
    await this.redis.client.setex(`${FAMILY_PREFIX}${family}`, ttlSegundos, '1');

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTtl,
      tokenType: 'Bearer',
      user: { username },
    };
  }
}

/** Converte "15m", "7d", "3600" em segundos. */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhd]?)$/.exec(value.trim());
  if (!match) return 900;

  const quantidade = Number(match[1]);
  const multiplicadores: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, '': 1 };
  return quantidade * (multiplicadores[match[2] ?? ''] ?? 1);
}
