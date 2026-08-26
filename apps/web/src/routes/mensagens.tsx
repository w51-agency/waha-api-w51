import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Download, MessageSquare, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Direction, MESSAGE_STATUS_LABELS, MessageStatus } from '@gateway/shared';

import { Badge, Botao, Campo, Cartao, Esqueleto, EstadoVazio, Seletor } from '@/components/ui';
import { api, sessao as sessaoAtual } from '@/lib/api';
import { TIPO_MENSAGEM, TOM_MENSAGEM } from '@/lib/status';
import { cn, dataCompleta, formatarTelefone, numero, tempoRelativo } from '@/lib/utils';

import type { Aplicacao, Mensagem, PaginaMensagens, Sessao } from '@/lib/tipos';

interface Filtros {
  sessionId: string;
  applicationId: string;
  direction: string;
  status: string;
  search: string;
}

const VAZIOS: Filtros = {
  sessionId: '',
  applicationId: '',
  direction: '',
  status: '',
  search: '',
};

export function MensagensPagina() {
  const [filtros, setFiltros] = useState<Filtros>(() => lerDaUrl());
  const [buscaCrua, setBuscaCrua] = useState(filtros.search);
  const [selecionada, setSelecionada] = useState<Mensagem | null>(null);

  // Debounce na busca: sem isso, cada tecla dispara um LIKE no banco.
  useEffect(() => {
    const timer = setTimeout(() => setFiltros((f) => ({ ...f, search: buscaCrua })), 350);
    return () => clearTimeout(timer);
  }, [buscaCrua]);

  // Os filtros vivem na URL: o estado da tela fica compartilhável e sobrevive
  // ao recarregar, que é o que se espera de uma tela de investigação.
  useEffect(() => {
    escreverNaUrl(filtros);
  }, [filtros]);

  const { data: sessoes } = useQuery({
    queryKey: ['sessoes'],
    queryFn: () => api<Sessao[]>('/admin/sessions'),
  });

  const { data: aplicacoes } = useQuery({
    queryKey: ['aplicacoes'],
    queryFn: () => api<Aplicacao[]>('/admin/applications'),
  });

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['mensagens', filtros],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (pageParam) params.set('cursor', pageParam as string);
      for (const [chave, valor] of Object.entries(filtros)) {
        if (valor) params.set(chave, valor);
      }
      return api<PaginaMensagens>(`/admin/messages?${params}`);
    },
    getNextPageParam: (ultima) => ultima.nextCursor ?? undefined,
  });

  const mensagens = data?.pages.flatMap((p) => p.data) ?? [];
  const temFiltro = Object.values(filtros).some(Boolean);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Mensagens</h1>
          <p className="mt-0.5 text-sm text-[var(--texto-suave)]">
            {mensagens.length > 0
              ? `${numero(mensagens.length)} carregadas${hasNextPage ? ' — role para ver mais' : ''}`
              : 'Histórico de tudo que passou pelo gateway'}
          </p>
        </div>

        <Botao variante="secundario" onClick={() => baixarCsv(filtros)}>
          <Download className="h-4 w-4" />
          Exportar CSV
        </Botao>
      </div>

      <Cartao className="flex flex-wrap items-end gap-2 p-3">
        <Campo
          placeholder="Buscar no conteúdo…"
          value={buscaCrua}
          onChange={(e) => setBuscaCrua(e.target.value)}
          className="w-full sm:w-60"
        />

        <Seletor
          value={filtros.sessionId}
          onChange={(e) => setFiltros((f) => ({ ...f, sessionId: e.target.value }))}
        >
          <option value="">Todos os números</option>
          {sessoes?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label ?? formatarTelefone(s.phoneNumber)}
            </option>
          ))}
        </Seletor>

        <Seletor
          value={filtros.applicationId}
          onChange={(e) => setFiltros((f) => ({ ...f, applicationId: e.target.value }))}
        >
          <option value="">Todas as aplicações</option>
          {aplicacoes?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Seletor>

        <Seletor
          value={filtros.direction}
          onChange={(e) => setFiltros((f) => ({ ...f, direction: e.target.value }))}
        >
          <option value="">Entrada e saída</option>
          <option value={Direction.INBOUND}>Recebidas</option>
          <option value={Direction.OUTBOUND}>Enviadas</option>
        </Seletor>

        <Seletor
          value={filtros.status}
          onChange={(e) => setFiltros((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="">Todos os status</option>
          {Object.values(MessageStatus).map((s) => (
            <option key={s} value={s}>
              {MESSAGE_STATUS_LABELS[s]}
            </option>
          ))}
        </Seletor>

        {temFiltro && (
          <Botao
            variante="fantasma"
            tamanho="sm"
            onClick={() => {
              setFiltros(VAZIOS);
              setBuscaCrua('');
            }}
          >
            <X className="h-3.5 w-3.5" />
            Limpar
          </Botao>
        )}
      </Cartao>

      {isLoading ? (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Esqueleto key={i} className="h-14" />
          ))}
        </div>
      ) : mensagens.length === 0 ? (
        <Cartao>
          <EstadoVazio
            icone={<MessageSquare className="h-9 w-9" />}
            // A distinção importa: "sem resultado para o filtro" é diferente de
            // "não há mensagens", e sugere ações diferentes.
            titulo={temFiltro ? 'Nenhum resultado para estes filtros' : 'Nenhuma mensagem ainda'}
            descricao={
              temFiltro
                ? 'Ajuste ou limpe os filtros.'
                : 'As mensagens enviadas e recebidas aparecerão aqui.'
            }
          />
        </Cartao>
      ) : (
        <>
          <Cartao className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-[var(--texto-suave)]">
                    <th className="px-3 py-2.5 font-medium">Quando</th>
                    <th className="px-3 py-2.5 font-medium">Direção</th>
                    <th className="px-3 py-2.5 font-medium">Número</th>
                    <th className="px-3 py-2.5 font-medium">Conteúdo</th>
                    <th className="px-3 py-2.5 font-medium">Sessão</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {mensagens.map((mensagem) => (
                    <tr
                      key={mensagem.id}
                      onClick={() => setSelecionada(mensagem)}
                      className="cursor-pointer hover:bg-[var(--superficie-2)]"
                    >
                      <td
                        className="whitespace-nowrap px-3 py-2.5 text-xs text-[var(--texto-suave)]"
                        title={dataCompleta(mensagem.timestamp)}
                      >
                        {tempoRelativo(mensagem.timestamp)}
                      </td>
                      <td className="px-3 py-2.5">
                        <Direcao direcao={mensagem.direction} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">
                        {formatarTelefone(mensagem.phone)}
                      </td>
                      <td className="max-w-md px-3 py-2.5">
                        <span className="line-clamp-1">
                          {mensagem.body ?? (
                            <span className="text-[var(--texto-fraco)]">
                              [{TIPO_MENSAGEM[mensagem.type] ?? mensagem.type}]
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-[var(--texto-suave)]">
                        {mensagem.sessionLabel ?? '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tom={TOM_MENSAGEM[mensagem.status] ?? 'neutro'}>
                          {MESSAGE_STATUS_LABELS[mensagem.status] ?? mensagem.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Cartao>

          {hasNextPage && (
            <Botao
              variante="secundario"
              onClick={() => void fetchNextPage()}
              carregando={isFetchingNextPage}
              className="mx-auto"
            >
              Carregar mais
            </Botao>
          )}
        </>
      )}

      {selecionada && (
        <PainelDetalhe mensagem={selecionada} aoFechar={() => setSelecionada(null)} />
      )}
    </div>
  );
}

function Direcao({ direcao }: { direcao: Mensagem['direction'] }) {
  const entrada = direcao === Direction.INBOUND;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        entrada ? 'text-[var(--serie-1)]' : 'text-[var(--serie-2)]',
      )}
      title={entrada ? 'Recebida' : 'Enviada'}
    >
      {entrada ? (
        <ArrowDownLeft className="h-3.5 w-3.5" />
      ) : (
        <ArrowUpRight className="h-3.5 w-3.5" />
      )}
      <span className="hidden sm:inline">{entrada ? 'Recebida' : 'Enviada'}</span>
    </span>
  );
}

function PainelDetalhe({ mensagem, aoFechar }: { mensagem: Mensagem; aoFechar: () => void }) {
  const [aba, setAba] = useState<'detalhes' | 'json'>('detalhes');

  const { data: completa } = useQuery({
    queryKey: ['mensagens', mensagem.id, 'detalhe'],
    queryFn: () => api<Mensagem>(`/admin/messages/${mensagem.id}?includeRaw=true`),
  });

  const dados = completa ?? mensagem;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={aoFechar} />

      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l bg-[var(--superficie)] shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Detalhe da mensagem</h2>
          <button
            onClick={aoFechar}
            className="rounded-md p-1 text-[var(--texto-fraco)] hover:bg-[var(--superficie-2)]"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-1 border-b px-3 pt-2">
          {(['detalhes', 'json'] as const).map((chave) => (
            <button
              key={chave}
              onClick={() => setAba(chave)}
              className={cn(
                'rounded-t-md px-3 py-1.5 text-xs',
                aba === chave
                  ? 'border-b-2 border-[var(--primaria)] font-medium text-[var(--primaria)]'
                  : 'text-[var(--texto-suave)] hover:text-[var(--texto)]',
              )}
            >
              {chave === 'detalhes' ? 'Detalhes' : 'JSON cru'}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {aba === 'detalhes' ? (
            <dl className="flex flex-col gap-3.5 text-sm">
              {dados.body && (
                <div>
                  <dt className="mb-1 text-xs text-[var(--texto-suave)]">Conteúdo</dt>
                  <dd className="whitespace-pre-wrap rounded-[var(--raio)] bg-[var(--superficie-2)] p-3">
                    {dados.body}
                  </dd>
                </div>
              )}

              {dados.mediaUrl && (
                <div>
                  <dt className="mb-1 text-xs text-[var(--texto-suave)]">Mídia</dt>
                  <dd>
                    <Midia mensagem={dados} />
                  </dd>
                </div>
              )}

              <Linha
                rotulo="Direção"
                valor={dados.direction === 'INBOUND' ? 'Recebida' : 'Enviada'}
              />
              <Linha rotulo="Número" valor={formatarTelefone(dados.phone)} mono />
              <Linha rotulo="Conversa" valor={dados.chatId} mono />
              <Linha rotulo="Tipo" valor={TIPO_MENSAGEM[dados.type] ?? dados.type} />
              <Linha rotulo="Status" valor={MESSAGE_STATUS_LABELS[dados.status] ?? dados.status} />
              <Linha rotulo="Confirmação (ack)" valor={dados.ack?.toString() ?? '—'} />
              <Linha rotulo="Sessão" valor={dados.sessionLabel ?? dados.sessionId} />

              {/* Quem enviou é o rastreio que a auditoria promete. */}
              <Linha
                rotulo="Enviada pela chave"
                valor={dados.sentByApiKeyId ?? (dados.direction === 'OUTBOUND' ? 'painel' : '—')}
                mono
              />

              <Linha rotulo="Quando" valor={dataCompleta(dados.timestamp)} />
              <Linha rotulo="Id no WhatsApp" valor={dados.wahaId ?? '—'} mono />

              {dados.error && (
                <div>
                  <dt className="mb-1 text-xs text-[var(--texto-suave)]">Erro</dt>
                  <dd className="rounded-[var(--raio)] bg-[var(--erro-suave)] p-3 text-xs text-[var(--erro)]">
                    {dados.error}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <pre className="overflow-x-auto rounded-[var(--raio)] bg-[var(--superficie-2)] p-3 text-xs">
              {JSON.stringify(dados.raw ?? dados, null, 2)}
            </pre>
          )}
        </div>
      </aside>
    </>
  );
}

/**
 * Prévia de mídia.
 *
 * O campo `mediaUrl` da mensagem aponta para `/v1/media/{id}`, que exige API
 * key — o painel não tem uma. Usamos a rota administrativa equivalente, com o
 * token na query porque `<img src>` e `<audio src>` não enviam cabeçalhos.
 */
function Midia({ mensagem }: { mensagem: Mensagem }) {
  const tipo = mensagem.mediaMimeType ?? '';
  const url = `/api/admin/messages/${mensagem.id}/media?token=${encodeURIComponent(sessaoAtual.token ?? '')}`;

  if (tipo.startsWith('image/')) {
    return (
      <img
        src={url}
        alt="Mídia da mensagem"
        className="max-h-64 rounded-[var(--raio)] border object-contain"
      />
    );
  }

  if (tipo.startsWith('audio/')) {
    return <audio controls src={url} className="w-full" />;
  }

  if (tipo.startsWith('video/')) {
    return <video controls src={url} className="max-h-64 w-full rounded-[var(--raio)]" />;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-sm text-[var(--primaria)] hover:underline"
    >
      <Download className="h-3.5 w-3.5" />
      Baixar arquivo
    </a>
  );
}

function Linha({ rotulo, valor, mono }: { rotulo: string; valor: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-xs text-[var(--texto-suave)]">{rotulo}</dt>
      <dd className={cn('min-w-0 break-all text-right text-xs', mono && 'font-mono')}>{valor}</dd>
    </div>
  );
}

// =============================================================================
//  Filtros na URL
// =============================================================================

function lerDaUrl(): Filtros {
  const hash = window.location.hash.split('?')[1] ?? '';
  const params = new URLSearchParams(hash);

  return {
    sessionId: params.get('sessionId') ?? '',
    applicationId: params.get('applicationId') ?? '',
    direction: params.get('direction') ?? '',
    status: params.get('status') ?? '',
    search: params.get('search') ?? '',
  };
}

function escreverNaUrl(filtros: Filtros): void {
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(filtros)) {
    if (valor) params.set(chave, valor);
  }

  const base = window.location.hash.split('?')[0] ?? '#/mensagens';
  const novo = params.toString() ? `${base}?${params}` : base;

  if (window.location.hash !== novo) {
    window.history.replaceState(null, '', novo);
  }
}

function baixarCsv(filtros: Filtros): void {
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(filtros)) {
    if (valor) params.set(chave, valor);
  }
  params.set('token', sessaoAtual.token ?? '');

  window.open(`/api/admin/messages/export?${params}`, '_blank');
}
