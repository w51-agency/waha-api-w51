/**
 * Contrato do WAHA (WhatsApp HTTP API), motor NOWEB.
 *
 * Tipado à mão a partir da documentação oficial. Vive em `shared` porque o
 * painel também precisa entender os payloads de evento que chegam pelo SSE.
 */

// =============================================================================
//  Sessões
// =============================================================================

export type WahaSessionStatus =
  | 'STOPPED'
  | 'STARTING'
  | 'SCAN_QR_CODE'
  | 'PASSKEY_REQUIRED'
  | 'PASSKEY_CONFIRMATION_REQUIRED'
  | 'WORKING'
  | 'FAILED';

export interface WahaMe {
  id: string;
  pushName?: string | null;
}

export interface WahaNowebStore {
  enabled: boolean;
  fullSync?: boolean;
}

export interface WahaWebhookConfig {
  url: string;
  events: string[];
  hmac?: { key: string } | null;
  retries?: {
    policy?: 'constant' | 'exponential' | 'linear';
    delaySeconds?: number;
    attempts?: number;
  } | null;
  customHeaders?: Array<{ name: string; value: string }> | null;
}

export interface WahaSessionConfig {
  /**
   * Metadados livres. É por aqui que carimbamos a identidade da aplicação na
   * criação da sessão — o WAHA devolve este objeto em **todo webhook**, o que
   * torna o rastreio de origem confiável sem tabela de correlação.
   */
  metadata?: Record<string, string>;
  debug?: boolean;
  noweb?: { store?: WahaNowebStore; markOnline?: boolean };
  webhooks?: WahaWebhookConfig[];
  proxy?: { server: string; username?: string; password?: string } | null;
  ignore?: { status?: boolean; groups?: boolean; channels?: boolean };
}

export interface WahaSession {
  name: string;
  status: WahaSessionStatus;
  config?: WahaSessionConfig;
  me?: WahaMe | null;
  engine?: { engine: string; [k: string]: unknown };
}

export interface WahaCreateSessionRequest {
  name: string;
  start?: boolean;
  config?: WahaSessionConfig;
}

// =============================================================================
//  Autenticação
// =============================================================================

export interface WahaQrCode {
  /** URL de pareamento codificada no QR. */
  value: string;
}

export interface WahaPairingCode {
  code: string;
}

// =============================================================================
//  Mensagens
// =============================================================================

/** Arquivo por URL remota ou por conteúdo em base64 — nunca os dois. */
export type WahaFile =
  | { mimetype: string; url: string; filename?: string }
  | { mimetype: string; data: string; filename?: string };

export interface WahaSendTextRequest {
  session: string;
  chatId: string;
  text: string;
  linkPreview?: boolean;
  mentions?: string[];
  reply_to?: string | null;
}

export interface WahaSendMediaRequest {
  session: string;
  chatId: string;
  file: WahaFile;
  caption?: string;
  reply_to?: string | null;
  convert?: boolean;
  asNote?: boolean;
}

export interface WahaSendLocationRequest {
  session: string;
  chatId: string;
  latitude: number;
  longitude: number;
  title?: string;
}

export interface WahaSendContactRequest {
  session: string;
  chatId: string;
  contacts: Array<{ vcard: string } | { fullName: string; phoneNumber: string }>;
}

export interface WahaReactionRequest {
  session: string;
  messageId: string;
  reaction: string;
}

export interface WahaSendSeenRequest {
  session: string;
  chatId: string;
  messageIds?: string[];
}

export interface WahaMessage {
  id: string;
  timestamp: number;
  from: string;
  to?: string;
  fromMe: boolean;
  body?: string;
  hasMedia?: boolean;
  media?: { url?: string; mimetype?: string; filename?: string; error?: string | null } | null;
  ack?: number;
  ackName?: string;
  replyTo?: unknown;
  _data?: unknown;
  [k: string]: unknown;
}

export interface WahaChat {
  id: string;
  name?: string | null;
  conversationTimestamp?: number | null;
  unreadCount?: number;
  [k: string]: unknown;
}

export interface WahaNumberExists {
  numberExists: boolean;
  chatId?: string;
}

// =============================================================================
//  Webhooks
// =============================================================================

export type WahaEventName =
  | 'session.status'
  | 'state.change'
  | 'message'
  | 'message.any'
  | 'message.ack'
  | 'message.reaction'
  | 'message.waiting'
  | 'message.edited'
  | 'message.revoked'
  | 'group.v2.join'
  | 'group.v2.leave'
  | 'group.v2.participants'
  | 'group.v2.update'
  | 'chat.archive'
  | 'presence.update'
  | 'poll.vote'
  | 'call.received'
  | 'call.accepted'
  | 'call.rejected'
  | 'label.upsert'
  | 'label.deleted'
  | 'event.response'
  | 'engine.event';

/** Envelope comum a todos os eventos entregues pelo WAHA. */
export interface WahaWebhookEvent<T = unknown> {
  /** Identificador único do evento — a base da idempotência da ingestão. */
  id: string;
  timestamp: number;
  event: WahaEventName | string;
  session: string;
  /** O `config.metadata` carimbado na criação da sessão, devolvido intacto. */
  metadata?: Record<string, string> | null;
  me?: WahaMe | null;
  payload: T;
  engine?: string;
  environment?: { tier?: string; version?: string };
}

export interface WahaSessionStatusPayload {
  name?: string;
  status: WahaSessionStatus;
  [k: string]: unknown;
}

export interface WahaMessageAckPayload {
  id: string;
  from?: string;
  to?: string;
  fromMe?: boolean;
  participant?: string | null;
  ack: number;
  ackName?: string;
  [k: string]: unknown;
}
