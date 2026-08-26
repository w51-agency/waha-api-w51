/**
 * Tipos e enums compartilhados entre a API (apps/api) e o painel (apps/web).
 *
 * Os enums de domínio espelham 1:1 os enums do Prisma (tarefa 03) e os status
 * de sessão do WAHA — manter os três alinhados é o que evita conversão manual
 * espalhada pelo código.
 */

/** Status de uma sessão de WhatsApp, alinhado com os valores emitidos pelo WAHA. */
export enum SessionStatus {
  STOPPED = 'STOPPED',
  STARTING = 'STARTING',
  SCAN_QR_CODE = 'SCAN_QR_CODE',
  PASSKEY_REQUIRED = 'PASSKEY_REQUIRED',
  PASSKEY_CONFIRMATION_REQUIRED = 'PASSKEY_CONFIRMATION_REQUIRED',
  WORKING = 'WORKING',
  FAILED = 'FAILED',
  UNKNOWN = 'UNKNOWN',
}

/** Rótulos em PT-BR para exibição no painel. */
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

export const GATEWAY_VERSION = '0.1.0';
