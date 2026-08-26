import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...entradas: ClassValue[]): string {
  return twMerge(clsx(entradas));
}

/**
 * Formata um número de WhatsApp para leitura.
 *
 * Brasileiros ganham a máscara conhecida; os demais recebem só o `+` na frente,
 * porque inventar formatação para país desconhecido produz resultado pior que
 * não formatar.
 */
export function formatarTelefone(numero: string | null | undefined): string {
  if (!numero) return '—';

  const digitos = numero.replace(/\D/g, '');

  if (digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)) {
    const ddd = digitos.slice(2, 4);
    const resto = digitos.slice(4);
    const meio = resto.length === 9 ? resto.slice(0, 5) : resto.slice(0, 4);
    const fim = resto.length === 9 ? resto.slice(5) : resto.slice(4);
    return `+55 (${ddd}) ${meio}-${fim}`;
  }

  return `+${digitos}`;
}

/** Tempo relativo curto, em português. */
export function tempoRelativo(data: string | Date | null | undefined): string {
  if (!data) return '—';

  const alvo = typeof data === 'string' ? new Date(data) : data;
  const segundos = Math.floor((Date.now() - alvo.getTime()) / 1000);

  if (segundos < 0) return 'agora';
  if (segundos < 45) return 'agora';
  if (segundos < 90) return 'há 1 minuto';

  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `há ${minutos} minutos`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} ${horas === 1 ? 'hora' : 'horas'}`;

  const dias = Math.floor(horas / 24);
  if (dias < 30) return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;

  const meses = Math.floor(dias / 30);
  if (meses < 12) return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`;

  return `há ${Math.floor(meses / 12)} ano(s)`;
}

const formatadorData = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
});

export function dataCompleta(data: string | Date | null | undefined): string {
  if (!data) return '—';
  return formatadorData.format(typeof data === 'string' ? new Date(data) : data);
}

const formatadorNumero = new Intl.NumberFormat('pt-BR');

export function numero(valor: number | null | undefined): string {
  return valor === null || valor === undefined ? '—' : formatadorNumero.format(valor);
}

export function percentual(valor: number | null | undefined): string {
  return valor === null || valor === undefined ? '—' : `${valor.toFixed(1)}%`;
}

/** Copia para a área de transferência, com alternativa para contexto não seguro. */
export async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // navigator.clipboard exige contexto seguro (https ou localhost); em HTTP
    // numa rede local ele simplesmente não existe.
    try {
      const campo = document.createElement('textarea');
      campo.value = texto;
      campo.style.position = 'fixed';
      campo.style.opacity = '0';
      document.body.appendChild(campo);
      campo.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(campo);
      return ok;
    } catch {
      return false;
    }
  }
}
