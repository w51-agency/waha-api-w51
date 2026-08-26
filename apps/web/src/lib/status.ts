import { MessageStatus, SessionStatus } from '@gateway/shared';

/**
 * Aparência dos estados no painel.
 *
 * Centralizado para que um status apareça igual em toda tela — e para que
 * acrescentar um novo seja uma linha, não uma caçada por `switch` espalhados.
 */

export type Tom = 'sucesso' | 'alerta' | 'erro' | 'neutro' | 'info';

export const TOM_CLASSES: Record<Tom, string> = {
  sucesso: 'bg-[var(--sucesso-suave)] text-[var(--sucesso)]',
  alerta: 'bg-[var(--alerta-suave)] text-[var(--alerta)]',
  erro: 'bg-[var(--erro-suave)] text-[var(--erro)]',
  neutro: 'bg-[var(--neutro-suave)] text-[var(--texto-suave)]',
  info: 'bg-[var(--primaria-suave)] text-[var(--primaria)]',
};

export const TOM_PONTO: Record<Tom, string> = {
  sucesso: 'bg-[var(--sucesso)]',
  alerta: 'bg-[var(--alerta)]',
  erro: 'bg-[var(--erro)]',
  neutro: 'bg-[var(--neutro)]',
  info: 'bg-[var(--primaria)]',
};

export const TOM_SESSAO: Record<string, Tom> = {
  [SessionStatus.WORKING]: 'sucesso',
  [SessionStatus.SCAN_QR_CODE]: 'alerta',
  [SessionStatus.STARTING]: 'info',
  [SessionStatus.PASSKEY_REQUIRED]: 'alerta',
  [SessionStatus.PASSKEY_CONFIRMATION_REQUIRED]: 'alerta',
  [SessionStatus.STOPPED]: 'neutro',
  [SessionStatus.FAILED]: 'erro',
  [SessionStatus.UNKNOWN]: 'neutro',
};

export const TOM_MENSAGEM: Record<string, Tom> = {
  [MessageStatus.READ]: 'sucesso',
  [MessageStatus.DELIVERED]: 'info',
  [MessageStatus.SENT]: 'neutro',
  [MessageStatus.QUEUED]: 'alerta',
  [MessageStatus.FAILED]: 'erro',
};

export const TOM_ENTREGA: Record<string, Tom> = {
  SUCCESS: 'sucesso',
  PENDING: 'alerta',
  RETRYING: 'alerta',
  FAILED: 'erro',
  ABANDONED: 'erro',
};

/** Rótulo em PT-BR dos tipos de mensagem. */
export const TIPO_MENSAGEM: Record<string, string> = {
  text: 'Texto',
  image: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  voice: 'Áudio',
  document: 'Documento',
  location: 'Localização',
  contact: 'Contato',
  sticker: 'Figurinha',
  revoked: 'Apagada',
  media: 'Mídia',
};
