import { useQuery } from '@tanstack/react-query';
import { Download, KeyRound, Monitor, ScrollText, Server, Smartphone, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge, Botao, Campo, Cartao, Esqueleto, EstadoVazio, Seletor } from '@/components/ui';
import { api } from '@/lib/api';
import { cn, dataCompleta, tempoRelativo } from '@/lib/utils';

import type { RegistroAuditoria } from '@/lib/tipos';

const ACOES = [
  { valor: '', rotulo: 'Todas as ações' },
  { valor: 'session.qr.requested', rotulo: 'QR code solicitado' },
  { valor: 'session.created', rotulo: 'Sessão criada' },
  { valor: 'session.deleted', rotulo: 'Sessão excluída' },
  { valor: 'session.logout', rotulo: 'Número desconectado' },
  { valor: 'apikey.created', rotulo: 'Chave emitida' },
  { valor: 'apikey.revoked', rotulo: 'Chave revogada' },
  { valor: 'apikey.rotated', rotulo: 'Chave rotacionada' },
  { valor: 'application.created', rotulo: 'Aplicação criada' },
  { valor: 'application.deleted', rotulo: 'Aplicação excluída' },
  { valor: 'admin.login', rotulo: 'Login no painel' },
  { valor: 'admin.login.failed', rotulo: 'Login recusado' },
];

export function AuditoriaPagina({ navegar }: { navegar: (para: string) => void }) {
  const [acao, setAcao] = useState('');
  const [tipoAtor, setTipoAtor] = useState('');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [selecionado, setSelecionado] = useState<RegistroAuditoria | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setBuscaAplicada(busca), 300);
    return () => clearTimeout(timer);
  }, [busca]);

  const { data: registros, isLoading } = useQuery({
    queryKey: ['auditoria', acao, tipoAtor],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '200' });
      if (acao) params.set('action', acao);
      if (tipoAtor) params.set('actorType', tipoAtor);
      return api<RegistroAuditoria[]>(`/admin/audit-logs?${params}`);
    },
    refetchInterval: 30_000,
  });

  // Busca no cliente: o endpoint filtra por campos estruturados, e a descrição
  // legível é montada na leitura — então filtrá-la aqui é onde ela existe.
  const filtrados = buscaAplicada
    ? registros?.filter((r) =>
        `${r.description} ${r.actorLabel ?? ''} ${r.action}`
          .toLowerCase()
          .includes(buscaAplicada.toLowerCase()),
      )
    : registros;

  const temFiltro = Boolean(acao || tipoAtor || buscaAplicada);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Auditoria</h1>
          <p className="mt-0.5 text-sm text-[var(--texto-suave)]">
            Quem fez o quê, quando — inclusive quem solicitou cada QR code
          </p>
        </div>

        <Botao variante="secundario" onClick={() => baixarCsv(filtrados ?? [])}>
          <Download className="h-4 w-4" />
          Exportar CSV
        </Botao>
      </div>

      <Cartao className="flex flex-wrap items-end gap-2 p-3">
        <Campo
          placeholder="Buscar…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full sm:w-56"
        />

        <Seletor value={acao} onChange={(e) => setAcao(e.target.value)}>
          {ACOES.map(({ valor, rotulo }) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </Seletor>

        <Seletor value={tipoAtor} onChange={(e) => setTipoAtor(e.target.value)}>
          <option value="">Todos os autores</option>
          <option value="ADMIN">Painel</option>
          <option value="API_KEY">Sistema integrador</option>
          <option value="SYSTEM">Sistema</option>
        </Seletor>

        {temFiltro && (
          <Botao
            variante="fantasma"
            tamanho="sm"
            onClick={() => {
              setAcao('');
              setTipoAtor('');
              setBusca('');
            }}
          >
            <X className="h-3.5 w-3.5" />
            Limpar
          </Botao>
        )}
      </Cartao>

      {isLoading ? (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <Esqueleto key={i} className="h-14" />
          ))}
        </div>
      ) : !filtrados?.length ? (
        <Cartao>
          <EstadoVazio
            icone={<ScrollText className="h-9 w-9" />}
            titulo={temFiltro ? 'Nenhum registro para estes filtros' : 'Nenhum registro ainda'}
            descricao={
              temFiltro
                ? 'Ajuste ou limpe os filtros.'
                : 'As ações realizadas no painel e pelos sistemas integrados aparecerão aqui.'
            }
          />
        </Cartao>
      ) : (
        <Cartao className="overflow-hidden">
          <ol className="divide-y">
            {filtrados.map((registro) => (
              <li key={registro.id}>
                <button
                  onClick={() => setSelecionado(registro)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[var(--superficie-2)]"
                >
                  <IconeDoAtor tipo={registro.actorType} />

                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{registro.description}</p>
                    <p
                      className="mt-0.5 text-xs text-[var(--texto-fraco)]"
                      title={dataCompleta(registro.createdAt)}
                    >
                      {tempoRelativo(registro.createdAt)}
                      {registro.ip && ` · ${registro.ip}`}
                      {registro.resourceType && ` · ${registro.resourceType}`}
                    </p>
                  </div>

                  {registro.action === 'admin.login.failed' && <Badge tom="erro">recusado</Badge>}
                </button>
              </li>
            ))}
          </ol>
        </Cartao>
      )}

      {selecionado && (
        <PainelDetalhe
          registro={selecionado}
          aoFechar={() => setSelecionado(null)}
          navegar={navegar}
        />
      )}
    </div>
  );
}

function IconeDoAtor({ tipo }: { tipo: RegistroAuditoria['actorType'] }) {
  const Icone = { ADMIN: Monitor, API_KEY: KeyRound, SYSTEM: Server }[tipo] ?? Server;

  return (
    <span
      className={cn(
        'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
        'bg-[var(--superficie-2)] text-[var(--texto-fraco)]',
      )}
      title={{ ADMIN: 'Painel', API_KEY: 'Sistema integrador', SYSTEM: 'Sistema' }[tipo]}
    >
      <Icone className="h-3 w-3" />
    </span>
  );
}

function PainelDetalhe({
  registro,
  aoFechar,
  navegar,
}: {
  registro: RegistroAuditoria;
  aoFechar: () => void;
  navegar: (para: string) => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={aoFechar} />

      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l bg-[var(--superficie)] shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Detalhe do registro</h2>
          <button
            onClick={aoFechar}
            className="rounded-md p-1 text-[var(--texto-fraco)] hover:bg-[var(--superficie-2)]"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <p className="mb-4 text-sm">{registro.description}</p>

          <dl className="flex flex-col gap-3 text-xs">
            <Linha rotulo="Ação" valor={registro.action} mono />
            <Linha
              rotulo="Autor"
              valor={`${registro.actorLabel ?? '—'} (${
                { ADMIN: 'painel', API_KEY: 'integrador', SYSTEM: 'sistema' }[registro.actorType]
              })`}
            />
            <Linha rotulo="Quando" valor={dataCompleta(registro.createdAt)} />
            {registro.ip && <Linha rotulo="IP" valor={registro.ip} mono />}
            {registro.userAgent && (
              <Linha rotulo="Cliente" valor={registro.userAgent.slice(0, 120)} />
            )}
            {registro.resourceType && (
              <Linha
                rotulo="Recurso"
                valor={`${registro.resourceType} ${registro.resourceId ?? ''}`}
                mono
              />
            )}
          </dl>

          {/* Atalho para o recurso: a auditoria só é útil se levar ao objeto. */}
          {registro.resourceType === 'session' && registro.resourceId && (
            <Botao
              variante="secundario"
              className="mt-4 w-full"
              onClick={() => {
                aoFechar();
                navegar(`/sessoes/${registro.resourceId}`);
              }}
            >
              <Smartphone className="h-4 w-4" />
              Abrir a sessão
            </Botao>
          )}

          {registro.resourceType === 'application' && registro.resourceId && (
            <Botao
              variante="secundario"
              className="mt-4 w-full"
              onClick={() => {
                aoFechar();
                navegar(`/aplicacoes/${registro.resourceId}`);
              }}
            >
              <KeyRound className="h-4 w-4" />
              Abrir a aplicação
            </Botao>
          )}

          {registro.metadata && Object.keys(registro.metadata).length > 0 && (
            <div className="mt-4">
              <p className="mb-1.5 text-xs text-[var(--texto-suave)]">Dados adicionais</p>
              <pre className="overflow-x-auto rounded-[var(--raio)] bg-[var(--superficie-2)] p-2.5 text-xs">
                {JSON.stringify(registro.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function Linha({ rotulo, valor, mono }: { rotulo: string; valor: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-[var(--texto-suave)]">{rotulo}</dt>
      <dd className={cn('min-w-0 break-all text-right', mono && 'font-mono')}>{valor}</dd>
    </div>
  );
}

function baixarCsv(registros: RegistroAuditoria[]): void {
  const escapar = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

  const linhas = [
    'data,acao,autor,tipo_autor,recurso,ip,descricao',
    ...registros.map((r) =>
      [
        r.createdAt,
        r.action,
        escapar(r.actorLabel ?? ''),
        r.actorType,
        escapar(`${r.resourceType ?? ''} ${r.resourceId ?? ''}`.trim()),
        r.ip ?? '',
        escapar(r.description),
      ].join(','),
    ),
  ];

  // BOM (U+FEFF) para o Excel reconhecer UTF-8 e não corromper a acentuação.
  // Escrito como escape porque o caractere literal é invisível no editor.
  const blob = new Blob([`\uFEFF${linhas.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();

  URL.revokeObjectURL(url);
}
