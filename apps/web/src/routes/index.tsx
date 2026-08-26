import { EstadoVazio } from '@/components/ui';
import { AplicacoesPagina } from '@/routes/aplicacoes';
import { AuditoriaPagina } from '@/routes/auditoria';
import { MensagensPagina } from '@/routes/mensagens';
import { DetalheDaSessao } from '@/routes/sessoes/detalhe';
import { ListaDeSessoes } from '@/routes/sessoes/lista';
import { VisaoGeralPagina } from '@/routes/visao-geral';
import { WebhooksPagina } from '@/routes/webhooks';

export function Rotas({ rota, navegar }: { rota: string; navegar: (para: string) => void }) {
  // Os filtros de algumas telas vivem na query do hash; a rota é a parte antes
  // do "?".
  const caminho = rota.split('?')[0] ?? '/';

  if (caminho === '/') return <VisaoGeralPagina navegar={navegar} />;

  if (caminho === '/sessoes') return <ListaDeSessoes navegar={navegar} />;

  const sessao = /^\/sessoes\/([^/]+)$/.exec(caminho);
  if (sessao) return <DetalheDaSessao sessaoId={sessao[1]!} navegar={navegar} />;

  if (caminho === '/mensagens') return <MensagensPagina />;

  if (caminho === '/aplicacoes') return <AplicacoesPagina navegar={navegar} />;

  const aplicacao = /^\/aplicacoes\/([^/]+)$/.exec(caminho);
  if (aplicacao) return <AplicacoesPagina aplicacaoId={aplicacao[1]!} navegar={navegar} />;

  if (caminho === '/webhooks') return <WebhooksPagina />;

  if (caminho === '/auditoria') return <AuditoriaPagina navegar={navegar} />;

  return (
    <EstadoVazio
      titulo="Página não encontrada"
      descricao={`A rota "${caminho}" não existe neste painel.`}
    />
  );
}
