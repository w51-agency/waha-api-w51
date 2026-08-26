import { useMemo, useState } from 'react';

import { cn, numero } from '@/lib/utils';

/**
 * Gráficos do painel.
 *
 * SVG à mão em vez de biblioteca: as formas necessárias são três, e uma
 * biblioteca de gráficos custaria ~350 kB no pacote para desenhar retângulos.
 * O controle direto também garante que a paleta validada seja aplicada como
 * está, sem tema intermediário reinterpretando as cores.
 *
 * A paleta vem de tokens CSS (`--serie-1`, `--funil-*`), validados contra as
 * superfícies reais do painel nos dois modos — ver o comentário em index.css.
 */

// =============================================================================
//  Série temporal
// =============================================================================

export interface PontoTemporal {
  bucket: string;
  inbound: number;
  outbound: number;
  total: number;
}

export function GraficoTemporal({
  dados,
  granularidade,
}: {
  dados: PontoTemporal[];
  granularidade: 'hour' | 'day';
}) {
  const [foco, setFoco] = useState<number | null>(null);

  const maximo = useMemo(
    () => Math.max(1, ...dados.map((d) => Math.max(d.inbound, d.outbound))),
    [dados],
  );

  if (dados.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-[var(--texto-fraco)]">
        Sem dados no período
      </div>
    );
  }

  const alturaGrafico = 180;
  const larguraColuna = 100 / dados.length;
  // Barras finas com folga: marcas grossas escondem a forma dos dados.
  const larguraBarra = Math.min(larguraColuna * 0.32, 3.2);
  const linhasDeGrade = escalaAgradavel(maximo);

  return (
    <div className="flex flex-col gap-3">
      <Legenda
        itens={[
          { cor: 'var(--serie-1)', rotulo: 'Recebidas' },
          { cor: 'var(--serie-2)', rotulo: 'Enviadas' },
        ]}
      />

      <div className="relative">
        {/* Eixo de valores */}
        <div
          className="absolute left-0 top-0 flex w-11 flex-col justify-between text-right text-[10px] text-[var(--eixo)]"
          style={{ height: alturaGrafico }}
          aria-hidden="true"
        >
          {[...linhasDeGrade].reverse().map((v) => (
            <span key={v} className="-translate-y-1/2 pr-2 leading-none first:translate-y-0">
              {numero(v)}
            </span>
          ))}
        </div>

        <div className="ml-11">
          <svg
            viewBox={`0 0 100 ${alturaGrafico}`}
            preserveAspectRatio="none"
            className="w-full"
            style={{ height: alturaGrafico }}
            role="img"
            aria-label={`Mensagens por ${granularidade === 'hour' ? 'hora' : 'dia'}`}
          >
            {/* Grade recessiva: orienta sem competir com os dados */}
            {linhasDeGrade.map((valor) => {
              const y =
                alturaGrafico - (valor / linhasDeGrade[linhasDeGrade.length - 1]!) * alturaGrafico;
              return (
                <line
                  key={valor}
                  x1="0"
                  x2="100"
                  y1={y}
                  y2={y}
                  stroke="var(--grade)"
                  strokeWidth="0.5"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}

            {dados.map((ponto, i) => {
              const centro = i * larguraColuna + larguraColuna / 2;
              const escala = linhasDeGrade[linhasDeGrade.length - 1]!;

              const alturaEntrada = (ponto.inbound / escala) * alturaGrafico;
              const alturaSaida = (ponto.outbound / escala) * alturaGrafico;

              return (
                <g key={ponto.bucket}>
                  {/* Área de captura maior que a marca, para o ponteiro não exigir precisão */}
                  <rect
                    x={i * larguraColuna}
                    y={0}
                    width={larguraColuna}
                    height={alturaGrafico}
                    fill={foco === i ? 'var(--superficie-2)' : 'transparent'}
                    onMouseEnter={() => setFoco(i)}
                    onMouseLeave={() => setFoco(null)}
                  />

                  {ponto.inbound > 0 && (
                    <rect
                      x={centro - larguraBarra - 0.35}
                      y={alturaGrafico - alturaEntrada}
                      width={larguraBarra}
                      height={alturaEntrada}
                      fill="var(--serie-1)"
                      rx="0.6"
                      className="pointer-events-none"
                    />
                  )}

                  {ponto.outbound > 0 && (
                    <rect
                      x={centro + 0.35}
                      y={alturaGrafico - alturaSaida}
                      width={larguraBarra}
                      height={alturaSaida}
                      fill="var(--serie-2)"
                      rx="0.6"
                      className="pointer-events-none"
                    />
                  )}
                </g>
              );
            })}
          </svg>

          {/* Rótulos do eixo temporal: só alguns, para não virar borrão */}
          <div className="mt-1.5 flex text-[10px] text-[var(--eixo)]">
            {dados.map((ponto, i) => (
              <span
                key={ponto.bucket}
                className="shrink-0 text-center"
                style={{ width: `${larguraColuna}%` }}
              >
                {deveRotular(i, dados.length) ? rotularBucket(ponto.bucket, granularidade) : ''}
              </span>
            ))}
          </div>
        </div>

        {foco !== null && dados[foco] && (
          <DicaFlutuante
            posicao={foco / dados.length}
            titulo={rotularBucketCompleto(dados[foco]!.bucket, granularidade)}
            linhas={[
              { cor: 'var(--serie-1)', rotulo: 'Recebidas', valor: dados[foco]!.inbound },
              { cor: 'var(--serie-2)', rotulo: 'Enviadas', valor: dados[foco]!.outbound },
              { rotulo: 'Total', valor: dados[foco]!.total },
            ]}
          />
        )}
      </div>
    </div>
  );
}

// =============================================================================
//  Funil de entrega
// =============================================================================

export function FunilDeEntrega({
  enviadas,
  entregues,
  lidas,
  falhas,
}: {
  enviadas: number;
  entregues: number;
  lidas: number;
  falhas: number;
}) {
  const total = enviadas + falhas;

  if (total === 0) {
    return (
      <p className="py-6 text-center text-sm text-[var(--texto-fraco)]">
        Nenhuma mensagem enviada no período
      </p>
    );
  }

  const etapas = [
    { rotulo: 'Enviadas', valor: enviadas, cor: 'var(--funil-1)' },
    { rotulo: 'Entregues', valor: entregues, cor: 'var(--funil-2)' },
    { rotulo: 'Lidas', valor: lidas, cor: 'var(--funil-3)' },
    { rotulo: 'Falharam', valor: falhas, cor: 'var(--erro)' },
  ];

  const maximo = Math.max(1, ...etapas.map((e) => e.valor));

  return (
    <div className="flex flex-col gap-2.5">
      {etapas.map((etapa) => (
        <div key={etapa.rotulo} className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-xs text-[var(--texto-suave)]">{etapa.rotulo}</span>

          <div className="h-5 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-[var(--superficie-2)]">
            <div
              className="h-full rounded-[3px] transition-[width] duration-500"
              style={{
                width: `${Math.max((etapa.valor / maximo) * 100, etapa.valor > 0 ? 1.5 : 0)}%`,
                background: etapa.cor,
              }}
            />
          </div>

          {/* Rótulo direto: satisfaz a regra de alívio de contraste da rampa
              clara e evita que o leitor precise medir a barra contra o eixo. */}
          <span className="w-24 shrink-0 text-right text-xs tabular-nums">
            <strong className="font-medium">{numero(etapa.valor)}</strong>
            <span className="ml-1 text-[var(--texto-fraco)]">
              {total > 0 ? `${((etapa.valor / total) * 100).toFixed(0)}%` : ''}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
//  Barras horizontais
// =============================================================================

export function BarrasHorizontais({
  itens,
  aoClicar,
}: {
  itens: Array<{ id: string; rotulo: string; valor: number; detalhe?: string }>;
  aoClicar?: (id: string) => void;
}) {
  if (itens.length === 0) {
    return <p className="py-6 text-center text-sm text-[var(--texto-fraco)]">Sem dados</p>;
  }

  const maximo = Math.max(1, ...itens.map((i) => i.valor));

  return (
    <div className="flex flex-col gap-2">
      {itens.map((item) => {
        const Elemento = aoClicar ? 'button' : 'div';

        return (
          <Elemento
            key={item.id}
            onClick={aoClicar ? () => aoClicar(item.id) : undefined}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-1 py-1 text-left',
              aoClicar && 'hover:bg-[var(--superficie-2)]',
            )}
          >
            <span className="w-32 shrink-0 truncate text-xs" title={item.rotulo}>
              {item.rotulo}
            </span>

            <div className="h-4 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-[var(--superficie-2)]">
              <div
                className="h-full rounded-[3px]"
                style={{
                  width: `${Math.max((item.valor / maximo) * 100, item.valor > 0 ? 1.5 : 0)}%`,
                  background: 'var(--serie-1)',
                }}
              />
            </div>

            <span className="w-16 shrink-0 text-right text-xs tabular-nums">
              {numero(item.valor)}
            </span>

            {item.detalhe && (
              <span className="hidden w-24 shrink-0 truncate text-right text-xs text-[var(--texto-fraco)] sm:block">
                {item.detalhe}
              </span>
            )}
          </Elemento>
        );
      })}
    </div>
  );
}

// =============================================================================
//  Peças de apoio
// =============================================================================

function Legenda({ itens }: { itens: Array<{ cor: string; rotulo: string }> }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      {itens.map((item) => (
        <span key={item.rotulo} className="flex items-center gap-1.5 text-xs">
          <span
            className="h-2 w-2 shrink-0 rounded-[2px]"
            style={{ background: item.cor }}
            aria-hidden="true"
          />
          {/* O texto usa cor de texto, nunca a da série: a marca ao lado é quem
              carrega a identidade. */}
          <span className="text-[var(--texto-suave)]">{item.rotulo}</span>
        </span>
      ))}
    </div>
  );
}

function DicaFlutuante({
  posicao,
  titulo,
  linhas,
}: {
  posicao: number;
  titulo: string;
  linhas: Array<{ cor?: string; rotulo: string; valor: number }>;
}) {
  const aDireita = posicao > 0.6;

  return (
    <div
      className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-[var(--raio)] border bg-[var(--superficie)] p-2.5 text-xs shadow-lg"
      style={aDireita ? { right: `${(1 - posicao) * 100}%` } : { left: `${posicao * 100}%` }}
    >
      <p className="mb-1.5 font-medium">{titulo}</p>
      {linhas.map((linha) => (
        <div key={linha.rotulo} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-[var(--texto-suave)]">
            {linha.cor && (
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: linha.cor }}
                aria-hidden="true"
              />
            )}
            {linha.rotulo}
          </span>
          <span className="tabular-nums">{numero(linha.valor)}</span>
        </div>
      ))}
    </div>
  );
}

/** Escala com valores redondos, para o eixo não mostrar "37" e "74". */
function escalaAgradavel(maximo: number): number[] {
  const passo = Math.pow(10, Math.floor(Math.log10(maximo)));
  const normalizado = maximo / passo;

  const multiplicador = normalizado <= 1 ? 1 : normalizado <= 2 ? 2 : normalizado <= 5 ? 5 : 10;
  const topo = multiplicador * passo;

  return [0, topo / 2, topo];
}

/** Rotula no máximo ~7 posições: mais que isso vira borrão ilegível. */
function deveRotular(indice: number, total: number): boolean {
  const intervalo = Math.max(1, Math.ceil(total / 7));
  return indice % intervalo === 0 || indice === total - 1;
}

function rotularBucket(bucket: string, granularidade: 'hour' | 'day'): string {
  if (granularidade === 'hour') return `${bucket.slice(11, 13)}h`;
  const [, mes, dia] = bucket.split('-');
  return `${dia}/${mes}`;
}

function rotularBucketCompleto(bucket: string, granularidade: 'hour' | 'day'): string {
  const data = new Date(granularidade === 'hour' ? bucket : `${bucket}T12:00:00Z`);

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    ...(granularidade === 'hour' ? { timeStyle: 'short' as const } : {}),
  }).format(data);
}
