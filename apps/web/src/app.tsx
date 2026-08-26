import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { Layout } from '@/components/layout';
import { Girando, ProvedorDeAvisos } from '@/components/ui';
import { ApiError, aoPerderSessao, restaurarSessao, sessao } from '@/lib/api';
import { Rotas } from '@/routes';
import { Login } from '@/routes/login';

/**
 * Cliente de dados.
 *
 * `retry` ignora 4xx: repetir uma requisição malformada ou não autorizada não
 * muda o resultado, só atrasa a mensagem de erro que o usuário precisa ver.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (tentativa, erro) => {
        if (erro instanceof ApiError && erro.status >= 400 && erro.status < 500) return false;
        return tentativa < 2;
      },
    },
  },
});

export function App() {
  const [estado, setEstado] = useState<'verificando' | 'entrada' | 'painel'>('verificando');
  const [rota, setRota] = useState(() => window.location.hash.slice(1) || '/');

  // Roteamento por hash: sem servidor de rotas, funciona em qualquer hospedagem
  // e sobrevive a recarregar em rota interna sem configuração de fallback.
  useEffect(() => {
    const aoMudar = () => setRota(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', aoMudar);
    return () => window.removeEventListener('hashchange', aoMudar);
  }, []);

  const navegar = useCallback((para: string) => {
    window.location.hash = para;
  }, []);

  useEffect(() => {
    void restaurarSessao().then((ok) => setEstado(ok ? 'painel' : 'entrada'));
  }, []);

  // A sessão pode acabar durante o uso (refresh expirado, token revogado).
  useEffect(() => {
    const aoPerder = () => {
      sessao.limpar();
      queryClient.clear();
      setEstado('entrada');
    };

    aoPerderSessao.addEventListener('perdida', aoPerder);
    return () => aoPerderSessao.removeEventListener('perdida', aoPerder);
  }, []);

  if (estado === 'verificando') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Girando className="h-6 w-6 text-[var(--texto-fraco)]" />
      </div>
    );
  }

  if (estado === 'entrada') {
    return <Login aoEntrar={() => setEstado('painel')} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ProvedorDeAvisos>
        <Layout rota={rota} navegar={navegar}>
          <Rotas rota={rota} navegar={navegar} />
        </Layout>
      </ProvedorDeAvisos>
    </QueryClientProvider>
  );
}
