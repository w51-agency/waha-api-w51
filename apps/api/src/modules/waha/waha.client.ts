import { Injectable, Logger } from '@nestjs/common';
import { Agent, request } from 'undici';

import type {
  WahaChat,
  WahaCreateSessionRequest,
  WahaMe,
  WahaMessage,
  WahaNumberExists,
  WahaPairingCode,
  WahaQrCode,
  WahaReactionRequest,
  WahaSendContactRequest,
  WahaSendLocationRequest,
  WahaSendMediaRequest,
  WahaSendSeenRequest,
  WahaSendTextRequest,
  WahaSession,
  WahaSessionConfig,
} from '@gateway/shared';

import { AppConfig } from '../../config';

import {
  WahaAuthError,
  WahaSessionNotFoundError,
  WahaUnavailableError,
  WahaValidationError,
} from './waha.errors';

type Metodo = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface CallOptions {
  /** Corpo JSON. */
  body?: unknown;
  /** Sobrescreve o timeout padrão — envio de mídia precisa de mais. */
  timeoutMs?: number;
  /**
   * Autoriza retentativa automática.
   *
   * **Só para operações idempotentes.** Envio de mensagem nunca é retentado: um
   * timeout pode significar "entregue, resposta perdida", e repetir duplicaria a
   * mensagem no aparelho do destinatário. Ali a falha é explícita e a decisão de
   * repetir é do integrador, com chave de idempotência.
   */
  retryable?: boolean;
  /** Nome da sessão, para mensagens de erro precisas. */
  session?: string;
}

const MAX_TENTATIVAS = 3;

@Injectable()
export class WahaClient {
  private readonly logger = new Logger(WahaClient.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutPadrao: number;

  /** Pool com keep-alive: sem ele, cada chamada pagaria um handshake TCP. */
  private readonly agent: Agent;

  constructor(private readonly config: AppConfig) {
    this.baseUrl = config.get('WAHA_BASE_URL').replace(/\/+$/, '');
    this.apiKey = config.get('WAHA_API_KEY');
    this.timeoutPadrao = config.get('WAHA_TIMEOUT_MS');

    this.agent = new Agent({
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
      connections: 32,
    });
  }

  // ===========================================================================
  //  Sessões
  // ===========================================================================

  createSession(dto: WahaCreateSessionRequest): Promise<WahaSession> {
    return this.call<WahaSession>('POST', '/api/sessions', {
      body: dto,
      session: dto.name,
    });
  }

  listSessions(all = false): Promise<WahaSession[]> {
    return this.call<WahaSession[]>('GET', `/api/sessions${all ? '?all=true' : ''}`, {
      retryable: true,
    });
  }

  getSession(name: string): Promise<WahaSession> {
    return this.call<WahaSession>('GET', `/api/sessions/${encodeURIComponent(name)}`, {
      retryable: true,
      session: name,
    });
  }

  updateSession(name: string, config: WahaSessionConfig): Promise<WahaSession> {
    return this.call<WahaSession>('PUT', `/api/sessions/${encodeURIComponent(name)}`, {
      body: { config },
      session: name,
    });
  }

  startSession(name: string): Promise<WahaSession> {
    return this.sessionAction(name, 'start');
  }

  stopSession(name: string): Promise<WahaSession> {
    return this.sessionAction(name, 'stop');
  }

  restartSession(name: string): Promise<WahaSession> {
    return this.sessionAction(name, 'restart');
  }

  logoutSession(name: string): Promise<WahaSession> {
    return this.sessionAction(name, 'logout');
  }

  async deleteSession(name: string): Promise<void> {
    await this.call<void>('DELETE', `/api/sessions/${encodeURIComponent(name)}`, {
      retryable: true,
      session: name,
    });
  }

  getMe(name: string): Promise<WahaMe> {
    return this.call<WahaMe>('GET', `/api/sessions/${encodeURIComponent(name)}/me`, {
      retryable: true,
      session: name,
    });
  }

  private sessionAction(name: string, acao: string): Promise<WahaSession> {
    // start/stop/restart/logout são idempotentes no WAHA — repetir é seguro.
    return this.call<WahaSession>('POST', `/api/sessions/${encodeURIComponent(name)}/${acao}`, {
      retryable: true,
      session: name,
    });
  }

  // ===========================================================================
  //  Autenticação do número
  // ===========================================================================

  /** QR em formato bruto — o valor que o app do WhatsApp lê. */
  getQrValue(session: string): Promise<WahaQrCode> {
    return this.call<WahaQrCode>('GET', `/api/${encodeURIComponent(session)}/auth/qr?format=raw`, {
      retryable: true,
      session,
    });
  }

  /** QR já renderizado como PNG. */
  async getQrImage(session: string): Promise<Buffer> {
    const { corpo } = await this.raw(
      'GET',
      `/api/${encodeURIComponent(session)}/auth/qr?format=image`,
      { retryable: true, session },
    );
    return corpo;
  }

  requestPairingCode(session: string, phoneNumber: string): Promise<WahaPairingCode> {
    return this.call<WahaPairingCode>(
      'POST',
      `/api/${encodeURIComponent(session)}/auth/request-code`,
      { body: { phoneNumber }, session },
    );
  }

  // ===========================================================================
  //  Envio — nenhum destes é retentável
  // ===========================================================================

  sendText(dto: WahaSendTextRequest): Promise<WahaMessage> {
    return this.call<WahaMessage>('POST', '/api/sendText', { body: dto, session: dto.session });
  }

  sendImage(dto: WahaSendMediaRequest): Promise<WahaMessage> {
    return this.sendMedia('/api/sendImage', dto);
  }

  sendFile(dto: WahaSendMediaRequest): Promise<WahaMessage> {
    return this.sendMedia('/api/sendFile', dto);
  }

  sendVoice(dto: WahaSendMediaRequest): Promise<WahaMessage> {
    return this.sendMedia('/api/sendVoice', dto);
  }

  sendVideo(dto: WahaSendMediaRequest): Promise<WahaMessage> {
    return this.sendMedia('/api/sendVideo', dto);
  }

  sendLocation(dto: WahaSendLocationRequest): Promise<WahaMessage> {
    return this.call<WahaMessage>('POST', '/api/sendLocation', {
      body: dto,
      session: dto.session,
    });
  }

  sendContact(dto: WahaSendContactRequest): Promise<WahaMessage> {
    return this.call<WahaMessage>('POST', '/api/sendContactVcard', {
      body: dto,
      session: dto.session,
    });
  }

  setReaction(dto: WahaReactionRequest): Promise<unknown> {
    return this.call<unknown>('PUT', '/api/reaction', { body: dto, session: dto.session });
  }

  sendSeen(dto: WahaSendSeenRequest): Promise<unknown> {
    return this.call<unknown>('POST', '/api/sendSeen', { body: dto, session: dto.session });
  }

  startTyping(session: string, chatId: string): Promise<unknown> {
    return this.call<unknown>('POST', '/api/startTyping', { body: { session, chatId }, session });
  }

  stopTyping(session: string, chatId: string): Promise<unknown> {
    return this.call<unknown>('POST', '/api/stopTyping', { body: { session, chatId }, session });
  }

  /** Mídia pode ser grande: timeout maior, mas ainda sem retentativa. */
  private sendMedia(caminho: string, dto: WahaSendMediaRequest): Promise<WahaMessage> {
    return this.call<WahaMessage>('POST', caminho, {
      body: dto,
      session: dto.session,
      timeoutMs: Math.max(this.timeoutPadrao, 60_000),
    });
  }

  // ===========================================================================
  //  Leitura
  // ===========================================================================

  getChats(session: string, limit = 50, offset = 0): Promise<WahaChat[]> {
    return this.call<WahaChat[]>(
      'GET',
      `/api/${encodeURIComponent(session)}/chats?limit=${limit}&offset=${offset}`,
      { retryable: true, session },
    );
  }

  getChatMessages(session: string, chatId: string, limit = 50): Promise<WahaMessage[]> {
    return this.call<WahaMessage[]>(
      'GET',
      `/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}&downloadMedia=false`,
      { retryable: true, session },
    );
  }

  checkNumberExists(session: string, phone: string): Promise<WahaNumberExists> {
    return this.call<WahaNumberExists>(
      'GET',
      `/api/contacts/check-exists?phone=${encodeURIComponent(phone)}&session=${encodeURIComponent(session)}`,
      { retryable: true, session },
    );
  }

  /** Baixa mídia de uma URL interna do WAHA, para o proxy autenticado. */
  async downloadMedia(url: string): Promise<{ corpo: Buffer; contentType: string }> {
    const resposta = await request(url, {
      method: 'GET',
      headers: { 'x-api-key': this.apiKey },
      dispatcher: this.agent,
      headersTimeout: 30_000,
      bodyTimeout: 120_000,
    });

    const corpo = Buffer.from(await resposta.body.arrayBuffer());

    if (resposta.statusCode >= 400) {
      throw new WahaUnavailableError(`mídia indisponível (HTTP ${resposta.statusCode})`);
    }

    return {
      corpo,
      contentType: String(resposta.headers['content-type'] ?? 'application/octet-stream'),
    };
  }

  // ===========================================================================
  //  Saúde
  // ===========================================================================

  async healthCheck(): Promise<boolean> {
    try {
      const resposta = await request(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: { 'x-api-key': this.apiKey },
        dispatcher: this.agent,
        headersTimeout: 3_000,
        bodyTimeout: 3_000,
      });
      await resposta.body.dump();
      return resposta.statusCode === 200;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  //  Transporte
  // ===========================================================================

  private async call<T>(metodo: Metodo, caminho: string, opcoes: CallOptions = {}): Promise<T> {
    const { corpo } = await this.raw(metodo, caminho, opcoes);
    if (corpo.length === 0) return undefined as T;

    try {
      return JSON.parse(corpo.toString('utf8')) as T;
    } catch {
      throw new WahaUnavailableError('resposta não é JSON válido');
    }
  }

  private async raw(
    metodo: Metodo,
    caminho: string,
    opcoes: CallOptions = {},
  ): Promise<{ corpo: Buffer; contentType: string }> {
    const url = `${this.baseUrl}${caminho}`;
    const timeout = opcoes.timeoutMs ?? this.timeoutPadrao;
    const tentativasMax = opcoes.retryable ? MAX_TENTATIVAS : 1;

    let ultimoErro: unknown;

    for (let tentativa = 1; tentativa <= tentativasMax; tentativa++) {
      const inicio = Date.now();

      try {
        const resposta = await request(url, {
          method: metodo,
          headers: {
            'x-api-key': this.apiKey,
            ...(opcoes.body ? { 'content-type': 'application/json' } : {}),
          },
          body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
          dispatcher: this.agent,
          headersTimeout: timeout,
          bodyTimeout: timeout,
        });

        const corpo = Buffer.from(await resposta.body.arrayBuffer());
        const duracao = Date.now() - inicio;

        this.logger.debug(
          `${metodo} ${caminho} -> ${resposta.statusCode} (${duracao}ms${tentativa > 1 ? `, tentativa ${tentativa}` : ''})`,
        );

        if (resposta.statusCode >= 500 && tentativa < tentativasMax) {
          ultimoErro = new WahaUnavailableError(`HTTP ${resposta.statusCode}`);
          await espera(backoffMs(tentativa));
          continue;
        }

        if (resposta.statusCode >= 400) {
          throw this.traduzir(resposta.statusCode, corpo, opcoes.session);
        }

        return {
          corpo,
          contentType: String(resposta.headers['content-type'] ?? 'application/octet-stream'),
        };
      } catch (erro) {
        // Erros já traduzidos são de negócio: não retentar.
        if (erro instanceof WahaSessionNotFoundError || erro instanceof WahaValidationError) {
          throw erro;
        }
        if (erro instanceof WahaAuthError) throw erro;

        ultimoErro = erro;

        const conexao = isErroDeConexao(erro);
        if (!conexao || tentativa >= tentativasMax) {
          if (conexao) break;
          throw erro;
        }

        this.logger.warn(
          `${metodo} ${caminho} falhou (${descreverErro(erro)}), ` +
            `tentativa ${tentativa}/${tentativasMax}`,
        );
        await espera(backoffMs(tentativa));
      }
    }

    throw new WahaUnavailableError(descreverErro(ultimoErro), ultimoErro);
  }

  private traduzir(status: number, corpo: Buffer, session?: string): Error {
    const texto = corpo.toString('utf8').slice(0, 2000);
    let detalhe: unknown = texto;

    try {
      detalhe = JSON.parse(texto);
    } catch {
      /* corpo não-JSON: fica o texto cru */
    }

    const mensagem = extrairMensagem(detalhe) ?? texto;

    if (status === 401 || status === 403) return new WahaAuthError(detalhe);
    if (status === 404) return new WahaSessionNotFoundError(session ?? 'desconhecida', detalhe);
    if (status === 422 || status === 400) {
      return new WahaValidationError(traduzirMensagemWaha(mensagem, session), detalhe);
    }
    return new WahaUnavailableError(`HTTP ${status}`, detalhe);
  }
}

/**
 * Traduz as mensagens de erro do WAHA.
 *
 * Elas vêm em inglês e costumam ser lacônicas ("Session status is not as
 * expected"). Como chegam direto ao integrador, traduzi-las e acrescentar o que
 * fazer é a diferença entre um erro acionável e um chamado de suporte.
 */
function traduzirMensagemWaha(mensagem: string, session?: string): string {
  const alvo = session ? ` (sessão "${session}")` : '';

  const regras: Array<[RegExp, string]> = [
    [
      /session status is not as expected|session is not working|not connected/i,
      `A sessão não está conectada${alvo}. Verifique o status em GET /v1/sessions/{id} e escaneie o QR code se necessário.`,
    ],
    [
      /number.*not.*(exist|registered)|not.*a.*whatsapp.*(user|number)/i,
      'O número informado não possui WhatsApp.',
    ],
    [/invalid.*chatid|chatid.*invalid/i, 'O destinatário informado é inválido.'],
    [/file.*too.*large|payload.*too.*large/i, 'O arquivo excede o tamanho aceito pelo WhatsApp.'],
    [/unsupported.*(media|mimetype|format)/i, 'O formato do arquivo não é aceito pelo WhatsApp.'],
    [
      /rate.*limit|too many requests/i,
      'O WhatsApp está limitando os envios. Aguarde antes de tentar novamente.',
    ],
    [/timeout/i, 'O WhatsApp demorou demais para responder.'],
  ];

  for (const [padrao, traducao] of regras) {
    if (padrao.test(mensagem)) return traducao;
  }

  return mensagem || 'O serviço de WhatsApp recusou a requisição.';
}

/** Backoff exponencial com jitter — sem o jitter, falhas simultâneas voltam juntas. */
function backoffMs(tentativa: number): number {
  const base = 200 * 2 ** (tentativa - 1);
  return base + Math.floor(Math.random() * base * 0.5);
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isErroDeConexao(erro: unknown): boolean {
  if (typeof erro !== 'object' || erro === null) return false;
  const codigo = (erro as { code?: string }).code;
  const nome = (erro as { name?: string }).name;
  return (
    ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_SOCKET'].includes(
      codigo ?? '',
    ) ||
    ['HeadersTimeoutError', 'BodyTimeoutError', 'ConnectTimeoutError', 'SocketError'].includes(
      nome ?? '',
    )
  );
}

function descreverErro(erro: unknown): string {
  if (typeof erro !== 'object' || erro === null) return String(erro);
  const e = erro as { code?: string; message?: string };
  return e.code ?? e.message ?? 'erro desconhecido';
}

/** O WAHA usa `message` em alguns erros e `error` em outros. */
function extrairMensagem(detalhe: unknown): string | null {
  if (typeof detalhe !== 'object' || detalhe === null) return null;
  const d = detalhe as { message?: unknown; error?: unknown };
  if (typeof d.message === 'string') return d.message;
  if (Array.isArray(d.message)) return d.message.join('; ');
  if (typeof d.error === 'string') return d.error;
  return null;
}
