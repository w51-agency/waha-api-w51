import { EstadoVazio } from '@/components/ui';
import { DetalheDaSessao } from '@/routes/sessoes/detalhe';
import { ListaDeSessoes } from '@/routes/sessoes/lista';

export function Rotas({ rota, navegar }: { rota: string; navegar: (para: string) => void }) {
  if (rota === '/') return <EmConstrucao titulo="Visão geral" tarefa={18} />;

  if (rota === '/sessoes') return <ListaDeSessoes navegar={navegar} />;

  const detalhe = /^\/sessoes\/([^/]+)$/.exec(rota);
  if (detalhe) return <DetalheDaSessao sessaoId={detalhe[1]!} navegar={navegar} />;

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
