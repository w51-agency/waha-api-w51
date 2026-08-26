/**
 * Os eventos do gateway vivem em `@gateway/shared`: a API os emite e o painel os
 * exibe, então a lista precisa ser única. Este arquivo apenas reexporta, para
 * que os imports do módulo continuem locais.
 */
export {
  assinaturaCobreEvento,
  GATEWAY_EVENT_LABELS,
  GATEWAY_EVENTS,
  type GatewayEvent,
  type GatewayEventEnvelope,
} from '@gateway/shared';
