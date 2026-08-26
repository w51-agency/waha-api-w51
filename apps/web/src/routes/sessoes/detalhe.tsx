import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, QrCode, Smartphone } from 'lucide-react';
import { useState } from 'react';

import { Badge, Botao, Cartao, Esqueleto, EstadoVazio } from '@/components/ui';
import { api } from '@/lib/api';
import { TOM_SESSAO } from '@/lib/status';
import { dataCompleta, formatarTelefone, numero, tempoRelativo } from '@/lib/utils';

import { MenuDeAcoes } from './lista';
import { DialogoQr } from './qr-dialogo';

import type { Mensagem, PaginaMensagens, RegistroAuditoria, Sessao } from '@/lib/tipos';
import { SessionStatus } from '@gateway/shared';

export function DetalheDaSessao({
  sessaoId,
  navegar,
}: {
  sessaoId: string;
  navegar: (para: string) => void;
}) {
  const [qrAberto, setQrAberto] = useState(false);

  const { data: sessao, isLoading } = useQuery({
    queryKey: ['sessoes', sessaoId],
    queryFn: () => api<Sessao>(`/admin/sessions/${sessaoId}`),
    refetchInterval: 15_000,
  });

  const { data: timeline } = useQuery({
    queryKey: ['sessoes', sessaoId, 'timeline'],
    queryFn: () => api<RegistroAuditoria[]>(`/admin/sessions/${sessaoId}/timeline`),
  });

  const { data: mensagens } = useQuery({
    queryKey: ['mensagens', { sessaoId, limite: 8 }],
    queryFn: () =>
      api<PaginaMensagens>(`/admin/messages?sessionId=${sessaoId}&limit=8`).catch(() => ({
        data: [],
        nextCursor: null,
        hasMore: false,
      })),
  });

  if (isLoading) return <Esqueleto className="h-64" />;

  if (!sessao) {
    return (
      <EstadoVazio
        titulo="Sessão não encontrada"
        descricao="Ela pode ter sido excluída."
        acao={<Botao onClick={() => navegar('/sessoes')}>Voltar para os números</Botao>}
      />
    );
  }

  const precisaConectar =
    sessao.status === SessionStatus.SCAN_QR_CODE || sessao.status === SessionStatus.STARTING;

  return (
    <div className="flex flex-col gap-5">
      <button
        onClick={() => navegar('/sessoes')}
        className="flex w-fit items-center gap-1.5 text-sm text-[var(--texto-suave)] hover:text-[var(--texto)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Números
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--superficie-2)] text-[var(--texto-fraco)]">
            <Smartphone className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">
                {sessao.label ?? sessao.pushName ?? 'Sem apelido'}
              </h1>
              <Badge tom={TOM_SESSAO[sessao.status] ?? 'neutro'} ponto>
                {sessao.statusLabel}
              </Badge>
            </div>
            <p className="mt-0.5 font-mono text-sm text-[var(--texto-suave)]">
              {formatarTelefone(sessao.phoneNumber)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {precisaConectar && (
            <Botao onClick={() => setQrAberto(true)}>
              <QrCode className="h-4 w-4" />
              Conectar
            </Botao>
          )}
          <MenuDeAcoes sessao={sessao} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador rotulo="Aplicação" valor={sessao.application?.name ?? '—'} />
        <Indicador
          rotulo="QR solicitado"
          valor={`${numero(sessao.qrRequestCount)}×`}
          detalhe={
            sessao.lastQrRequestedAt ? `último ${tempoRelativo(sessao.lastQrRequestedAt)}` : 'nunca'
          }
        />
        <Indicador
          rotulo="Conectado desde"
          valor={sessao.connectedAt ? tempoRelativo(sessao.connectedAt) : '—'}
          detalhe={sessao.connectedAt ? dataCompleta(sessao.connectedAt) : undefined}
        />
        <Indicador rotulo="Motor" valor={sessao.engine} detalhe="sem navegador" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Cartao className="overflow-hidden">
          <h2 className="border-b px-4 py-3 text-sm font-medium">Histórico da sessão</h2>
          {!timeline?.length ? (
            <EstadoVazio titulo="Sem registros" />
          ) : (
            <ol className="divide-y">
              {timeline.map((registro) => (
                <li key={registro.id} className="px-4 py-2.5">
                  <p className="text-sm">{registro.description}</p>
                  <p
                    className="mt-0.5 text-xs text-[var(--texto-fraco)]"
                    title={dataCompleta(registro.createdAt)}
                  >
                    {tempoRelativo(registro.createdAt)}
                    {registro.ip && ` · ${registro.ip}`}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Cartao>

        <Cartao className="overflow-hidden">
          <h2 className="border-b px-4 py-3 text-sm font-medium">Mensagens recentes</h2>
          {!mensagens?.data.length ? (
            <EstadoVazio titulo="Nenhuma mensagem ainda" />
          ) : (
            <ul className="divide-y">
              {mensagens.data.map((mensagem: Mensagem) => (
                <li key={mensagem.id} className="flex items-start gap-3 px-4 py-2.5">
                  <span
                    className={
                      mensagem.direction === 'INBOUND'
                        ? 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--primaria)]'
                        : 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--sucesso)]'
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{mensagem.body ?? `[${mensagem.type}]`}</p>
                    <p className="mt-0.5 text-xs text-[var(--texto-fraco)]">
                      {mensagem.direction === 'INBOUND' ? 'de' : 'para'} {mensagem.phone} ·{' '}
                      {tempoRelativo(mensagem.timestamp)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      </div>

      <DialogoQr sessao={sessao} aberto={qrAberto} aoFechar={() => setQrAberto(false)} />
    </div>
  );
}

function Indicador({
  rotulo,
  valor,
  detalhe,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
}) {
  return (
    <Cartao className="p-4">
      <p className="text-xs text-[var(--texto-suave)]">{rotulo}</p>
      <p className="mt-1 truncate text-lg font-semibold">{valor}</p>
      {detalhe && <p className="mt-0.5 truncate text-xs text-[var(--texto-fraco)]">{detalhe}</p>}
    </Cartao>
  );
}
