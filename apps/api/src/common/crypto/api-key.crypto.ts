import { randomBytes, timingSafeEqual } from 'node:crypto';

import { Algorithm, hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';

/**
 * Geração e verificação das API keys entregues aos sistemas integradores.
 *
 * Formato:  `wgw_live_a1b2c3d4e5f6_9fK2xQ...`
 *            └────── prefixo ─────┘ └ segredo ┘
 *
 * O **prefixo** é público, único e indexado: é ele que localiza o registro em uma
 * única query, e é o que o painel exibe para identificar a chave depois. O
 * **segredo** só existe em claro na resposta de criação — persistimos apenas o
 * seu hash argon2id, então nem o admin consegue recuperá-lo.
 *
 * Módulo puro de propósito, sem dependência do Nest, para que o seed do Prisma e
 * o ApiKeyService (tarefa 05) compartilhem exatamente a mesma lógica. Duplicar
 * código de credencial é como as duas metades se perdem de vista em silêncio.
 */

/** Perfil OWASP para argon2id: 19 MiB, 2 iterações, paralelismo 1. */
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Bytes da parte aleatória do prefixo (vira o dobro em hex). */
const LOOKUP_BYTES = 6;
const SECRET_BYTES = 32;

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Codifica bytes em base62 — evita `+`, `/` e `=` do base64, que precisariam de
 * escape quando a chave viaja em URL, header ou arquivo de configuração.
 */
function toBase62(buffer: Buffer): string {
  let value = 0n;
  for (const byte of buffer) {
    value = (value << 8n) | BigInt(byte);
  }
  let out = '';
  while (value > 0n) {
    out = BASE62[Number(value % 62n)] + out;
    value /= 62n;
  }
  return out || '0';
}

export interface GeneratedApiKey {
  /** Valor completo, entregue ao integrador uma única vez. */
  plaintext: string;
  /** Parte pública, única e indexada. Exibida no painel. */
  prefix: string;
  /** Hash argon2id do segredo. */
  hash: string;
}

/**
 * Gera uma nova API key.
 * @param namespace prefixo estático vindo de `API_KEY_PREFIX` (ex.: `wgw_live`)
 */
export async function generateApiKey(namespace: string): Promise<GeneratedApiKey> {
  const lookup = randomBytes(LOOKUP_BYTES).toString('hex');
  const secret = toBase62(randomBytes(SECRET_BYTES));
  const prefix = `${namespace}_${lookup}`;
  const hash = await argon2Hash(secret, ARGON2_OPTIONS);

  return { plaintext: `${prefix}_${secret}`, prefix, hash };
}

export interface ParsedApiKey {
  /** Parte pública — usar como chave de busca no banco. */
  prefix: string;
  /** Segredo a conferir contra o hash. */
  secret: string;
}

/**
 * Separa uma chave em prefixo e segredo.
 *
 * A divisão é feita de trás para frente porque o prefixo contém `_`
 * (`wgw_live_a1b2c3d4e5f6`): o segredo é sempre o último segmento.
 *
 * Devolve `null` para qualquer formato inesperado — quem chama trata como
 * credencial inválida, sem distinguir o motivo para o cliente.
 */
export function parseApiKey(plaintext: unknown): ParsedApiKey | null {
  if (typeof plaintext !== 'string') return null;

  const trimmed = plaintext.trim();
  const lastUnderscore = trimmed.lastIndexOf('_');
  if (lastUnderscore <= 0) return null;

  const prefix = trimmed.slice(0, lastUnderscore);
  const secret = trimmed.slice(lastUnderscore + 1);

  if (!secret || !prefix) return null;

  // o prefixo precisa terminar com a parte aleatória em hex do tamanho esperado
  const lookup = prefix.slice(prefix.lastIndexOf('_') + 1);
  if (lookup.length !== LOOKUP_BYTES * 2 || !/^[0-9a-f]+$/.test(lookup)) return null;

  return { prefix, secret };
}

/** Confere o segredo contra o hash armazenado. Nunca lança: erro vira `false`. */
export async function verifyApiKeySecret(secret: string, hash: string): Promise<boolean> {
  try {
    return await argon2Verify(hash, secret, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/** Gera um segredo aleatório em base62 — webhooks, HMAC de sessão, etc. */
export function generateSecret(bytes = 32): string {
  return toBase62(randomBytes(bytes));
}

/**
 * Comparação em tempo constante, para segredos que não passam por argon2
 * (assinaturas HMAC, tokens de webhook). O `===` do JavaScript retorna na
 * primeira diferença e vaza informação por temporização.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
