import type { MessageStatus, SessionStatus } from '@gateway/shared';

/**
 * Tipos das respostas da API consumidas pelo painel.
 *
 * Escritos à mão em vez de gerados do OpenAPI: o painel usa poucos endpoints, e
 * um gerador acrescentaria uma etapa de build para pouco ganho. Se a superfície
 * crescer, `docs/openapi.json` está versionado e a geração é direta.
 */

export interface Sessao {
  id: string;
  label: string | null;
  status: SessionStatus;
  statusLabel: string;
  phoneNumber: string | null;
  pushName: string | null;
  engine: string;
  qrRequestCount: number;
  lastQrRequestedAt: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  /** Presente apenas nas listagens do painel. */
  application?: { id: string; name: string; slug: string };
}

export interface QrCode {
  value: string;
  imageBase64: string;
  status: SessionStatus;
  expiresInSeconds: number;
}

export interface Mensagem {
  id: string;
  wahaId: string | null;
  sessionId: string;
  sessionLabel: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  chatId: string;
  phone: string;
  type: string;
  body: string | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaSize: number | null;
  status: MessageStatus;
  ack: number | null;
  error: string | null;
  sentByApiKeyId: string | null;
  timestamp: string;
  raw?: unknown;
}

export interface PaginaMensagens {
  data: Mensagem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface Aplicacao {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  counts?: {
    sessions: number;
    connectedSessions: number;
    activeApiKeys: number;
    messagesLast30Days: number;
  };
}

export interface Chave {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  active: boolean;
}

export interface ChaveCriada extends Chave {
  secret: string;
  warning: string;
}

export interface AplicacaoDetalhe extends Aplicacao {
  apiKeys: Chave[];
}

export interface Endpoint {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  description: string | null;
  consecutiveFailures: number;
  disabledAt: string | null;
  disabledReason: string | null;
  createdAt: string;
}

export interface EndpointCriado extends Endpoint {
  secret: string;
  warning: string;
}

export interface Entrega {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number | null;
  nextRetryAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface RegistroAuditoria {
  id: string;
  actorType: 'ADMIN' | 'API_KEY' | 'SYSTEM';
  actorId: string | null;
  actorLabel: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  description: string;
}

export interface VisaoGeral {
  sessions: {
    total: number;
    connected: number;
    awaitingQr: number;
    stopped: number;
    failed: number;
    byStatus: Record<string, number>;
  };
  messages: { today: number; last7Days: number; last30Days: number };
  delivery: { sent: number; delivered: number; failed: number; rate: number | null };
  applications: { active: number };
  alerts: { disabledWebhookEndpoints: number; failedSessions: number };
}

export interface SerieMensagens {
  granularity: 'hour' | 'day';
  series: Array<{ bucket: string; inbound: number; outbound: number; total: number }>;
}

export interface MetricaAplicacao {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  messagesLast30Days: number;
  connectedSessions: number;
  lastActivityAt: string | null;
}

export interface MetricaSessao {
  id: string;
  label: string | null;
  phoneNumber: string | null;
  status: SessionStatus;
  application: { name: string; slug: string };
  connectedAt: string | null;
  qrRequestCount: number;
  messagesLast30Days: number;
}
