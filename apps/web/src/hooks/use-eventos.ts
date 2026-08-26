import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { sessao } from '@/lib/api';

export interface EventoAoVivo {
  type: string;
  applicationId?: string;
  sessionId?: string;
  data: Record<string, unknown>;
  at: string;
}

type Ouvinte = (evento: EventoAoVivo) => void;

/**
 * Conexão SSE com o gateway.
 *
 * Uma conexão só para o painel inteiro, compartilhada entre as telas: abrir uma
 * por componente multiplicaria conexões que o servidor precisa manter abertas.
 *
 * Reconecta com espera crescente. O `EventSource` reconecta sozinho em alguns
 * casos, mas não quando o token expira — e aí precisamos refazer a URL.
 */
export function useEventStream(): {
  conectado: boolean;
  inscrever: (ouvinte: Ouvinte) => () => void;
} {
  const [conectado, setConectado] = useState(false);
  const ouvintes = useRef(new Set<Ouvinte>());
  const fonte = useRef<EventSource | null>(null);
  const tentativas = useRef(0);
  const timer = useRef<number | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    let ativo = true;

    const conectar = () => {
      if (!ativo) return;

      const token = sessao.token;
      if (!token) {
        // Sem token ainda (a restauração de sessão pode estar em voo).
        timer.current = window.setTimeout(conectar, 1000);
        return;
      }

      fonte.current?.close();

      // O token vai na query string porque o EventSource não aceita headers —
      // limitação da especificação, não escolha nossa.
      const es = new EventSource(`/api/admin/events?token=${encodeURIComponent(token)}`);
      fonte.current = es;

      es.onopen = () => {
        if (!ativo) return;
        setConectado(true);
        tentativas.current = 0;
      };

      const tratar = (evento: MessageEvent<string>) => {
        try {
          const dados = JSON.parse(evento.data) as EventoAoVivo;
          ouvintes.current.forEach((ouvinte) => ouvinte(dados));
          invalidar(dados, queryClient);
        } catch {
          /* payload inesperado: ignorar em vez de derrubar o stream */
        }
      };

      for (const tipo of [
        'session.status',
        'session.connected',
        'session.disconnected',
        'message.received',
        'message.sent',
        'message.ack',
      ]) {
        es.addEventListener(tipo, tratar as EventListener);
      }

      es.onerror = () => {
        if (!ativo) return;
        setConectado(false);
        es.close();

        // Espera crescente com teto: reconectar em laço apertado contra um
        // servidor caído só piora a situação dele.
        const espera = Math.min(1000 * 2 ** tentativas.current, 30_000);
        tentativas.current++;
        timer.current = window.setTimeout(conectar, espera);
      };
    };

    conectar();

    return () => {
      ativo = false;
      if (timer.current) window.clearTimeout(timer.current);
      fonte.current?.close();
      setConectado(false);
    };
  }, [queryClient]);

  return {
    conectado,
    inscrever: (ouvinte: Ouvinte) => {
      ouvintes.current.add(ouvinte);
      return () => ouvintes.current.delete(ouvinte);
    },
  };
}

/**
 * Invalidação seletiva.
 *
 * Invalidar tudo a cada evento faria o painel refazer todas as consultas em uma
 * conversa movimentada. Cada tipo derruba só o que realmente mudou.
 */
function invalidar(evento: EventoAoVivo, queryClient: ReturnType<typeof useQueryClient>): void {
  const chaves: Record<string, string[][]> = {
    'session.status': [['sessoes'], ['metricas', 'overview']],
    'session.connected': [['sessoes'], ['metricas', 'overview']],
    'session.disconnected': [['sessoes'], ['metricas', 'overview']],
    'message.received': [['mensagens'], ['metricas', 'overview']],
    'message.sent': [['mensagens'], ['metricas', 'overview']],
    'message.ack': [['mensagens']],
  };

  for (const chave of chaves[evento.type] ?? []) {
    void queryClient.invalidateQueries({ queryKey: chave });
  }
}
