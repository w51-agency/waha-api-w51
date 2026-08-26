/**
 * Cliente HTTP do painel.
 *
 * Sempre chama `/api` **relativo**. Em desenvolvimento o proxy do Vite
 * redireciona; em produção, o nginx. Congelar a URL da API no build (via
 * `VITE_API_URL`, por exemplo) obrigaria a reconstruir a imagem para trocar de
 * porta — exatamente o oposto do que o projeto exige.
 */

const BASE = '/api';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  requestId: string;
  errors?: Record<string, string[]>;
}

/** Erro que carrega o corpo RFC 7807 para a interface poder reagir ao `type`. */
export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail || problem.title);
    this.name = 'ApiError';
  }

  get status(): number {
    return this.problem.status;
  }

  /** Distingue "renove o token" de "faça login de novo". */
  get expirou(): boolean {
    return this.problem.type.endsWith('/token-expired');
  }
}

// =============================================================================
//  Sessão do painel
// =============================================================================

const CHAVE_REFRESH = 'gateway.refresh';

/**
 * O access token vive **em memória**, não em localStorage.
 *
 * Um token em localStorage é legível por qualquer script que consiga rodar na
 * página. Em memória, ele desaparece com a aba — o custo é reautenticar ao
 * abrir uma aba nova, o que o refresh token resolve em silêncio.
 */
let accessToken: string | null = null;

export const sessao = {
  get token(): string | null {
    return accessToken;
  },

  get refreshToken(): string | null {
    try {
      return localStorage.getItem(CHAVE_REFRESH);
    } catch {
      return null;
    }
  },

  definir(access: string, refresh: string): void {
    accessToken = access;
    try {
      localStorage.setItem(CHAVE_REFRESH, refresh);
    } catch {
      /* modo privado ou storage bloqueado: a sessão vale só para esta aba */
    }
  },

  limpar(): void {
    accessToken = null;
    try {
      localStorage.removeItem(CHAVE_REFRESH);
    } catch {
      /* nada a fazer */
    }
  },

  get autenticado(): boolean {
    return accessToken !== null || this.refreshToken !== null;
  },
};

// =============================================================================
//  Renovação com fila
// =============================================================================

/**
 * Renovação concorrente.
 *
 * A API rotaciona o refresh token e **derruba a família inteira** se um for
 * usado duas vezes (tarefa 06). Se dez requisições receberem 401 juntas e cada
 * uma disparar seu próprio refresh, a segunda seria interpretada como reuso e o
 * usuário perderia a sessão — um bug que aparece justamente quando a tela carrega
 * vários dados de uma vez.
 *
 * A promessa em voo é compartilhada: a primeira renova, as demais aguardam.
 */
let renovacaoEmVoo: Promise<boolean> | null = null;

async function renovar(): Promise<boolean> {
  renovacaoEmVoo ??= (async () => {
    try {
      const refresh = sessao.refreshToken;
      if (!refresh) return false;

      const resposta = await fetch(`${BASE}/admin/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      });

      if (!resposta.ok) {
        sessao.limpar();
        return false;
      }

      const dados = (await resposta.json()) as { accessToken: string; refreshToken: string };
      sessao.definir(dados.accessToken, dados.refreshToken);
      return true;
    } catch {
      sessao.limpar();
      return false;
    } finally {
      // Liberada no próximo tick para que quem entrou na fila veja o resultado.
      setTimeout(() => {
        renovacaoEmVoo = null;
      }, 0);
    }
  })();

  return renovacaoEmVoo;
}

/** Notifica a aplicação de que a sessão acabou, para redirecionar ao login. */
export const aoPerderSessao = new EventTarget();

// =============================================================================
//  Requisição
// =============================================================================

interface OpcoesRequisicao extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Uso interno: evita laço infinito de renovação. */
  jaRenovou?: boolean;
}

export async function api<T = unknown>(caminho: string, opcoes: OpcoesRequisicao = {}): Promise<T> {
  const { body, jaRenovou, headers, ...resto } = opcoes;

  const cabecalhos = new Headers(headers);
  if (sessao.token) cabecalhos.set('authorization', `Bearer ${sessao.token}`);

  let corpo: BodyInit | undefined;
  if (body instanceof FormData) {
    corpo = body;
  } else if (body !== undefined) {
    cabecalhos.set('content-type', 'application/json');
    corpo = JSON.stringify(body);
  }

  const resposta = await fetch(`${BASE}${caminho}`, { ...resto, headers: cabecalhos, body: corpo });

  if (resposta.status === 401 && !jaRenovou && sessao.refreshToken) {
    if (await renovar()) {
      return api<T>(caminho, { ...opcoes, jaRenovou: true });
    }

    aoPerderSessao.dispatchEvent(new Event('perdida'));
  }

  if (!resposta.ok) {
    throw new ApiError(await lerProblema(resposta));
  }

  if (resposta.status === 204) return undefined as T;

  const tipo = resposta.headers.get('content-type') ?? '';
  if (tipo.includes('application/json')) return (await resposta.json()) as T;

  return (await resposta.text()) as T;
}

/**
 * Lê o corpo de erro.
 *
 * Nem toda falha vem da API — um proxy caído devolve HTML, uma queda de rede não
 * devolve nada. Normalizar aqui garante que a interface sempre tenha um
 * `ProblemDetails` para exibir, em vez de quebrar ao ler `.detail` de undefined.
 */
async function lerProblema(resposta: Response): Promise<ProblemDetails> {
  try {
    const dados = (await resposta.json()) as Partial<ProblemDetails>;

    if (dados.detail || dados.title) {
      return {
        type: dados.type ?? 'about:blank',
        title: dados.title ?? 'Erro',
        status: dados.status ?? resposta.status,
        detail: dados.detail ?? dados.title ?? 'Ocorreu um erro.',
        instance: dados.instance ?? '',
        requestId: dados.requestId ?? '',
        errors: dados.errors,
      };
    }
  } catch {
    /* resposta não era JSON */
  }

  return {
    type: 'about:blank',
    title: 'Erro de comunicação',
    status: resposta.status,
    detail:
      resposta.status >= 500
        ? 'O servidor não conseguiu responder. Tente novamente em instantes.'
        : `A requisição falhou com código ${resposta.status}.`,
    instance: '',
    requestId: '',
  };
}

// =============================================================================
//  Autenticação
// =============================================================================

export async function entrar(username: string, password: string): Promise<void> {
  const resposta = await fetch(`${BASE}/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!resposta.ok) throw new ApiError(await lerProblema(resposta));

  const dados = (await resposta.json()) as { accessToken: string; refreshToken: string };
  sessao.definir(dados.accessToken, dados.refreshToken);
}

export async function sair(): Promise<void> {
  const refresh = sessao.refreshToken;
  sessao.limpar();

  if (refresh) {
    await fetch(`${BASE}/admin/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    }).catch(() => undefined);
  }
}

/**
 * Restaura a sessão ao abrir o painel.
 *
 * O access token não sobrevive ao recarregamento (vive em memória), mas o
 * refresh sim — então trocamos um pelo outro antes de decidir mostrar o login.
 */
export async function restaurarSessao(): Promise<boolean> {
  if (accessToken) return true;
  if (!sessao.refreshToken) return false;
  return renovar();
}
