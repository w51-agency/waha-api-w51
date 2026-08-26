import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, RefreshCw, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Botao, Campo, Dialogo, Girando } from '@/components/ui';
import { useEventStream, type EventoAoVivo } from '@/hooks/use-eventos';
import { ApiError, api } from '@/lib/api';
import { formatarTelefone } from '@/lib/utils';

import type { QrCode, Sessao } from '@/lib/tipos';

/**
 * Renovação antecipada do QR.
 *
 * O WhatsApp gira o código a cada ~20 segundos. Buscar um novo aos 17 dá margem
 * para a requisição e evita o pior desfecho possível desta tela: o usuário
 * escanear um código morto, nada acontecer, e ele concluir que o sistema está
 * quebrado.
 */
const RENOVAR_EM = 17;

type Fase = 'carregando' | 'aguardando' | 'conectado' | 'erro';

export function DialogoQr({
  sessao,
  aberto,
  aoFechar,
}: {
  sessao: Sessao;
  aberto: boolean;
  aoFechar: () => void;
}) {
  const [fase, setFase] = useState<Fase>('carregando');
  const [qr, setQr] = useState<QrCode | null>(null);
  const [restante, setRestante] = useState(RENOVAR_EM);
  const [erro, setErro] = useState<string | null>(null);
  const [numeroConectado, setNumeroConectado] = useState<string | null>(null);
  const [modoPareamento, setModoPareamento] = useState(false);

  const queryClient = useQueryClient();
  const { inscrever } = useEventStream();
  const timerRef = useRef<number | null>(null);

  const buscarQr = useCallback(async () => {
    try {
      const resultado = await api<QrCode>(`/admin/sessions/${sessao.id}/qr`);
      setQr(resultado);
      setRestante(RENOVAR_EM);
      setFase('aguardando');
      setErro(null);
    } catch (e) {
      if (e instanceof ApiError) {
        // 409 aqui costuma significar "já conectou" — o que é sucesso, não erro.
        if (e.status === 409 && e.problem.detail.includes('já está conectada')) {
          setFase('conectado');
          return;
        }
        setErro(e.message);
      } else {
        setErro('Não foi possível obter o QR code.');
      }
      setFase('erro');
    }
  }, [sessao.id]);

  // Escuta a conexão em tempo real: é o que faz o modal reagir no instante em
  // que o código é lido, em vez de deixar o usuário olhando para um QR usado.
  useEffect(() => {
    if (!aberto) return;

    return inscrever((evento: EventoAoVivo) => {
      if (evento.sessionId !== sessao.id) return;

      const status = evento.data.status as string | undefined;
      if (status === 'WORKING' || evento.type === 'session.connected') {
        setNumeroConectado((evento.data.phoneNumber as string) ?? null);
        setFase('conectado');
        void queryClient.invalidateQueries({ queryKey: ['sessoes'] });
      }
    });
  }, [aberto, inscrever, sessao.id, queryClient]);

  // Ciclo de renovação.
  useEffect(() => {
    if (!aberto || fase === 'conectado' || modoPareamento) return;

    if (fase === 'carregando') void buscarQr();

    if (fase !== 'aguardando') return;

    timerRef.current = window.setInterval(() => {
      setRestante((segundos) => {
        if (segundos <= 1) {
          void buscarQr();
          return RENOVAR_EM;
        }
        return segundos - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [aberto, fase, buscarQr, modoPareamento]);

  // Rede de segurança: se o evento SSE se perder, a consulta periódica percebe.
  useEffect(() => {
    if (!aberto || fase === 'conectado') return;

    const intervalo = setInterval(() => {
      void api<Sessao>(`/admin/sessions/${sessao.id}`)
        .then((atual) => {
          if (atual.status === 'WORKING') {
            setNumeroConectado(atual.phoneNumber);
            setFase('conectado');
            void queryClient.invalidateQueries({ queryKey: ['sessoes'] });
          }
        })
        .catch(() => undefined);
    }, 5000);

    return () => clearInterval(intervalo);
  }, [aberto, fase, sessao.id, queryClient]);

  useEffect(() => {
    if (aberto) {
      setFase('carregando');
      setQr(null);
      setErro(null);
      setNumeroConectado(null);
      setModoPareamento(false);
    }
  }, [aberto]);

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={aoFechar}
      titulo={fase === 'conectado' ? 'Número conectado' : 'Conectar número'}
      descricao={
        fase === 'conectado' ? undefined : `Sessão "${sessao.label ?? sessao.id.slice(0, 8)}"`
      }
      largura="max-w-md"
      rodape={
        fase === 'conectado' ? (
          <Botao onClick={aoFechar}>Concluir</Botao>
        ) : (
          <>
            <Botao variante="fantasma" onClick={() => setModoPareamento((v) => !v)}>
              {modoPareamento ? 'Usar QR code' : 'Usar código de pareamento'}
            </Botao>
            <Botao variante="secundario" onClick={aoFechar}>
              Fechar
            </Botao>
          </>
        )
      }
    >
      {fase === 'conectado' ? (
        <Conectado numero={numeroConectado ?? sessao.phoneNumber} />
      ) : modoPareamento ? (
        <Pareamento sessaoId={sessao.id} />
      ) : (
        <AreaQr fase={fase} qr={qr} erro={erro} restante={restante} aoTentarDeNovo={buscarQr} />
      )}
    </Dialogo>
  );
}

function AreaQr({
  fase,
  qr,
  erro,
  restante,
  aoTentarDeNovo,
}: {
  fase: Fase;
  qr: QrCode | null;
  erro: string | null;
  restante: number;
  aoTentarDeNovo: () => void;
}) {
  if (fase === 'erro') {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <p className="text-sm text-[var(--erro)]">{erro}</p>
        <Botao variante="secundario" onClick={aoTentarDeNovo}>
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </Botao>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <ol className="w-full space-y-1 text-sm text-[var(--texto-suave)]">
        <li>1. Abra o WhatsApp no celular</li>
        <li>
          2. Toque em <strong className="text-[var(--texto)]">Aparelhos conectados</strong>
        </li>
        <li>
          3. Toque em <strong className="text-[var(--texto)]">Conectar aparelho</strong> e aponte
          para o código
        </li>
      </ol>

      <div className="relative flex h-[260px] w-[260px] items-center justify-center rounded-[var(--raio)] border bg-white p-3">
        {qr ? (
          <img
            src={`data:image/png;base64,${qr.imageBase64}`}
            alt="QR code para conectar o número"
            className="h-full w-full"
          />
        ) : (
          <Girando className="h-7 w-7 text-[var(--texto-fraco)]" />
        )}
      </div>

      {qr && (
        <div className="flex items-center gap-2 text-xs text-[var(--texto-fraco)]">
          <RefreshCw className="h-3 w-3" />
          <span>O código expira em instantes — renovando em {restante}s</span>
        </div>
      )}

      <p className="text-center text-xs text-[var(--texto-fraco)]">
        Esta tela detecta a conexão automaticamente. Não precisa recarregar.
      </p>
    </div>
  );
}

function Conectado({ numero }: { numero: string | null }) {
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--sucesso-suave)]">
        <CheckCircle2 className="h-7 w-7 text-[var(--sucesso)]" />
      </div>
      <div>
        <p className="font-medium">Pronto! O número está conectado.</p>
        {numero && (
          <p className="mt-1 font-mono text-lg text-[var(--texto)]">{formatarTelefone(numero)}</p>
        )}
      </div>
      <p className="max-w-xs text-xs text-[var(--texto-fraco)]">
        A partir de agora este número pode enviar e receber mensagens pela API.
      </p>
    </div>
  );
}

function Pareamento({ sessaoId }: { sessaoId: string }) {
  const [telefone, setTelefone] = useState('');
  const [codigo, setCodigo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function solicitar() {
    setCarregando(true);
    setErro(null);

    try {
      const r = await api<{ code: string }>(`/admin/sessions/${sessaoId}/pairing-code`, {
        method: 'POST',
        body: { phoneNumber: telefone.replace(/\D/g, '') },
      });
      setCodigo(r.code);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível gerar o código.');
    } finally {
      setCarregando(false);
    }
  }

  if (codigo) {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <Smartphone className="h-8 w-8 text-[var(--texto-fraco)]" />
        <div>
          <p className="text-sm text-[var(--texto-suave)]">Digite este código no celular:</p>
          <p className="mt-2 font-mono text-3xl font-semibold tracking-[0.2em]">{codigo}</p>
        </div>
        <p className="max-w-xs text-xs text-[var(--texto-fraco)]">
          No WhatsApp: Aparelhos conectados → Conectar aparelho → Conectar com número de telefone.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <Campo
        rotulo="Número do WhatsApp"
        placeholder="5511999999999"
        value={telefone}
        onChange={(e) => setTelefone(e.target.value)}
        dica="Com código do país, apenas dígitos."
        erro={erro ?? undefined}
      />
      <Botao onClick={() => void solicitar()} carregando={carregando} disabled={!telefone}>
        Gerar código
      </Botao>
    </div>
  );
}
