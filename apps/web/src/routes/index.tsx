import { EstadoVazio } from '@/components/ui';

/**
 * Roteador do painel.
 *
 * As telas concretas chegam nas tarefas 17 a 19; aqui fica o esqueleto e o
 * tratamento de rota desconhecida.
 */
export function Rotas({ rota }: { rota: string; navegar: (para: string) => void }) {
  if (rota === '/') return <EmConstrucao titulo="Visão geral" tarefa={18} />;
  if (rota.startsWith('/sessoes')) return <EmConstrucao titulo="Números" tarefa={17} />;
  if (rota.startsWith('/mensagens')) return <EmConstrucao titulo="Mensagens" tarefa={18} />;
  if (rota.startsWith('/aplicacoes')) return <EmConstrucao titulo="Aplicações" tarefa={19} />;
  if (rota.startsWith('/webhooks')) return <EmConstrucao titulo="Webhooks" tarefa={19} />;
  if (rota.startsWith('/auditoria')) return <EmConstrucao titulo="Auditoria" tarefa={19} />;

  return (
    <EstadoVazio
      titulo="Página não encontrada"
      descricao={`A rota "${rota}" não existe neste painel.`}
    />
  );
}

function EmConstrucao({ titulo, tarefa }: { titulo: string; tarefa: number }) {
  return (
    <EstadoVazio titulo={titulo} descricao={`Esta tela é implementada na tarefa ${tarefa}.`} />
  );
}
