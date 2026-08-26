/**
 * Eventos que o gateway publica aos sistemas integradores.
 *
 * Vive em `shared` porque a API os emite e o painel os exibe — manter a lista em
 * um lado só faria o outro divergir na primeira adição.
 *
 * O envelope é **nosso**, não o cru do WAHA: isso permite trocar de motor ou
 * acompanhar mudanças do WAHA sem quebrar os sistemas integrados.
 */

export const GATEWAY_EVENTS = [
  'message.received',
  'message.sent',
  'message.ack',
  'session.status',
  'session.connected',
  'session.disconnected',
  'ping',
] as const;

export type GatewayEvent = (typeof GATEWAY_EVENTS)[number];

export const GATEWAY_EVENT_LABELS: Record<GatewayEvent, string> = {
  'message.received': 'Mensagem recebida',
  'message.sent': 'Mensagem enviada',
  'message.ack': 'Confirmação de entrega ou leitura',
  'session.status': 'Mudança de estado da sessão',
  'session.connected': 'Número conectado',
  'session.disconnected': 'Número desconectado',
  ping: 'Teste de configuração',
};

/** Envelope entregue ao integrador. */
export interface GatewayEventEnvelope<T = unknown> {
  id: string;
  type: GatewayEvent;
  createdAt: string;
  application: { id: string; slug: string };
  session: {
    id: string;
    label: string | null;
    phoneNumber: string | null;
  } | null;
  data: T;
}

/** `["*"]` recebe tudo. */
export function assinaturaCobreEvento(assinados: string[], evento: GatewayEvent): boolean {
  return assinados.includes('*') || assinados.includes(evento);
}
