import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, Plus, RotateCw, Send, Trash2, Webhook } from 'lucide-react';
import { useState } from 'react';

import { GATEWAY_EVENT_LABELS, GATEWAY_EVENTS } from '@gateway/shared';

import { DialogoSegredoUnico } from '@/components/segredo-unico';
import {
  Badge,
  Botao,
  Campo,
  Cartao,
  Dialogo,
  Esqueleto,
  EstadoVazio,
  Seletor,
  useAvisos,
} from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { TOM_ENTREGA } from '@/lib/status';
import { cn, dataCompleta, tempoRelativo } from '@/lib/utils';

import type { Aplicacao, Endpoint, EndpointCriado, Entrega } from '@/lib/tipos';

type EndpointComApp = Endpoint & { application: { id: string; name: string; slug: string } };

export function WebhooksPagina() {
  const [criando, setCriando] = useState(false);
  const [segredo, setSegredo] = useState<EndpointCriado | null>(null);

  const { data: endpoints, isLoading } = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => api<EndpointComApp[]>('/admin/webhook-endpoints'),
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Webhooks</h1>
          <p className="mt-0.5 text-sm text-[var(--texto-suave)]">
            Endpoints que recebem os eventos das sessões de cada aplicação
          </p>
        </div>

        <Botao onClick={() => setCriando(true)}>
          <Plus className="h-4 w-4" />
          Novo endpoint
        </Botao>
      </div>

      {isLoading ? (
        <Esqueleto className="h-24" />
      ) : !endpoints?.length ? (
        <Cartao>
          <EstadoVazio
            icone={<Webhook className="h-9 w-9" />}
            titulo="Nenhum endpoint cadastrado"
            descricao="Sem webhooks, os sistemas integrados precisam consultar a API para saber de mensagens novas."
            acao={
              <Botao onClick={() => setCriando(true)}>
                <Plus className="h-4 w-4" />
                Novo endpoint
              </Botao>
            }
          />
        </Cartao>
      ) : (
        <div className="flex flex-col gap-2">
          {endpoints.map((endpoint) => (
            <CartaoDeEndpoint key={endpoint.id} endpoint={endpoint} aoRotacionar={setSegredo} />
          ))}
        </div>
      )}

      <DialogoCriar aberto={criando} aoFechar={() => setCriando(false)} aoCriar={setSegredo} />

      {segredo && (
        <DialogoSegredoUnico
          aberto
          aoFechar={() => setSegredo(null)}
          titulo="Segredo do endpoint"
          segredo={segredo.secret}
          aviso={segredo.warning}
          instrucao="Use-o para verificar o header X-Gateway-Signature. O exemplo de verificação em Node, PHP e Python está em docs/integracao.md."
        />
      )}
    </div>
  );
}

function CartaoDeEndpoint({
  endpoint,
  aoRotacionar,
}: {
  endpoint: EndpointComApp;
  aoRotacionar: (novo: EndpointCriado) => void;
}) {
  const [expandido, setExpandido] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const queryClient = useQueryClient();
  const { mostrar } = useAvisos();

  const testar = useMutation({
    mutationFn: () =>
      api<{ deliveryId: string }>(`/admin/webhook-endpoints/${endpoint.id}/test`, {
        method: 'POST',
      }),
    onSuccess: () => {
      mostrar({
        tom: 'sucesso',
        titulo: 'Evento de teste enviado',
        detalhe: 'Veja o resultado no histórico de entregas abaixo.',
      });
      setExpandido(true);
      setTimeout(
        () => void queryClient.invalidateQueries({ queryKey: ['webhooks', endpoint.id] }),
        1500,
      );
    },
  });

  const reativar = useMutation({
    mutationFn: () =>
      api(`/admin/webhook-endpoints/${endpoint.id}`, {
        method: 'PATCH',
        body: { active: true },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      mostrar({ tom: 'sucesso', titulo: 'Endpoint reativado' });
    },
  });

  const rotacionar = useMutation({
    mutationFn: () =>
      api<EndpointCriado>(`/admin/webhook-endpoints/${endpoint.id}/rotate-secret`, {
        method: 'POST',
      }),
    onSuccess: aoRotacionar,
  });

  const excluir = useMutation({
    mutationFn: () => api(`/admin/webhook-endpoints/${endpoint.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      mostrar({ tom: 'sucesso', titulo: 'Endpoint removido' });
      setExcluindo(false);
    },
  });

  return (
    <Cartao className={cn('overflow-hidden', !endpoint.active && 'border-[var(--erro)]')}>
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <code className="truncate font-mono text-sm">{endpoint.url}</code>
            {!endpoint.active && <Badge tom="erro">Desativado</Badge>}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--texto-suave)]">
            <span>{endpoint.application.name}</span>
            <span>
              {endpoint.events.includes('*')
                ? 'todos os eventos'
                : `${endpoint.events.length} evento(s)`}
            </span>
            {endpoint.consecutiveFailures > 0 && (
              <span className="text-[var(--alerta)]">
                {endpoint.consecutiveFailures} falha(s) seguida(s)
              </span>
            )}
          </div>

          {endpoint.disabledReason && (
            <div className="mt-2 flex items-start gap-2 rounded-[var(--raio)] bg-[var(--erro-suave)] p-2.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--erro)]" />
              <p className="text-xs text-[var(--erro)]">{endpoint.disabledReason}</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {!endpoint.active && (
            <Botao tamanho="sm" onClick={() => reativar.mutate()} carregando={reativar.isPending}>
              Reativar
            </Botao>
          )}
          <Botao
            tamanho="sm"
            variante="secundario"
            onClick={() => testar.mutate()}
            carregando={testar.isPending}
          >
            <Send className="h-3.5 w-3.5" />
            Testar
          </Botao>
          <Botao
            tamanho="sm"
            variante="fantasma"
            onClick={() => rotacionar.mutate()}
            title="Gerar um segredo novo (o atual deixa de valer)"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </Botao>
          <Botao tamanho="sm" variante="fantasma" onClick={() => setExcluindo(true)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Botao>
        </div>
      </div>

      <button
        onClick={() => setExpandido((v) => !v)}
        className="flex w-full items-center gap-1.5 border-t px-4 py-2 text-xs text-[var(--texto-suave)] hover:bg-[var(--superficie-2)]"
      >
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform', expandido && 'rotate-180')}
        />
        Histórico de entregas
      </button>

      {expandido && <Entregas endpointId={endpoint.id} />}

      <Dialogo
        aberto={excluindo}
        aoFechar={() => setExcluindo(false)}
        titulo="Remover o endpoint?"
        rodape={
          <>
            <Botao variante="secundario" onClick={() => setExcluindo(false)}>
              Cancelar
            </Botao>
            <Botao
              variante="perigo"
              carregando={excluir.isPending}
              onClick={() => excluir.mutate()}
            >
              Remover
            </Botao>
          </>
        }
      >
        <p className="text-sm text-[var(--texto-suave)]">
          O sistema em <code className="font-mono">{endpoint.url}</code> deixará de receber eventos.
          O histórico de entregas também será apagado.
        </p>
      </Dialogo>
    </Cartao>
  );
}

function Entregas({ endpointId }: { endpointId: string }) {
  const [selecionada, setSelecionada] = useState<Entrega | null>(null);
  const queryClient = useQueryClient();
  const { mostrar } = useAvisos();

  const { data: entregas, isLoading } = useQuery({
    queryKey: ['webhooks', endpointId],
    queryFn: () => api<Entrega[]>(`/admin/webhook-endpoints/${endpointId}/deliveries?limit=25`),
    refetchInterval: 10_000,
  });

  const reenviar = useMutation({
    mutationFn: (id: string) =>
      api(`/admin/webhook-endpoints/deliveries/${id}/retry`, { method: 'POST' }),
    onSuccess: () => {
      mostrar({ tom: 'sucesso', titulo: 'Reenvio enfileirado' });
      setTimeout(
        () => void queryClient.invalidateQueries({ queryKey: ['webhooks', endpointId] }),
        1500,
      );
      setSelecionada(null);
    },
  });

  if (isLoading) return <Esqueleto className="mx-4 mb-4 h-20" />;

  if (!entregas?.length) {
    return (
      <p className="px-4 pb-4 text-xs text-[var(--texto-fraco)]">
        Nenhuma entrega ainda. Use “Testar” para enviar um evento de verificação.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto border-t">
        <table className="w-full min-w-[560px] text-xs">
          <thead>
            <tr className="border-b text-left text-[var(--texto-suave)]">
              <th className="px-4 py-2 font-medium">Evento</th>
              <th className="px-4 py-2 font-medium">Situação</th>
              <th className="px-4 py-2 font-medium">Tentativas</th>
              <th className="px-4 py-2 font-medium">HTTP</th>
              <th className="px-4 py-2 font-medium">Duração</th>
              <th className="px-4 py-2 font-medium">Quando</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {entregas.map((entrega) => (
              <tr
                key={entrega.id}
                onClick={() => setSelecionada(entrega)}
                className="cursor-pointer hover:bg-[var(--superficie-2)]"
              >
                <td className="px-4 py-2 font-mono">{entrega.eventType}</td>
                <td className="px-4 py-2">
                  <Badge tom={TOM_ENTREGA[entrega.status] ?? 'neutro'}>{entrega.status}</Badge>
                </td>
                <td className="px-4 py-2 tabular-nums">{entrega.attempts}</td>
                <td className="px-4 py-2 tabular-nums">{entrega.responseStatus ?? '—'}</td>
                <td className="px-4 py-2 tabular-nums">
                  {entrega.durationMs !== null ? `${entrega.durationMs}ms` : '—'}
                </td>
                <td
                  className="px-4 py-2 text-[var(--texto-suave)]"
                  title={dataCompleta(entrega.createdAt)}
                >
                  {tempoRelativo(entrega.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialogo
        aberto={selecionada !== null}
        aoFechar={() => setSelecionada(null)}
        titulo="Detalhe da entrega"
        largura="max-w-2xl"
        rodape={
          <>
            <Botao variante="secundario" onClick={() => setSelecionada(null)}>
              Fechar
            </Botao>
            {selecionada && selecionada.status !== 'SUCCESS' && (
              <Botao
                carregando={reenviar.isPending}
                onClick={() => reenviar.mutate(selecionada.id)}
              >
                Reenviar
              </Botao>
            )}
          </>
        }
      >
        {selecionada && (
          <div className="flex flex-col gap-3 text-sm">
            <Par rotulo="Evento" valor={selecionada.eventType} />
            <Par rotulo="Situação" valor={selecionada.status} />
            <Par rotulo="Tentativas" valor={String(selecionada.attempts)} />
            <Par rotulo="Resposta HTTP" valor={selecionada.responseStatus?.toString() ?? '—'} />
            {selecionada.nextRetryAt && (
              <Par rotulo="Próxima tentativa" valor={dataCompleta(selecionada.nextRetryAt)} />
            )}

            {selecionada.error && (
              <div>
                <p className="mb-1 text-xs text-[var(--texto-suave)]">Erro</p>
                <pre className="overflow-x-auto rounded-[var(--raio)] bg-[var(--erro-suave)] p-2.5 text-xs text-[var(--erro)]">
                  {selecionada.error}
                </pre>
              </div>
            )}

            {selecionada.responseBody && (
              <div>
                <p className="mb-1 text-xs text-[var(--texto-suave)]">Resposta recebida</p>
                <pre className="max-h-40 overflow-auto rounded-[var(--raio)] bg-[var(--superficie-2)] p-2.5 text-xs">
                  {selecionada.responseBody}
                </pre>
              </div>
            )}
          </div>
        )}
      </Dialogo>
    </>
  );
}

function Par({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-[var(--texto-suave)]">{rotulo}</span>
      <span className="font-mono text-xs">{valor}</span>
    </div>
  );
}

function DialogoCriar({
  aberto,
  aoFechar,
  aoCriar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoCriar: (endpoint: EndpointCriado) => void;
}) {
  const [aplicacaoId, setAplicacaoId] = useState('');
  const [url, setUrl] = useState('');
  const [descricao, setDescricao] = useState('');
  const [eventos, setEventos] = useState<string[]>(['*']);
  const [erro, setErro] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: aplicacoes } = useQuery({
    queryKey: ['aplicacoes'],
    queryFn: () => api<Aplicacao[]>('/admin/applications'),
    enabled: aberto,
  });

  const criar = useMutation({
    mutationFn: () =>
      api<EndpointCriado>('/admin/webhook-endpoints', {
        method: 'POST',
        body: {
          applicationId: aplicacaoId,
          url,
          events: eventos,
          description: descricao || undefined,
        },
      }),
    onSuccess: (endpoint) => {
      void queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      setUrl('');
      setDescricao('');
      setErro(null);
      aoFechar();
      aoCriar(endpoint);
    },
    onError: (e) => setErro(e instanceof ApiError ? e.message : 'Não foi possível cadastrar.'),
  });

  const todosEventos = eventos.includes('*');

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Novo endpoint de webhook"
      descricao="O sistema receberá os eventos das sessões desta aplicação."
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            onClick={() => criar.mutate()}
            carregando={criar.isPending}
            disabled={!aplicacaoId || !url}
          >
            Cadastrar
          </Botao>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Seletor
          rotulo="Aplicação"
          value={aplicacaoId}
          onChange={(e) => setAplicacaoId(e.target.value)}
        >
          <option value="">Selecione…</option>
          {aplicacoes
            ?.filter((a) => a.active)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </Seletor>

        <Campo
          rotulo="URL"
          placeholder="https://seu-sistema.com/webhooks/whatsapp"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          dica="Deve responder 2xx rapidamente. Processe de forma assíncrona do seu lado."
          erro={erro ?? undefined}
        />

        <Campo
          rotulo="Descrição (opcional)"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
        />

        <div>
          <p className="mb-2 text-sm font-medium">Eventos</p>

          <label className="mb-1.5 flex cursor-pointer items-center gap-2.5 rounded-md p-1.5 hover:bg-[var(--superficie-2)]">
            <input
              type="checkbox"
              checked={todosEventos}
              onChange={(e) => setEventos(e.target.checked ? ['*'] : [])}
              className="h-4 w-4 accent-[var(--primaria)]"
            />
            <span className="text-sm">Todos os eventos</span>
          </label>

          {!todosEventos && (
            <div className="flex flex-col gap-1 pl-2">
              {GATEWAY_EVENTS.filter((e) => e !== 'ping').map((evento) => (
                <label
                  key={evento}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md p-1.5 hover:bg-[var(--superficie-2)]"
                >
                  <input
                    type="checkbox"
                    checked={eventos.includes(evento)}
                    onChange={(e) =>
                      setEventos((atuais) =>
                        e.target.checked ? [...atuais, evento] : atuais.filter((x) => x !== evento),
                      )
                    }
                    className="h-4 w-4 accent-[var(--primaria)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm">{GATEWAY_EVENT_LABELS[evento]}</span>
                    <code className="font-mono text-xs text-[var(--texto-fraco)]">{evento}</code>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </Dialogo>
  );
}
