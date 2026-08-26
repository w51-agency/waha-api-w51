import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MoreVertical,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Smartphone,
  Square,
  Trash2,
  Unplug,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

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
import { TOM_SESSAO } from '@/lib/status';
import { cn, formatarTelefone, tempoRelativo } from '@/lib/utils';

import { DialogoQr } from './qr-dialogo';

import type { Aplicacao, Sessao } from '@/lib/tipos';
import { SessionStatus } from '@gateway/shared';

export function ListaDeSessoes({ navegar }: { navegar: (para: string) => void }) {
  const [filtroStatus, setFiltroStatus] = useState('');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [criando, setCriando] = useState(false);
  const [qrDe, setQrDe] = useState<Sessao | null>(null);

  // Debounce: sem ele, cada tecla dispara uma consulta com LIKE no banco.
  useEffect(() => {
    const timer = setTimeout(() => setBuscaAplicada(busca), 300);
    return () => clearTimeout(timer);
  }, [busca]);

  const { data: sessoes, isLoading } = useQuery({
    queryKey: ['sessoes', filtroStatus, buscaAplicada],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filtroStatus) params.set('status', filtroStatus);
      if (buscaAplicada) params.set('search', buscaAplicada);
      return api<Sessao[]>(`/admin/sessions?${params}`);
    },
    refetchInterval: 20_000,
  });

  const conectadas = sessoes?.filter((s) => s.status === SessionStatus.WORKING).length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Números</h1>
          <p className="mt-0.5 text-sm text-[var(--texto-suave)]">
            {sessoes
              ? `${conectadas} de ${sessoes.length} ${sessoes.length === 1 ? 'conectado' : 'conectados'}`
              : 'Carregando…'}
          </p>
        </div>

        <Botao onClick={() => setCriando(true)}>
          <Plus className="h-4 w-4" />
          Conectar número
        </Botao>
      </div>

      <div className="flex flex-wrap gap-2">
        <Campo
          placeholder="Buscar por apelido ou número…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full sm:w-72"
        />
        <Seletor value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
          <option value="">Todos os status</option>
          <option value={SessionStatus.WORKING}>Conectado</option>
          <option value={SessionStatus.SCAN_QR_CODE}>Aguardando QR</option>
          <option value={SessionStatus.STARTING}>Iniciando</option>
          <option value={SessionStatus.STOPPED}>Parado</option>
          <option value={SessionStatus.FAILED}>Falhou</option>
        </Seletor>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Esqueleto key={i} className="h-[74px]" />
          ))}
        </div>
      ) : !sessoes?.length ? (
        <Cartao>
          <EstadoVazio
            icone={<Smartphone className="h-9 w-9" />}
            titulo={
              filtroStatus || buscaAplicada
                ? 'Nenhum número corresponde ao filtro'
                : 'Nenhum número conectado ainda'
            }
            descricao={
              filtroStatus || buscaAplicada
                ? 'Ajuste os filtros para ver outros resultados.'
                : 'Conecte o primeiro número escaneando um QR code com o WhatsApp do celular.'
            }
            acao={
              !filtroStatus && !buscaAplicada ? (
                <Botao onClick={() => setCriando(true)}>
                  <Plus className="h-4 w-4" />
                  Conectar número
                </Botao>
              ) : undefined
            }
          />
        </Cartao>
      ) : (
        <div className="flex flex-col gap-2">
          {sessoes.map((sessao) => (
            <LinhaDeSessao
              key={sessao.id}
              sessao={sessao}
              aoAbrirQr={() => setQrDe(sessao)}
              aoAbrirDetalhe={() => navegar(`/sessoes/${sessao.id}`)}
            />
          ))}
        </div>
      )}

      <DialogoCriar aberto={criando} aoFechar={() => setCriando(false)} aoCriar={setQrDe} />

      {qrDe && <DialogoQr sessao={qrDe} aberto={Boolean(qrDe)} aoFechar={() => setQrDe(null)} />}
    </div>
  );
}

function LinhaDeSessao({
  sessao,
  aoAbrirQr,
  aoAbrirDetalhe,
}: {
  sessao: Sessao;
  aoAbrirQr: () => void;
  aoAbrirDetalhe: () => void;
}) {
  const precisaConectar =
    sessao.status === SessionStatus.SCAN_QR_CODE || sessao.status === SessionStatus.STARTING;

  return (
    <Cartao className="flex flex-wrap items-center gap-4 p-4 transition-colors hover:border-[var(--texto-fraco)]">
      <button
        onClick={aoAbrirDetalhe}
        className="flex min-w-0 flex-1 items-center gap-3.5 text-left"
      >
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            sessao.status === SessionStatus.WORKING
              ? 'bg-[var(--sucesso-suave)] text-[var(--sucesso)]'
              : 'bg-[var(--superficie-2)] text-[var(--texto-fraco)]',
          )}
        >
          <Smartphone className="h-4.5 w-4.5" />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">
              {sessao.label ?? sessao.pushName ?? 'Sem apelido'}
            </span>
            <Badge tom={TOM_SESSAO[sessao.status] ?? 'neutro'} ponto>
              {sessao.statusLabel}
            </Badge>
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--texto-suave)]">
            <span className="font-mono">{formatarTelefone(sessao.phoneNumber)}</span>
            {sessao.application && (
              <span title="Sistema que conectou este número">{sessao.application.name}</span>
            )}
            {sessao.connectedAt && <span>conectado {tempoRelativo(sessao.connectedAt)}</span>}
          </div>
        </div>
      </button>

      <div className="flex items-center gap-1.5">
        {precisaConectar && (
          <Botao tamanho="sm" onClick={aoAbrirQr}>
            <QrCode className="h-3.5 w-3.5" />
            Conectar
          </Botao>
        )}
        <MenuDeAcoes sessao={sessao} />
      </div>
    </Cartao>
  );
}

export function MenuDeAcoes({ sessao }: { sessao: Sessao }) {
  const [aberto, setAberto] = useState(false);
  const [confirmando, setConfirmando] = useState<'logout' | 'excluir' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { mostrar } = useAvisos();

  useEffect(() => {
    if (!aberto) return;

    const aoClicarFora = (evento: MouseEvent) => {
      if (ref.current && !ref.current.contains(evento.target as Node)) setAberto(false);
    };

    document.addEventListener('mousedown', aoClicarFora);
    return () => document.removeEventListener('mousedown', aoClicarFora);
  }, [aberto]);

  const acao = useMutation({
    mutationFn: ({ tipo }: { tipo: string }) =>
      tipo === 'excluir'
        ? api(`/admin/sessions/${sessao.id}`, { method: 'DELETE' })
        : api(`/admin/sessions/${sessao.id}/${tipo}`, { method: 'POST' }),
    onSuccess: (_dados, { tipo }) => {
      void queryClient.invalidateQueries({ queryKey: ['sessoes'] });
      mostrar({
        tom: 'sucesso',
        titulo:
          {
            start: 'Sessão iniciada',
            stop: 'Sessão parada',
            restart: 'Sessão reiniciada',
            logout: 'Número desconectado',
            excluir: 'Sessão excluída',
          }[tipo] ?? 'Ação concluída',
      });
      setConfirmando(null);
    },
    onError: (erro) => {
      mostrar({
        tom: 'erro',
        titulo: 'Não foi possível concluir',
        detalhe: erro instanceof ApiError ? erro.message : String(erro),
      });
    },
  });

  const itens = [
    { tipo: 'start', rotulo: 'Iniciar', icone: Play, mostrar: sessao.status !== 'WORKING' },
    { tipo: 'stop', rotulo: 'Parar', icone: Square, mostrar: sessao.status !== 'STOPPED' },
    { tipo: 'restart', rotulo: 'Reiniciar', icone: RefreshCw, mostrar: true },
  ].filter((i) => i.mostrar);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setAberto((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--texto-fraco)] hover:bg-[var(--superficie-2)] hover:text-[var(--texto)]"
        aria-label="Mais ações"
        aria-expanded={aberto}
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {aberto && (
        <div className="absolute right-0 top-9 z-20 w-52 overflow-hidden rounded-[var(--raio)] border bg-[var(--superficie)] py-1 shadow-lg">
          {itens.map(({ tipo, rotulo, icone: Icone }) => (
            <button
              key={tipo}
              onClick={() => {
                setAberto(false);
                acao.mutate({ tipo });
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-[var(--superficie-2)]"
            >
              <Icone className="h-3.5 w-3.5 text-[var(--texto-fraco)]" />
              {rotulo}
            </button>
          ))}

          <div className="my-1 border-t" />

          <button
            onClick={() => {
              setAberto(false);
              setConfirmando('logout');
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-[var(--superficie-2)]"
          >
            <Unplug className="h-3.5 w-3.5 text-[var(--texto-fraco)]" />
            Desconectar número
          </button>

          <button
            onClick={() => {
              setAberto(false);
              setConfirmando('excluir');
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-[var(--erro)] hover:bg-[var(--erro-suave)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Excluir sessão
          </button>
        </div>
      )}

      <Dialogo
        aberto={confirmando !== null}
        aoFechar={() => setConfirmando(null)}
        titulo={confirmando === 'logout' ? 'Desconectar o número?' : 'Excluir a sessão?'}
        rodape={
          <>
            <Botao variante="secundario" onClick={() => setConfirmando(null)}>
              Cancelar
            </Botao>
            <Botao
              variante="perigo"
              carregando={acao.isPending}
              onClick={() => acao.mutate({ tipo: confirmando === 'logout' ? 'logout' : 'excluir' })}
            >
              {confirmando === 'logout' ? 'Desconectar' : 'Excluir'}
            </Botao>
          </>
        }
      >
        {/* A consequência precisa estar explícita: as duas ações exigem escanear
            o QR de novo, e uma delas apaga o histórico. */}
        {confirmando === 'logout' ? (
          <p className="text-sm text-[var(--texto-suave)]">
            O aparelho será desvinculado e{' '}
            <strong className="text-[var(--texto)]">precisará escanear o QR code novamente</strong>{' '}
            para voltar a enviar mensagens. O histórico é preservado.
          </p>
        ) : (
          <p className="text-sm text-[var(--texto-suave)]">
            A sessão será removida do gateway e do serviço de WhatsApp, junto de{' '}
            <strong className="text-[var(--texto)]">todo o histórico de mensagens</strong> dela.
            Esta ação não pode ser desfeita.
          </p>
        )}
      </Dialogo>
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
  aoCriar: (sessao: Sessao) => void;
}) {
  const [aplicacaoId, setAplicacaoId] = useState('');
  const [apelido, setApelido] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: aplicacoes } = useQuery({
    queryKey: ['aplicacoes'],
    queryFn: () => api<Aplicacao[]>('/admin/applications'),
    enabled: aberto,
  });

  const ativas = aplicacoes?.filter((a) => a.active) ?? [];

  useEffect(() => {
    if (aberto && ativas.length === 1 && !aplicacaoId) setAplicacaoId(ativas[0]!.id);
  }, [aberto, ativas, aplicacaoId]);

  const criar = useMutation({
    mutationFn: () =>
      api<Sessao>('/admin/sessions', {
        method: 'POST',
        body: { applicationId: aplicacaoId, label: apelido || undefined },
      }),
    onSuccess: (sessao) => {
      void queryClient.invalidateQueries({ queryKey: ['sessoes'] });
      aoFechar();
      setApelido('');
      setErro(null);
      // Abre o QR na sequência: criar sem conectar não serve para nada.
      aoCriar(sessao);
    },
    onError: (e) => setErro(e instanceof ApiError ? e.message : 'Não foi possível criar.'),
  });

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Conectar um número"
      descricao="Escolha o sistema dono deste número. Em seguida você escaneia o QR code."
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            onClick={() => criar.mutate()}
            carregando={criar.isPending}
            disabled={!aplicacaoId}
          >
            Criar e mostrar QR
          </Botao>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {ativas.length === 0 ? (
          <p className="text-sm text-[var(--texto-suave)]">
            Nenhuma aplicação ativa. Cadastre uma em <strong>Aplicações</strong> antes de conectar
            um número — é ela que identifica qual sistema é dono da sessão.
          </p>
        ) : (
          <>
            <Seletor
              rotulo="Aplicação"
              value={aplicacaoId}
              onChange={(e) => setAplicacaoId(e.target.value)}
            >
              <option value="">Selecione…</option>
              {ativas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Seletor>

            <Campo
              rotulo="Apelido (opcional)"
              placeholder="Comercial, Suporte…"
              value={apelido}
              onChange={(e) => setApelido(e.target.value)}
              dica="Para você identificar o número no painel."
              erro={erro ?? undefined}
            />
          </>
        )}
      </div>
    </Dialogo>
  );
}
