import { MessageSquare } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Botao, Campo, Cartao } from '@/components/ui';
import { ApiError, entrar } from '@/lib/api';

export function Login({ aoEntrar }: { aoEntrar: () => void }) {
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setCarregando(true);

    try {
      await entrar(usuario, senha);
      aoEntrar();
    } catch (e) {
      // A API não distingue usuário de senha errados de propósito; repassamos a
      // mensagem dela em vez de inventar outra.
      setErro(
        e instanceof ApiError
          ? e.status === 429
            ? 'Muitas tentativas. Aguarde alguns minutos antes de tentar de novo.'
            : e.message
          : 'Não foi possível conectar ao servidor.',
      );
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--fundo)] p-4">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-[calc(var(--raio)*1.4)] bg-[var(--primaria)] text-[var(--primaria-texto)]">
            <MessageSquare className="h-6 w-6" />
          </div>
          <div className="text-center">
            <h1 className="text-lg font-semibold tracking-tight">Gateway W51</h1>
            <p className="mt-0.5 text-sm text-[var(--texto-suave)]">
              Painel de administração do WhatsApp
            </p>
          </div>
        </div>

        <Cartao className="p-6">
          <form onSubmit={enviar} className="flex flex-col gap-4">
            <Campo
              rotulo="Usuário"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />

            <Campo
              rotulo="Senha"
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
              required
            />

            {erro && (
              <div
                className="rounded-[var(--raio)] bg-[var(--erro-suave)] px-3 py-2.5 text-sm text-[var(--erro)]"
                role="alert"
              >
                {erro}
              </div>
            )}

            <Botao type="submit" carregando={carregando} className="mt-1 w-full">
              Entrar
            </Botao>
          </form>
        </Cartao>

        <p className="mt-5 text-center text-xs text-[var(--texto-fraco)]">
          As credenciais são definidas em <code className="font-mono">ADMIN_USERNAME</code> e{' '}
          <code className="font-mono">ADMIN_PASSWORD</code> no arquivo <code>.env</code>.
        </p>
      </div>
    </div>
  );
}
