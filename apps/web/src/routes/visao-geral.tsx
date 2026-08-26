import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, MessageSquare, Smartphone, Webhook } from 'lucide-react';
import { useState } from 'react';

import { BarrasHorizontais, FunilDeEntrega, GraficoTemporal } from '@/components/graficos';
import { Badge, Cartao, Esqueleto, Seletor } from '@/components/ui';
import { api } from '@/lib/api';
import { numero, percentual, tempoRelativo } from '@/lib/utils';

import type { MetricaAplicacao, SerieMensagens, VisaoGeral } from '@/lib/tipos';

type Periodo = '24h' | '7d' | '30d';

const PERIODOS: Record<Periodo, { rotulo: string; dias: number; granularidade: 'hour' | 'day' }> = {
  '24h': { rotulo: 'Últimas 24 horas', dias: 1, granularidade: 'hour' },
  '7d': { rotulo: 'Últimos 7 dias', dias: 7, granularidade: 'day' },
  '30d': { rotulo: 'Últimos 30 dias', dias: 30, granularidade: 'day' },
};

export function VisaoGeralPagina({ navegar }: { navegar: (para: string) => void }) {
  const [periodo, setPeriodo] = useState<Periodo>('7d');
  const config = PERIODOS[periodo];

  const { data: geral, isLoading } = useQuery({
    queryKey: ['metricas', 'overview'],
    queryFn: () => api<VisaoGeral>('/admin/metrics/overview'),
    refetchInterval: 30_000,
  });

  const { data: serie } = useQuery({
    queryKey: ['metricas', 'series', periodo],
    queryFn: () => {
      const de = new Date(Date.now() - config.dias * 86_400_000).toISOString();
      return api<SerieMensagens>(
        `/admin/metrics/messages?granularity=${config.granularidade}&from=${de}`,
      );
    },
  });

  const { data: aplicacoes } = useQuery({
    queryKey: ['metricas', 'aplicacoes'],
    queryFn: () => api<MetricaAplicacao[]>('/admin/metrics/applications'),
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Visão geral</h1>
          <p className="mt-0.5 text-sm text-[var(--texto-suave)]">
            Estado do gateway e volume de mensagens
          </p>
        </div>

        <Seletor value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
          {Object.entries(PERIODOS).map(([chave, { rotulo }]) => (
            <option key={chave} value={chave}>
              {rotulo}
            </option>
          ))}
        </Seletor>
      </div>

      {geral && <Alertas geral={geral} navegar={navegar} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading || !geral ? (
          [0, 1, 2, 3].map((i) => <Esqueleto key={i} className="h-[102px]" />)
        ) : (
          <>
            {/* Números conectados é o indicador que o operador olha primeiro. */}
            <Indicador
              icone={<Smartphone className="h-4 w-4" />}
              rotulo="Números conectados"
              valor={numero(geral.sessions.connected)}
              detalhe={`de ${numero(geral.sessions.total)} ${geral.sessions.total === 1 ? 'sessão' : 'sessões'}`}
              aoClicar={() => navegar('/sessoes')}
            />
            <Indicador
              icone={<MessageSquare className="h-4 w-4" />}
              rotulo="Mensagens hoje"
              valor={numero(geral.messages.today)}
              detalhe={`${numero(geral.messages.last7Days)} nos últimos 7 dias`}
              aoClicar={() => navegar('/mensagens')}
            />
            <Indicador
              rotulo="Taxa de entrega"
              valor={percentual(geral.delivery.rate)}
              // `null` quando não houve envios: mostrar 0% sugeriria que tudo
              // falhou, e 100% seria igualmente enganoso.
              detalhe={
                geral.delivery.rate === null
                  ? 'sem envios no período'
                  : `${numero(geral.delivery.delivered)} de ${numero(geral.delivery.sent)} enviadas`
              }
            />
            <Indicador
              rotulo="Aplicações ativas"
              valor={numero(geral.applications.active)}
              detalhe="sistemas integrados"
              aoClicar={() => navegar('/aplicacoes')}
            />
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Cartao className="p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-medium">Volume de mensagens</h2>
          {serie ? (
            <GraficoTemporal dados={serie.series} granularidade={serie.granularity} />
          ) : (
            <Esqueleto className="h-56" />
          )}
        </Cartao>

        <Cartao className="p-5">
          <h2 className="mb-1 text-sm font-medium">Entrega</h2>
          <p className="mb-4 text-xs text-[var(--texto-fraco)]">
            Mensagens enviadas nos últimos 30 dias
          </p>
          {geral ? (
            <FunilDeEntrega
              enviadas={geral.delivery.sent}
              entregues={geral.delivery.delivered}
              lidas={0}
              falhas={geral.delivery.failed}
            />
          ) : (
            <Esqueleto className="h-40" />
          )}
        </Cartao>
      </div>

      <Cartao className="p-5">
        <h2 className="mb-1 text-sm font-medium">Volume por aplicação</h2>
        <p className="mb-4 text-xs text-[var(--texto-fraco)]">Últimos 30 dias</p>

        {aplicacoes ? (
          <BarrasHorizontais
            itens={aplicacoes.map((a) => ({
              id: a.id,
              rotulo: a.name,
              valor: a.messagesLast30Days,
              detalhe: a.lastActivityAt ? tempoRelativo(a.lastActivityAt) : 'sem atividade',
            }))}
            aoClicar={() => navegar('/aplicacoes')}
          />
        ) : (
          <Esqueleto className="h-32" />
        )}
      </Cartao>
    </div>
  );
}

/**
 * Alertas acionáveis.
 *
 * Só aparecem quando há algo a fazer. Um painel que exibe "0 problemas" o tempo
 * todo treina o olho a ignorar aquela área justamente quando ela passa a
 * importar.
 */
function Alertas({ geral, navegar }: { geral: VisaoGeral; navegar: (para: string) => void }) {
  const alertas: Array<{ texto: string; para: string }> = [];

  if (geral.alerts.failedSessions > 0) {
    alertas.push({
      texto: `${geral.alerts.failedSessions} ${geral.alerts.failedSessions === 1 ? 'número precisa' : 'números precisam'} de atenção`,
      para: '/sessoes',
    });
  }

  if (geral.alerts.disabledWebhookEndpoints > 0) {
    alertas.push({
      texto: `${geral.alerts.disabledWebhookEndpoints} endpoint(s) de webhook desativado(s) por falhas`,
      para: '/webhooks',
    });
  }

  if (geral.sessions.awaitingQr > 0) {
    alertas.push({
      texto: `${geral.sessions.awaitingQr} ${geral.sessions.awaitingQr === 1 ? 'sessão aguardando' : 'sessões aguardando'} leitura de QR code`,
      para: '/sessoes',
    });
  }

  if (alertas.length === 0) return null;

  return (
    <Cartao className="flex flex-col gap-2 border-[var(--alerta)] p-4">
      {alertas.map((alerta) => (
        <button
          key={alerta.texto}
          onClick={() => navegar(alerta.para)}
          className="flex items-center gap-2.5 text-left text-sm hover:underline"
        >
          {alerta.para === '/webhooks' ? (
            <Webhook className="h-4 w-4 shrink-0 text-[var(--alerta)]" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--alerta)]" />
          )}
          {alerta.texto}
        </button>
      ))}
    </Cartao>
  );
}

function Indicador({
  icone,
  rotulo,
  valor,
  detalhe,
  aoClicar,
}: {
  icone?: React.ReactNode;
  rotulo: string;
  valor: string;
  detalhe?: string;
  aoClicar?: () => void;
}) {
  const conteudo = (
    <>
      <div className="flex items-center gap-2 text-xs text-[var(--texto-suave)]">
        {icone}
        {rotulo}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-[var(--texto-fraco)]">{detalhe}</p>}
    </>
  );

  if (aoClicar) {
    return (
      <Cartao className="p-4 text-left transition-colors hover:border-[var(--texto-fraco)]">
        <button onClick={aoClicar} className="w-full text-left">
          {conteudo}
        </button>
      </Cartao>
    );
  }

  return <Cartao className="p-4">{conteudo}</Cartao>;
}

export { Badge };
