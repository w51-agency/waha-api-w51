import { MockAgent, setGlobalDispatcher } from 'undici';

/**
 * WAHA dublado.
 *
 * Usa o `MockAgent` do **undici**, não o MSW: o `WahaClient` chama
 * `undici.request()`, que contorna o módulo `http` do Node — que é justamente
 * onde o MSW se instala. O MockAgent intercepta no dispatcher global, que é o
 * caminho que o undici realmente percorre.
 *
 * Os testes e2e precisam ser determinísticos e rodar sem WhatsApp real. Este
 * dublê responde como o WAHA responde — inclusive nos erros, que é onde o
 * comportamento do gateway mais importa.
 */

const BASE = 'http://waha-mock.invalid:3000';

interface SessaoFalsa {
  name: string;
  status: string;
  config?: Record<string, unknown>;
  me?: { id: string; pushName: string } | null;
}

export const sessoesFalsas = new Map<string, SessaoFalsa>();

/** Permite um teste forçar a próxima chamada a falhar. */
export const controle = { falharProximoEnvio: false };

let agente: MockAgent | null = null;

/** PNG mínimo válido, para o teste conferir o cabeçalho. */
const PNG_MINIMO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Quantos interceptadores registrar por método a cada limpeza.
 *
 * Generoso de propósito: registrar de menos faz o teste falhar com
 * "Mock dispatch not matched", que não diz o que realmente aconteceu.
 */
const INTERCEPTADORES_POR_METODO = 300;

export function iniciarWahaMock(): void {
  agente = new MockAgent();
  agente.disableNetConnect();
  setGlobalDispatcher(agente);

  registrarInterceptadores();
}

/**
 * Registra os interceptadores.
 *
 * **Nem `.persist()` nem `.times(n)` servem aqui.** Os dois invocam o callback
 * de resposta **uma única vez** e reusam o resultado — verificado: três
 * requisições, um callback. Como este dublê responde a partir de estado mutável
 * (a sessão muda de SCAN_QR_CODE para WORKING no meio do teste), uma resposta
 * memoizada devolveria o estado antigo para sempre.
 *
 * A única forma de o callback ser reinvocado é registrar interceptadores
 * separados. Daí o laço.
 */
function registrarInterceptadores(): void {
  if (!agente) return;

  const pool = agente.get(BASE);

  for (let i = 0; i < INTERCEPTADORES_POR_METODO; i++) {
    pool
      .intercept({ path: /.*/, method: 'GET' })
      .reply(({ path }) => responder('GET', path, undefined));

    pool
      .intercept({ path: /.*/, method: 'POST' })
      .reply(({ path, body }) => responder('POST', path, body as string | undefined));

    pool
      .intercept({ path: /.*/, method: 'PUT' })
      .reply(({ path, body }) => responder('PUT', path, body as string | undefined));

    pool
      .intercept({ path: /.*/, method: 'DELETE' })
      .reply(({ path }) => responder('DELETE', path, undefined));
  }
}

export async function pararWahaMock(): Promise<void> {
  await agente?.close();
  agente = null;
}

/** Marca uma sessão como conectada, imitando o resultado de um QR escaneado. */
export function conectar(nome: string, numero = '5511988887777'): void {
  const sessao = sessoesFalsas.get(nome);
  if (!sessao) return;

  sessao.status = 'WORKING';
  sessao.me = { id: `${numero}@c.us`, pushName: 'Número de Teste' };
}

export function limparWahaMock(): void {
  sessoesFalsas.clear();
  controle.falharProximoEnvio = false;

  // Repõe os interceptadores consumidos pelo teste anterior.
  registrarInterceptadores();
}

// =============================================================================
//  Roteamento
// =============================================================================

interface Resposta {
  statusCode: number;
  data: unknown;
  responseOptions?: { headers: Record<string, string> };
}

function responder(metodo: string, caminho: string, corpo?: string): Resposta {
  const [rota, consulta] = caminho.split('?');
  const params = new URLSearchParams(consulta ?? '');
  const partes = (rota ?? '').split('/').filter(Boolean);

  // --- /health ---
  if (rota === '/health') return ok({ status: 'ok' });

  // --- /api/sessions ---
  if (rota === '/api/sessions') {
    if (metodo === 'GET') return ok([...sessoesFalsas.values()].map(serializar));

    if (metodo === 'POST') {
      const dto = JSON.parse(corpo ?? '{}') as SessaoFalsa;

      sessoesFalsas.set(dto.name, {
        name: dto.name,
        // O WAHA leva um instante em STARTING; os testes precisam de
        // SCAN_QR_CODE imediato para não dependerem de espera.
        status: 'SCAN_QR_CODE',
        config: dto.config,
        me: null,
      });

      return { statusCode: 201, data: serializar(sessoesFalsas.get(dto.name)!) };
    }
  }

  // --- /api/sessions/{nome}[/acao] ---
  if (partes[0] === 'api' && partes[1] === 'sessions' && partes[2]) {
    const nome = decodeURIComponent(partes[2]);
    const sessao = sessoesFalsas.get(nome);
    const acao = partes[3];

    if (!sessao) return naoEncontrado();

    if (acao === 'me') {
      return sessao.me ? ok(sessao.me) : naoEncontrado();
    }

    if (metodo === 'DELETE') {
      sessoesFalsas.delete(nome);
      return ok({ deleted: true });
    }

    if (metodo === 'POST' && acao) {
      const estados: Record<string, string> = {
        start: 'SCAN_QR_CODE',
        stop: 'STOPPED',
        restart: 'SCAN_QR_CODE',
        logout: 'SCAN_QR_CODE',
      };

      sessao.status = estados[acao] ?? sessao.status;
      if (acao === 'logout') sessao.me = null;

      return ok(serializar(sessao));
    }

    return ok(serializar(sessao));
  }

  // --- /api/{sessao}/auth/... ---
  if (partes[0] === 'api' && partes[2] === 'auth') {
    const nome = decodeURIComponent(partes[1] ?? '');
    if (!sessoesFalsas.has(nome)) return naoEncontrado();

    if (partes[3] === 'qr') {
      if (params.get('format') === 'image') {
        return {
          statusCode: 200,
          data: PNG_MINIMO,
          responseOptions: { headers: { 'content-type': 'image/png' } },
        };
      }
      return ok({ value: 'https://wa.me/settings/linked_devices#2@TESTE' });
    }

    if (partes[3] === 'request-code') return ok({ code: 'ABCD-EFGH' });
  }

  // --- /api/{sessao}/chats ---
  if (partes[0] === 'api' && partes[2] === 'chats') {
    return ok([{ id: '5511999999999@c.us', name: 'Contato', conversationTimestamp: 1 }]);
  }

  // --- /api/contacts/check-exists ---
  if (rota === '/api/contacts/check-exists') {
    return ok({ numberExists: true, chatId: '5511999999999@c.us' });
  }

  // --- envio ---
  if (rota?.startsWith('/api/send') || rota === '/api/reaction') {
    if (controle.falharProximoEnvio) {
      controle.falharProximoEnvio = false;
      return { statusCode: 422, data: { message: 'Session status is not as expected' } };
    }

    const dto = JSON.parse(corpo ?? '{}') as { chatId?: string };

    return ok({
      id: `true_${dto.chatId ?? 'x'}_${Math.random().toString(36).slice(2, 10)}`,
      timestamp: Math.floor(Date.now() / 1000),
      fromMe: true,
      ack: 1,
    });
  }

  return { statusCode: 404, data: { message: `rota não dublada: ${metodo} ${rota}` } };
}

const ok = (data: unknown): Resposta => ({ statusCode: 200, data });
const naoEncontrado = (): Resposta => ({ statusCode: 404, data: { message: 'not found' } });

function serializar(sessao: SessaoFalsa) {
  return {
    name: sessao.name,
    status: sessao.status,
    config: sessao.config,
    me: sessao.me,
    engine: { engine: 'NOWEB' },
  };
}
