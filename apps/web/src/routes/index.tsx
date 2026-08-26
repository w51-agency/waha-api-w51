import { EstadoVazio } from '@/components/ui';
import { MensagensPagina } from '@/routes/mensagens';
import { DetalheDaSessao } from '@/routes/sessoes/detalhe';
import { ListaDeSessoes } from '@/routes/sessoes/lista';
import { VisaoGeralPagina } from '@/routes/visao-geral';

export function Rotas({ rota, navegar }: { rota: string; navegar: (para: string) => void }) {
  // Os filtros da tela de mensagens vivem na query do hash; a rota é a parte
  // antes do "?".
  const caminho = rota.split('?')[0] ?? '/';

  if (caminho === '/') return <VisaoGeralPagina navegar={navegar} />;

  if (caminho === '/sessoes') return <ListaDeSessoes navegar={navegar} />;

  const detalhe = /^\/sessoes\/([^/]+)$/.exec(caminho);
  if (detalhe) return <DetalheDaSessao sessaoId={detalhe[1]!} navegar={navegar} />;

  if (caminho === '/mensagens') return <MensagensPagina />;

  if (caminho.startsWith('/aplicacoes')) return <EmConstrucao titulo="Aplicações" tarefa={19} />;
  if (caminho.startsWith('/webhooks')) return <EmConstrucao titulo="Webhooks" tarefa={19} />;
  if (caminho.startsWith('/auditoria')) return <EmConstrucao titulo="Auditoria" tarefa={19} />;

  return (
    <EstadoVazio
      titulo="Página não encontrada"
      descricao={`A rota "${caminho}" não existe neste painel.`}
    />
  );
}

function EmConstrucao({ titulo, tarefa }: { titulo: string; tarefa: number }) {
  return (
    <EstadoVazio titulo={titulo} descricao={`Esta tela é implementada na tarefa ${tarefa}.`} />
  );
}
