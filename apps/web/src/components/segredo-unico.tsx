import { AlertTriangle, Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { Botao, Dialogo } from '@/components/ui';
import { copiar } from '@/lib/utils';

/**
 * Exibição única de um segredo.
 *
 * Esta é a tela mais delicada do painel: o valor **não é recuperável**. Fechar
 * sem copiar significa perder a credencial e ter que emitir outra.
 *
 * Por isso o diálogo é travado — não fecha ao clicar fora nem com Esc — e o
 * botão de concluir só libera depois da confirmação explícita. Um fechamento
 * acidental aqui custa trabalho real ao usuário.
 */
export function DialogoSegredoUnico({
  aberto,
  aoFechar,
  titulo,
  segredo,
  aviso,
  instrucao,
}: {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  segredo: string;
  aviso: string;
  instrucao?: string;
}) {
  const [copiado, setCopiado] = useState(false);
  const [confirmou, setConfirmou] = useState(false);

  async function aoCopiar() {
    if (await copiar(segredo)) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    }
  }

  function fechar() {
    setCopiado(false);
    setConfirmou(false);
    aoFechar();
  }

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={fechar}
      titulo={titulo}
      travado
      largura="max-w-xl"
      rodape={
        <Botao onClick={fechar} disabled={!confirmou}>
          Concluir
        </Botao>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2.5 rounded-[var(--raio)] bg-[var(--alerta-suave)] p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--alerta)]" />
          <p className="text-sm text-[var(--texto)]">{aviso}</p>
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 rounded-t-[var(--raio)] border border-b-0 bg-[var(--superficie-2)] px-3 py-2">
            <span className="text-xs text-[var(--texto-suave)]">Copie e guarde agora</span>
            <Botao
              tamanho="sm"
              variante={copiado ? 'secundario' : 'primario'}
              onClick={() => void aoCopiar()}
            >
              {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiado ? 'Copiado' : 'Copiar'}
            </Botao>
          </div>

          <p className="select-all break-all rounded-b-[var(--raio)] border bg-[var(--superficie)] p-3 font-mono text-sm">
            {segredo}
          </p>
        </div>

        {instrucao && <p className="text-xs text-[var(--texto-suave)]">{instrucao}</p>}

        <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--raio)] border p-3">
          <input
            type="checkbox"
            checked={confirmou}
            onChange={(e) => setConfirmou(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primaria)]"
          />
          <span className="text-sm">
            Guardei este valor em local seguro. Entendo que ele{' '}
            <strong>não poderá ser exibido novamente</strong>.
          </span>
        </label>
      </div>
    </Dialogo>
  );
}
