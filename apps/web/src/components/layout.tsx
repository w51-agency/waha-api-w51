import {
  Activity,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Monitor,
  Moon,
  ScrollText,
  Smartphone,
  Sun,
  Webhook,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { useEventStream } from '@/hooks/use-eventos';
import { useTema } from '@/hooks/use-tema';
import { api, sair } from '@/lib/api';
import { cn } from '@/lib/utils';

const NAVEGACAO = [
  { para: '/', rotulo: 'Visão geral', icone: LayoutDashboard },
  { para: '/sessoes', rotulo: 'Números', icone: Smartphone },
  { para: '/mensagens', rotulo: 'Mensagens', icone: MessageSquare },
  { para: '/aplicacoes', rotulo: 'Aplicações', icone: KeyRound },
  { para: '/webhooks', rotulo: 'Webhooks', icone: Webhook },
  { para: '/auditoria', rotulo: 'Auditoria', icone: ScrollText },
] as const;

export function Layout({
  children,
  rota,
  navegar,
}: {
  children: ReactNode;
  rota: string;
  navegar: (para: string) => void;
}) {
  const { conectado } = useEventStream();

  return (
    <div className="flex min-h-screen">
      <BarraLateral rota={rota} navegar={navegar} />

      <div className="flex min-w-0 flex-1 flex-col">
        <BarraSuperior conectado={conectado} />
        <main className="min-w-0 flex-1 p-5 lg:p-7">{children}</main>
      </div>
    </div>
  );
}

function BarraLateral({ rota, navegar }: { rota: string; navegar: (para: string) => void }) {
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r bg-[var(--superficie)] lg:flex">
      <div className="flex h-14 items-center gap-2.5 border-b px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--primaria)] text-[var(--primaria-texto)]">
          <MessageSquare className="h-4 w-4" />
        </div>
        <span className="text-sm font-semibold tracking-tight">Gateway W51</span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 p-3">
        {NAVEGACAO.map(({ para, rotulo, icone: Icone }) => {
          const ativo = para === '/' ? rota === '/' : rota.startsWith(para);

          return (
            <button
              key={para}
              onClick={() => navegar(para)}
              aria-current={ativo ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-[var(--raio)] px-3 py-2 text-sm transition-colors',
                ativo
                  ? 'bg-[var(--primaria-suave)] font-medium text-[var(--primaria)]'
                  : 'text-[var(--texto-suave)] hover:bg-[var(--superficie-2)] hover:text-[var(--texto)]',
              )}
            >
              <Icone className="h-4 w-4 shrink-0" />
              {rotulo}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function BarraSuperior({ conectado }: { conectado: boolean }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-[var(--superficie)] px-5">
      <NavegacaoCompacta />

      <div className="flex items-center gap-1.5">
        <IndicadorAoVivo conectado={conectado} />
        <SaudeDoSistema />
        <AlternadorDeTema />
        <button
          onClick={() => {
            void sair().finally(() => window.location.reload());
          }}
          className="flex h-9 w-9 items-center justify-center rounded-[var(--raio)] text-[var(--texto-fraco)] hover:bg-[var(--superficie-2)] hover:text-[var(--texto)]"
          title="Sair"
          aria-label="Sair"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

/** Em telas estreitas a barra lateral some; a navegação vira uma linha rolável. */
function NavegacaoCompacta() {
  return (
    <div className="flex items-center gap-1 overflow-x-auto lg:hidden">
      {NAVEGACAO.map(({ para, rotulo, icone: Icone }) => (
        <a
          key={para}
          href={`#${para}`}
          className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs text-[var(--texto-suave)] hover:bg-[var(--superficie-2)]"
        >
          <Icone className="h-3.5 w-3.5" />
          {rotulo}
        </a>
      ))}
    </div>
  );
}

/**
 * Estado da conexão ao vivo.
 *
 * Sem este indicador, um stream caído deixaria o painel silenciosamente
 * desatualizado — e o operador confiaria em números velhos.
 */
function IndicadorAoVivo({ conectado }: { conectado: boolean }) {
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs sm:inline-flex"
      title={
        conectado
          ? 'Recebendo atualizações em tempo real'
          : 'Sem conexão ao vivo — os dados podem estar desatualizados'
      }
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          conectado ? 'bg-[var(--sucesso)]' : 'bg-[var(--texto-fraco)]',
        )}
      />
      <span className="text-[var(--texto-fraco)]">{conectado ? 'ao vivo' : 'reconectando'}</span>
    </span>
  );
}

function SaudeDoSistema() {
  const [estado, setEstado] = useState<'ok' | 'erro' | null>(null);
  const [detalhe, setDetalhe] = useState('');

  useEffect(() => {
    let ativo = true;

    const verificar = async () => {
      try {
        const r = await api<{ status: string; details: Record<string, { status: string }> }>(
          '/health/ready',
        );
        if (!ativo) return;
        setEstado(r.status === 'ok' ? 'ok' : 'erro');
        setDetalhe(
          Object.entries(r.details)
            .map(([nome, d]) => `${nome}: ${d.status === 'up' ? 'ok' : 'fora do ar'}`)
            .join(' · '),
        );
      } catch {
        if (!ativo) return;
        setEstado('erro');
        setDetalhe('Não foi possível consultar o estado do sistema.');
      }
    };

    void verificar();
    const intervalo = setInterval(() => void verificar(), 30_000);

    return () => {
      ativo = false;
      clearInterval(intervalo);
    };
  }, []);

  if (estado === null) return null;

  return (
    <span
      className={cn(
        'hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs sm:inline-flex',
        estado === 'ok'
          ? 'text-[var(--texto-fraco)]'
          : 'bg-[var(--erro-suave)] font-medium text-[var(--erro)]',
      )}
      title={detalhe}
    >
      <Activity className="h-3 w-3" />
      {estado === 'ok' ? 'sistema ok' : 'atenção'}
    </span>
  );
}

function AlternadorDeTema() {
  const { tema, definir } = useTema();

  const proximo = { sistema: 'claro', claro: 'escuro', escuro: 'sistema' } as const;
  const Icone = { sistema: Monitor, claro: Sun, escuro: Moon }[tema];
  const titulo = { sistema: 'Tema do sistema', claro: 'Tema claro', escuro: 'Tema escuro' }[tema];

  return (
    <button
      onClick={() => definir(proximo[tema])}
      className="flex h-9 w-9 items-center justify-center rounded-[var(--raio)] text-[var(--texto-fraco)] hover:bg-[var(--superficie-2)] hover:text-[var(--texto)]"
      title={titulo}
      aria-label={titulo}
    >
      <Icone className="h-4 w-4" />
    </button>
  );
}
