import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, Plus, RotateCw, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { API_SCOPES, API_SCOPE_LABELS, type ApiScope } from '@gateway/shared';

import { DialogoSegredoUnico } from '@/components/segredo-unico';
import {
  Badge,
  Botao,
  Campo,
  Cartao,
  Dialogo,
  Esqueleto,
  EstadoVazio,
  useAvisos,
} from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { dataCompleta, numero, tempoRelativo } from '@/lib/utils';

import type { Aplicacao, AplicacaoDetalhe, Chave, ChaveCriada } from '@/lib/tipos';

export function AplicacoesPagina({
  aplicacaoId,
  navegar,
}: {
  aplicacaoId?: string;
  navegar: (para: string) => void;
}) {
  if (aplicacaoId) return <DetalheDaAplicacao id={aplicacaoId} navegar={navegar} />;
  return <ListaDeAplicacoes navegar={navegar} />;
}

// =============================================================================
//  Lista
// =============================================================================

function ListaDeAplicacoes({ navegar }: { navegar: (para: string) => void }) {
  const [criando, setCriando] = useState(false);

  const { data: aplicacoes, isLoading } = useQuery({
    queryKey: ['aplicacoes'],
    queryFn: () => api<Aplicacao[]>('/admin/applications'),
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Aplicações</h1>
          <p className="mt-0.5 text-sm text-[var(--texto-suave)]">
            Os sistemas que consomem esta API. Cada um recebe as próprias chaves.
          </p>
        </div>

        <Botao onClick={() => setCriando(true)}>
          <Plus className="h-4 w-4" />
          Nova aplicação
        </Botao>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <Esqueleto key={i} className="h-20" />
          ))}
        </div>
      ) : !aplicacoes?.length ? (
        <Cartao>
          <EstadoVazio
            icone={<KeyRound className="h-9 w-9" />}
            titulo="Nenhuma aplicação cadastrada"
            descricao="Cadastre o primeiro sistema que vai consumir esta API. É a aplicação que identifica de quem é cada número conectado."
            acao={
              <Botao onClick={() => setCriando(true)}>
                <Plus className="h-4 w-4" />
                Nova aplicação
              </Botao>
            }
          />
        </Cartao>
      ) : (
        <div className="flex flex-col gap-2">
          {aplicacoes.map((aplicacao) => (
            <Cartao
              key={aplicacao.id}
              className="p-4 transition-colors hover:border-[var(--texto-fraco)]"
            >
              <button
                onClick={() => navegar(`/aplicacoes/${aplicacao.id}`)}
                className="flex w-full flex-wrap items-center justify-between gap-4 text-left"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{aplicacao.name}</span>
                    <code className="rounded bg-[var(--superficie-2)] px-1.5 py-0.5 font-mono text-xs text-[var(--texto-suave)]">
                      {aplicacao.slug}
                    </code>
                    {!aplicacao.active && <Badge tom="erro">Desativada</Badge>}
                  </div>
                  {aplicacao.description && (
                    <p className="mt-0.5 truncate text-sm text-[var(--texto-suave)]">
                      {aplicacao.description}
                    </p>
                  )}
                </div>

                {aplicacao.counts && (
                  <div className="flex gap-5 text-xs">
                    <Contagem
                      valor={aplicacao.counts.connectedSessions}
                      de={aplicacao.counts.sessions}
                      rotulo="números"
                    />
                    <Contagem valor={aplicacao.counts.activeApiKeys} rotulo="chaves" />
                    <Contagem valor={aplicacao.counts.messagesLast30Days} rotulo="msgs/30d" />
                  </div>
                )}
              </button>
            </Cartao>
          ))}
        </div>
      )}

      <DialogoCriarAplicacao
        aberto={criando}
        aoFechar={() => setCriando(false)}
        aoCriar={(id) => navegar(`/aplicacoes/${id}`)}
      />
    </div>
  );
}

function Contagem({ valor, de, rotulo }: { valor: number; de?: number; rotulo: string }) {
  return (
    <div className="text-right">
      <p className="font-medium tabular-nums">
        {numero(valor)}
        {de !== undefined && <span className="text-[var(--texto-fraco)]">/{numero(de)}</span>}
      </p>
      <p className="text-[var(--texto-fraco)]">{rotulo}</p>
    </div>
  );
}

// =============================================================================
//  Detalhe
// =============================================================================

function DetalheDaAplicacao({ id, navegar }: { id: string; navegar: (para: string) => void }) {
  const [emitindo, setEmitindo] = useState(false);
  const [segredo, setSegredo] = useState<ChaveCriada | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  const queryClient = useQueryClient();
  const { mostrar } = useAvisos();

  const { data: aplicacao, isLoading } = useQuery({
    queryKey: ['aplicacoes', id],
    queryFn: () => api<AplicacaoDetalhe>(`/admin/applications/${id}`),
  });

  const alternarAtiva = useMutation({
    mutationFn: (ativa: boolean) =>
      api(`/admin/applications/${id}`, { method: 'PATCH', body: { active: ativa } }),
    onSuccess: (_d, ativa) => {
      void queryClient.invalidateQueries({ queryKey: ['aplicacoes'] });
      mostrar({
        tom: ativa ? 'sucesso' : 'alerta',
        titulo: ativa ? 'Aplicação reativada' : 'Aplicação desativada',
        detalhe: ativa
          ? 'As chaves voltaram a funcionar.'
          : 'Todas as chaves desta aplicação pararam de funcionar imediatamente.',
      });
    },
  });

  if (isLoading) return <Esqueleto className="h-64" />;

  if (!aplicacao) {
    return (
      <EstadoVazio
        titulo="Aplicação não encontrada"
        acao={<Botao onClick={() => navegar('/aplicacoes')}>Voltar</Botao>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={() => navegar('/aplicacoes')}
        className="flex w-fit items-center gap-1.5 text-sm text-[var(--texto-suave)] hover:text-[var(--texto)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Aplicações
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{aplicacao.name}</h1>
            <code className="rounded bg-[var(--superficie-2)] px-1.5 py-0.5 font-mono text-xs text-[var(--texto-suave)]">
              {aplicacao.slug}
            </code>
            {!aplicacao.active && <Badge tom="erro">Desativada</Badge>}
          </div>
          {aplicacao.description && (
            <p className="mt-1 text-sm text-[var(--texto-suave)]">{aplicacao.description}</p>
          )}
        </div>

        <div className="flex gap-2">
          <Botao
            variante="secundario"
            onClick={() => alternarAtiva.mutate(!aplicacao.active)}
            carregando={alternarAtiva.isPending}
          >
            {aplicacao.active ? 'Desativar' : 'Reativar'}
          </Botao>
          <Botao variante="perigo" onClick={() => setExcluindo(true)}>
            <Trash2 className="h-4 w-4" />
            Excluir
          </Botao>
        </div>
      </div>

      {!aplicacao.active && (
        <Cartao className="border-[var(--erro)] p-4">
          <p className="text-sm">
            Esta aplicação está desativada. Todas as chaves dela são recusadas e as sessões não
            podem enviar mensagens.
          </p>
        </Cartao>
      )}

      <Cartao className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-medium">Chaves de API</h2>
            <p className="mt-0.5 text-xs text-[var(--texto-fraco)]">
              O segredo aparece uma única vez, na emissão.
            </p>
          </div>
          <Botao tamanho="sm" onClick={() => setEmitindo(true)}>
            <Plus className="h-3.5 w-3.5" />
            Emitir chave
          </Botao>
        </div>

        {aplicacao.apiKeys.length === 0 ? (
          <EstadoVazio
            titulo="Nenhuma chave emitida"
            descricao="Sem uma chave, este sistema não consegue se conectar à API."
          />
        ) : (
          <ul className="divide-y">
            {aplicacao.apiKeys.map((chave) => (
              <LinhaDeChave
                key={chave.id}
                chave={chave}
                aplicacaoId={id}
                aoRotacionar={setSegredo}
              />
            ))}
          </ul>
        )}
      </Cartao>

      <DialogoEmitirChave
        aplicacaoId={id}
        aberto={emitindo}
        aoFechar={() => setEmitindo(false)}
        aoEmitir={setSegredo}
      />

      {segredo && (
        <DialogoSegredoUnico
          aberto
          aoFechar={() => setSegredo(null)}
          titulo="Chave emitida"
          segredo={segredo.secret}
          aviso={segredo.warning}
          instrucao="Configure este valor no sistema integrador, no header X-API-Key."
        />
      )}

      <DialogoExcluir
        aplicacao={aplicacao}
        aberto={excluindo}
        aoFechar={() => setExcluindo(false)}
        aoExcluir={() => navegar('/aplicacoes')}
      />
    </div>
  );
}

function LinhaDeChave({
  chave,
  aplicacaoId,
  aoRotacionar,
}: {
  chave: Chave;
  aplicacaoId: string;
  aoRotacionar: (nova: ChaveCriada) => void;
}) {
  const [confirmando, setConfirmando] = useState<'revogar' | 'rotacionar' | null>(null);
  const [forcar, setForcar] = useState(false);
  const queryClient = useQueryClient();
  const { mostrar } = useAvisos();

  const revogar = useMutation({
    mutationFn: () =>
      api(`/admin/api-keys/${chave.id}${forcar ? '?force=true' : ''}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['aplicacoes', aplicacaoId] });
      mostrar({
        tom: 'sucesso',
        titulo: 'Chave revogada',
        detalhe: 'Sistemas usando esta chave param imediatamente.',
      });
      setConfirmando(null);
      setForcar(false);
    },
    onError: (erro) => {
      // A API recusa revogar a última chave ativa sem confirmação — o segundo
      // clique reenvia com force.
      if (erro instanceof ApiError && erro.problem.type.endsWith('/last-active-key')) {
        setForcar(true);
        mostrar({ tom: 'alerta', titulo: 'Atenção', detalhe: erro.message });
        return;
      }
      mostrar({ tom: 'erro', titulo: 'Não foi possível revogar', detalhe: String(erro) });
    },
  });

  const rotacionar = useMutation({
    mutationFn: () => api<ChaveCriada>(`/admin/api-keys/${chave.id}/rotate`, { method: 'POST' }),
    onSuccess: (nova) => {
      void queryClient.invalidateQueries({ queryKey: ['aplicacoes', aplicacaoId] });
      setConfirmando(null);
      aoRotacionar(nova);
    },
  });

  const nuncaUsada = chave.lastUsedAt === null;

  return (
    <li className="flex flex-wrap items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{chave.name}</span>
          {!chave.active && <Badge tom="neutro">{chave.revokedAt ? 'Revogada' : 'Expirada'}</Badge>}
          {chave.active && nuncaUsada && <Badge tom="alerta">Nunca usada</Badge>}
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--texto-suave)]">
          <code className="font-mono">{chave.prefix}…</code>
          <span title={chave.lastUsedAt ? dataCompleta(chave.lastUsedAt) : undefined}>
            {chave.lastUsedAt ? `usada ${tempoRelativo(chave.lastUsedAt)}` : 'nunca usada'}
          </span>
          {chave.scopes.length > 0 && <span>{chave.scopes.length} escopo(s)</span>}
        </div>
      </div>

      {chave.active && (
        <div className="flex gap-1.5">
          <Botao
            tamanho="sm"
            variante="secundario"
            onClick={() => setConfirmando('rotacionar')}
            title="Revogar esta e emitir uma nova com os mesmos escopos"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Rotacionar
          </Botao>
          <Botao tamanho="sm" variante="fantasma" onClick={() => setConfirmando('revogar')}>
            Revogar
          </Botao>
        </div>
      )}

      <Dialogo
        aberto={confirmando !== null}
        aoFechar={() => {
          setConfirmando(null);
          setForcar(false);
        }}
        titulo={confirmando === 'revogar' ? 'Revogar a chave?' : 'Rotacionar a chave?'}
        rodape={
          <>
            <Botao variante="secundario" onClick={() => setConfirmando(null)}>
              Cancelar
            </Botao>
            <Botao
              variante={confirmando === 'revogar' ? 'perigo' : 'primario'}
              carregando={revogar.isPending || rotacionar.isPending}
              onClick={() => (confirmando === 'revogar' ? revogar.mutate() : rotacionar.mutate())}
            >
              {confirmando === 'revogar'
                ? forcar
                  ? 'Revogar mesmo assim'
                  : 'Revogar'
                : 'Rotacionar'}
            </Botao>
          </>
        }
      >
        <p className="text-sm text-[var(--texto-suave)]">
          {confirmando === 'revogar' ? (
            <>
              Qualquer sistema usando <strong className="text-[var(--texto)]">{chave.name}</strong>{' '}
              deixará de conseguir se conectar{' '}
              <strong className="text-[var(--texto)]">imediatamente</strong>. Esta ação não pode ser
              desfeita — para restaurar o acesso, emita uma chave nova.
            </>
          ) : (
            <>
              A chave atual será revogada e uma nova será emitida com os mesmos escopos. Atualize o
              sistema integrador com o valor novo{' '}
              <strong className="text-[var(--texto)]">antes de concluir</strong> — o acesso é
              interrompido no mesmo instante.
            </>
          )}
        </p>
      </Dialogo>
    </li>
  );
}

// =============================================================================
//  Diálogos
// =============================================================================

function DialogoCriarAplicacao({
  aberto,
  aoFechar,
  aoCriar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoCriar: (id: string) => void;
}) {
  const [nome, setNome] = useState('');
  const [slug, setSlug] = useState('');
  const [descricao, setDescricao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const criar = useMutation({
    mutationFn: () =>
      api<Aplicacao>('/admin/applications', {
        method: 'POST',
        body: { name: nome, slug: slug || undefined, description: descricao || undefined },
      }),
    onSuccess: (aplicacao) => {
      void queryClient.invalidateQueries({ queryKey: ['aplicacoes'] });
      setNome('');
      setSlug('');
      setDescricao('');
      setErro(null);
      aoFechar();
      aoCriar(aplicacao.id);
    },
    onError: (e) => setErro(e instanceof ApiError ? e.message : 'Não foi possível criar.'),
  });

  const slugSugerido = slug || derivarSlug(nome);

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Nova aplicação"
      descricao="Um sistema que vai consumir esta API."
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={() => criar.mutate()} carregando={criar.isPending} disabled={!nome}>
            Criar
          </Botao>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Campo
          rotulo="Nome"
          placeholder="CRM Vendas"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          autoFocus
          erro={erro ?? undefined}
        />

        <Campo
          rotulo="Identificador (slug)"
          placeholder={derivarSlug(nome) || 'crm-vendas'}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          // Imutável depois porque compõe o nome interno das sessões no serviço
          // de WhatsApp — renomeá-lo deixaria sessões órfãs.
          dica={
            slugSugerido
              ? `Ficará "${slugSugerido}". Não poderá ser alterado depois.`
              : 'Derivado do nome se deixado em branco. Não poderá ser alterado depois.'
          }
        />

        <Campo
          rotulo="Descrição (opcional)"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
        />
      </div>
    </Dialogo>
  );
}

function DialogoEmitirChave({
  aplicacaoId,
  aberto,
  aoFechar,
  aoEmitir,
}: {
  aplicacaoId: string;
  aberto: boolean;
  aoFechar: () => void;
  aoEmitir: (chave: ChaveCriada) => void;
}) {
  const [nome, setNome] = useState('');
  const [escopos, setEscopos] = useState<ApiScope[]>([]);
  const queryClient = useQueryClient();

  const emitir = useMutation({
    mutationFn: () =>
      api<ChaveCriada>(`/admin/applications/${aplicacaoId}/api-keys`, {
        method: 'POST',
        body: { name: nome, scopes: escopos },
      }),
    onSuccess: (chave) => {
      void queryClient.invalidateQueries({ queryKey: ['aplicacoes', aplicacaoId] });
      setNome('');
      setEscopos([]);
      aoFechar();
      aoEmitir(chave);
    },
  });

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Emitir chave de API"
      descricao="O segredo será exibido uma única vez."
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao onClick={() => emitir.mutate()} carregando={emitir.isPending} disabled={!nome}>
            Emitir
          </Botao>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Campo
          rotulo="Nome da chave"
          placeholder="produção, homologação…"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          dica="Para você identificar esta chave depois."
          autoFocus
        />

        <div>
          <p className="mb-1.5 text-sm font-medium">Permissões</p>
          <p className="mb-2.5 text-xs text-[var(--texto-fraco)]">
            Nenhuma marcada concede todas — restringir é uma escolha deliberada.
          </p>

          <div className="flex flex-col gap-1.5">
            {API_SCOPES.map((escopo) => (
              <label
                key={escopo}
                className="flex cursor-pointer items-start gap-2.5 rounded-md p-1.5 hover:bg-[var(--superficie-2)]"
              >
                <input
                  type="checkbox"
                  checked={escopos.includes(escopo)}
                  onChange={(e) =>
                    setEscopos((atuais) =>
                      e.target.checked ? [...atuais, escopo] : atuais.filter((s) => s !== escopo),
                    )
                  }
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primaria)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm">{API_SCOPE_LABELS[escopo]}</span>
                  <code className="font-mono text-xs text-[var(--texto-fraco)]">{escopo}</code>
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Dialogo>
  );
}

function DialogoExcluir({
  aplicacao,
  aberto,
  aoFechar,
  aoExcluir,
}: {
  aplicacao: Aplicacao;
  aberto: boolean;
  aoFechar: () => void;
  aoExcluir: () => void;
}) {
  const [confirmacao, setConfirmacao] = useState('');
  const queryClient = useQueryClient();
  const { mostrar } = useAvisos();

  const excluir = useMutation({
    mutationFn: () =>
      api(`/admin/applications/${aplicacao.id}?confirm=${encodeURIComponent(confirmacao)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['aplicacoes'] });
      mostrar({ tom: 'sucesso', titulo: 'Aplicação excluída' });
      aoExcluir();
    },
    onError: (erro) =>
      mostrar({ tom: 'erro', titulo: 'Não foi possível excluir', detalhe: String(erro) }),
  });

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Excluir a aplicação?"
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            variante="perigo"
            disabled={confirmacao !== aplicacao.slug}
            carregando={excluir.isPending}
            onClick={() => excluir.mutate()}
          >
            Excluir permanentemente
          </Botao>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[var(--texto-suave)]">Serão apagados permanentemente:</p>

        <ul className="flex flex-col gap-1 text-sm">
          <li>
            • <strong>{numero(aplicacao.counts?.sessions ?? 0)}</strong> sessão(ões) — os números
            serão desconectados
          </li>
          <li>
            • <strong>{numero(aplicacao.counts?.activeApiKeys ?? 0)}</strong> chave(s) de API
          </li>
          <li>
            • <strong>todo o histórico de mensagens</strong> desta aplicação
          </li>
        </ul>

        {/* Digitar o slug é atrito proporcional: o cascade apaga histórico que
            não tem como voltar. */}
        <Campo
          rotulo={`Digite "${aplicacao.slug}" para confirmar`}
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          autoComplete="off"
        />
      </div>
    </Dialogo>
  );
}

function derivarSlug(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
