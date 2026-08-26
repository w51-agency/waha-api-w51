/**
 * Tipos e enums compartilhados entre a API (apps/api) e o painel (apps/web).
 *
 * Os enums aqui espelham 1:1 os do Prisma. São redeclarados em vez de
 * reexportados do client gerado de propósito: o painel roda no navegador e não
 * deve arrastar o Prisma para o bundle. O teste de alinhamento em
 * `apps/api/test/shared-enums.spec.ts` (tarefa 20) falha se os dois divergirem.
 */

// =============================================================================
//  Sessões
// =============================================================================

/** Status de uma sessão de WhatsApp. Espelha os valores emitidos pelo WAHA. */
export enum SessionStatus {
  STOPPED = 'STOPPED',
  STARTING = 'STARTING',
  SCAN_QR_CODE = 'SCAN_QR_CODE',
  PASSKEY_REQUIRED = 'PASSKEY_REQUIRED',
  PASSKEY_CONFIRMATION_REQUIRED = 'PASSKEY_CONFIRMATION_REQUIRED',
  WORKING = 'WORKING',
  FAILED = 'FAILED',
  /** Valor novo que o WAHA passou a emitir e ainda não mapeamos. */
  UNKNOWN = 'UNKNOWN',
}

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  [SessionStatus.STOPPED]: 'Parado',
  [SessionStatus.STARTING]: 'Iniciando',
  [SessionStatus.SCAN_QR_CODE]: 'Aguardando QR',
  [SessionStatus.PASSKEY_REQUIRED]: 'Passkey necessária',
  [SessionStatus.PASSKEY_CONFIRMATION_REQUIRED]: 'Confirmação pendente',
  [SessionStatus.WORKING]: 'Conectado',
  [SessionStatus.FAILED]: 'Falhou',
  [SessionStatus.UNKNOWN]: 'Desconhecido',
};

/** Status em que a sessão consegue enviar mensagens. */
export const SESSION_STATUS_OPERATIONAL: readonly SessionStatus[] = [SessionStatus.WORKING];

export enum CreatedVia {
  API = 'API',
  DASHBOARD = 'DASHBOARD',
}

// =============================================================================
//  Mensagens
// =============================================================================

export enum Direction {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
}

export const DIRECTION_LABELS: Record<Direction, string> = {
  [Direction.INBOUND]: 'Recebida',
  [Direction.OUTBOUND]: 'Enviada',
};

export enum MessageStatus {
  QUEUED = 'QUEUED',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  READ = 'READ',
  FAILED = 'FAILED',
}

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  [MessageStatus.QUEUED]: 'Na fila',
  [MessageStatus.SENT]: 'Enviada',
  [MessageStatus.DELIVERED]: 'Entregue',
  [MessageStatus.READ]: 'Lida',
  [MessageStatus.FAILED]: 'Falhou',
};

/**
 * Confirmações do WhatsApp. A progressão é monotônica: o status de uma mensagem
 * nunca deve regredir, mesmo que os webhooks cheguem fora de ordem.
 */
export const ACK_TO_STATUS: Record<number, MessageStatus> = {
  [-1]: MessageStatus.FAILED,
  0: MessageStatus.QUEUED,
  1: MessageStatus.SENT,
  2: MessageStatus.DELIVERED,
  3: MessageStatus.READ,
  4: MessageStatus.READ, // reproduzida (áudio/vídeo)
};

/** Ordem de progressão, usada para impedir regressão de status. */
export const MESSAGE_STATUS_RANK: Record<MessageStatus, number> = {
  [MessageStatus.FAILED]: -1,
  [MessageStatus.QUEUED]: 0,
  [MessageStatus.SENT]: 1,
  [MessageStatus.DELIVERED]: 2,
  [MessageStatus.READ]: 3,
};

// =============================================================================
//  Webhooks e auditoria
// =============================================================================

export enum DeliveryStatus {
  PENDING = 'PENDING',
  RETRYING = 'RETRYING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  ABANDONED = 'ABANDONED',
}

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  [DeliveryStatus.PENDING]: 'Pendente',
  [DeliveryStatus.RETRYING]: 'Retentando',
  [DeliveryStatus.SUCCESS]: 'Entregue',
  [DeliveryStatus.FAILED]: 'Falhou',
  [DeliveryStatus.ABANDONED]: 'Abandonada',
};

export enum ActorType {
  ADMIN = 'ADMIN',
  API_KEY = 'API_KEY',
  SYSTEM = 'SYSTEM',
}

// =============================================================================
//  Escopos das API keys
// =============================================================================

export const API_SCOPES = [
  'sessions:read',
  'sessions:write',
  'messages:read',
  'messages:send',
  'chats:read',
  'webhooks:manage',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  'sessions:read': 'Consultar sessões e números conectados',
  'sessions:write': 'Criar, conectar e remover sessões',
  'messages:read': 'Consultar o histórico de mensagens',
  'messages:send': 'Enviar mensagens',
  'chats:read': 'Ler conversas e contatos do aparelho',
  'webhooks:manage': 'Gerenciar endpoints de webhook',
};

export const GATEWAY_VERSION = '0.1.0';
