import { X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

import { TOM_CLASSES, TOM_PONTO, type Tom } from '@/lib/status';
import { cn } from '@/lib/utils';

// =============================================================================
//  Botão
// =============================================================================

type VarianteBotao = 'primario' | 'secundario' | 'fantasma' | 'perigo';
type TamanhoBotao = 'sm' | 'md' | 'lg' | 'icone';

const VARIANTES: Record<VarianteBotao, string> = {
  primario: 'bg-[var(--primaria)] text-[var(--primaria-texto)] hover:opacity-90 active:opacity-80',
  secundario:
    'bg-[var(--superficie-2)] text-[var(--texto)] border border-[var(--borda)] hover:bg-[var(--borda)]',
  fantasma: 'text-[var(--texto-suave)] hover:bg-[var(--superficie-2)] hover:text-[var(--texto)]',
  perigo: 'bg-[var(--erro)] text-white hover:opacity-90',
};

const TAMANHOS: Record<TamanhoBotao, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9.5 px-4 text-sm gap-2',
  lg: 'h-11 px-6 text-sm gap-2',
  icone: 'h-9 w-9',
};

export interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBotao;
  tamanho?: TamanhoBotao;
  carregando?: boolean;
}

export function Botao({
  variante = 'primario',
  tamanho = 'md',
  carregando,
  className,
  children,
  disabled,
  ...resto
}: BotaoProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-[var(--raio)] font-medium',
        'transition-[background-color,opacity] duration-150 whitespace-nowrap',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primaria)]',
        'disabled:opacity-50 disabled:pointer-events-none',
        VARIANTES[variante],
        TAMANHOS[tamanho],
        className,
      )}
      disabled={disabled || carregando}
      {...resto}
    >
      {carregando && <Girando />}
      {children}
    </button>
  );
}

export function Girando({ className }: { className?: string }) {
  return (
    <svg
      className={cn('animate-spin h-4 w-4', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

// =============================================================================
//  Campos
// =============================================================================

export interface CampoProps extends InputHTMLAttributes<HTMLInputElement> {
  rotulo?: string;
  erro?: string;
  dica?: string;
}

export function Campo({ rotulo, erro, dica, className, id, ...resto }: CampoProps) {
  const gerado = useId();
  const idCampo = id ?? gerado;

  return (
    <div className="flex flex-col gap-1.5">
      {rotulo && (
        <label htmlFor={idCampo} className="text-sm font-medium text-[var(--texto)]">
          {rotulo}
        </label>
      )}
      <input
        id={idCampo}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${idCampo}-erro` : dica ? `${idCampo}-dica` : undefined}
        className={cn(
          'h-9.5 w-full rounded-[var(--raio)] border bg-[var(--superficie)] px-3 text-sm',
          'placeholder:text-[var(--texto-fraco)]',
          'focus:outline-2 focus:outline-offset-[-1px] focus:outline-[var(--primaria)]',
          'disabled:opacity-60',
          erro && 'border-[var(--erro)]',
          className,
        )}
        {...resto}
      />
      {erro && (
        <p id={`${idCampo}-erro`} className="text-xs text-[var(--erro)]">
          {erro}
        </p>
      )}
      {!erro && dica && (
        <p id={`${idCampo}-dica`} className="text-xs text-[var(--texto-fraco)]">
          {dica}
        </p>
      )}
    </div>
  );
}

export interface SeletorProps extends SelectHTMLAttributes<HTMLSelectElement> {
  rotulo?: string;
}

export function Seletor({ rotulo, className, id, children, ...resto }: SeletorProps) {
  const gerado = useId();
  const idCampo = id ?? gerado;

  return (
    <div className="flex flex-col gap-1.5">
      {rotulo && (
        <label htmlFor={idCampo} className="text-sm font-medium text-[var(--texto)]">
          {rotulo}
        </label>
      )}
      <select
        id={idCampo}
        className={cn(
          'h-9.5 rounded-[var(--raio)] border bg-[var(--superficie)] px-3 text-sm',
          'focus:outline-2 focus:outline-offset-[-1px] focus:outline-[var(--primaria)]',
          className,
        )}
        {...resto}
      >
        {children}
      </select>
    </div>
  );
}

// =============================================================================
//  Superfícies
// =============================================================================

export function Cartao({
  className,
  children,
  ...resto
}: { children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[var(--raio)] border bg-[var(--superficie)] shadow-[var(--sombra)]',
        className,
      )}
      {...resto}
    >
      {children}
    </div>
  );
}

export function Badge({
  tom = 'neutro',
  ponto,
  children,
  className,
}: {
  tom?: Tom;
  ponto?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        TOM_CLASSES[tom],
        className,
      )}
    >
      {ponto && <span className={cn('h-1.5 w-1.5 rounded-full', TOM_PONTO[tom])} />}
      {children}
    </span>
  );
}

// =============================================================================
//  Diálogo
// =============================================================================

export interface DialogoProps {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  descricao?: string;
  children: ReactNode;
  rodape?: ReactNode;
  /**
   * Impede fechar clicando fora ou com Esc.
   *
   * Usado na exibição única de segredos: fechar sem copiar significa perder a
   * credencial, então o fechamento acidental precisa ser impossível.
   */
  travado?: boolean;
  largura?: string;
}

export function Dialogo({
  aberto,
  aoFechar,
  titulo,
  descricao,
  children,
  rodape,
  travado,
  largura = 'max-w-lg',
}: DialogoProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;

    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape' && !travado) aoFechar();
    };

    document.addEventListener('keydown', aoTeclar);
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = overflowAnterior;
    };
  }, [aberto, aoFechar, travado]);

  if (!aberto) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialogo-titulo"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={() => !travado && aoFechar()}
      />
      <div
        ref={ref}
        className={cn(
          'relative w-full rounded-[calc(var(--raio)*1.4)] border bg-[var(--superficie)]',
          'shadow-2xl max-h-[90vh] overflow-y-auto',
          largura,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b p-5">
          <div className="min-w-0">
            <h2 id="dialogo-titulo" className="text-base font-semibold">
              {titulo}
            </h2>
            {descricao && <p className="mt-1 text-sm text-[var(--texto-suave)]">{descricao}</p>}
          </div>
          {!travado && (
            <button
              onClick={aoFechar}
              className="shrink-0 rounded-md p-1 text-[var(--texto-fraco)] hover:bg-[var(--superficie-2)] hover:text-[var(--texto)]"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="p-5">{children}</div>

        {rodape && (
          <div className="flex items-center justify-end gap-2 border-t bg-[var(--superficie-2)] p-4">
            {rodape}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
//  Avisos flutuantes
// =============================================================================

interface Aviso {
  id: number;
  tom: Tom;
  titulo: string;
  detalhe?: string;
}

const AvisosContexto = createContext<{
  mostrar: (aviso: Omit<Aviso, 'id'>) => void;
} | null>(null);

export function ProvedorDeAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const proximoId = useRef(1);

  const mostrar = useCallback((aviso: Omit<Aviso, 'id'>) => {
    const id = proximoId.current++;
    setAvisos((atuais) => [...atuais, { ...aviso, id }]);

    // Erros ficam mais tempo: costumam trazer instrução que precisa ser lida.
    const duracao = aviso.tom === 'erro' ? 8000 : 4000;
    setTimeout(() => setAvisos((atuais) => atuais.filter((a) => a.id !== id)), duracao);
  }, []);

  const valor = useMemo(() => ({ mostrar }), [mostrar]);

  return (
    <AvisosContexto.Provider value={valor}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
        aria-live="polite"
      >
        {avisos.map((aviso) => (
          <div
            key={aviso.id}
            className={cn(
              'pointer-events-auto rounded-[var(--raio)] border bg-[var(--superficie)] p-3.5',
              'shadow-lg',
            )}
          >
            <div className="flex items-start gap-2.5">
              <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', TOM_PONTO[aviso.tom])} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{aviso.titulo}</p>
                {aviso.detalhe && (
                  <p className="mt-0.5 text-xs text-[var(--texto-suave)]">{aviso.detalhe}</p>
                )}
              </div>
              <button
                onClick={() => setAvisos((a) => a.filter((x) => x.id !== aviso.id))}
                className="shrink-0 text-[var(--texto-fraco)] hover:text-[var(--texto)]"
                aria-label="Dispensar"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </AvisosContexto.Provider>
  );
}

export function useAvisos() {
  const contexto = useContext(AvisosContexto);
  if (!contexto) throw new Error('useAvisos precisa estar dentro de ProvedorDeAvisos');
  return contexto;
}

// =============================================================================
//  Estados de carregamento e vazio
// =============================================================================

export function Esqueleto({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-[var(--superficie-2)]', className)} />;
}

export function EstadoVazio({
  icone,
  titulo,
  descricao,
  acao,
}: {
  icone?: ReactNode;
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icone && <div className="text-[var(--texto-fraco)]">{icone}</div>}
      <div>
        <p className="font-medium">{titulo}</p>
        {descricao && (
          <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--texto-suave)]">{descricao}</p>
        )}
      </div>
      {acao}
    </div>
  );
}
