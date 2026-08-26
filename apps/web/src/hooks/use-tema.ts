import { useCallback, useEffect, useState } from 'react';

type Tema = 'claro' | 'escuro' | 'sistema';

const CHAVE = 'gateway.tema';

/**
 * Tema com três estados.
 *
 * "Sistema" é o padrão e acompanha a preferência do sistema operacional em tempo
 * real — não só na carga. Escolher explicitamente claro ou escuro grava a
 * preferência.
 */
export function useTema(): { tema: Tema; definir: (tema: Tema) => void; escuro: boolean } {
  const [tema, setTema] = useState<Tema>(() => {
    try {
      return (localStorage.getItem(CHAVE) as Tema | null) ?? 'sistema';
    } catch {
      return 'sistema';
    }
  });

  const [escuro, setEscuro] = useState(false);

  useEffect(() => {
    const consulta = window.matchMedia('(prefers-color-scheme: dark)');

    const aplicar = () => {
      const usarEscuro = tema === 'escuro' || (tema === 'sistema' && consulta.matches);
      document.documentElement.classList.toggle('dark', usarEscuro);
      setEscuro(usarEscuro);
    };

    aplicar();
    consulta.addEventListener('change', aplicar);

    return () => consulta.removeEventListener('change', aplicar);
  }, [tema]);

  const definir = useCallback((novo: Tema) => {
    setTema(novo);
    try {
      if (novo === 'sistema') localStorage.removeItem(CHAVE);
      else localStorage.setItem(CHAVE, novo);
    } catch {
      /* storage indisponível: vale só para esta sessão */
    }
  }, []);

  return { tema, definir, escuro };
}
