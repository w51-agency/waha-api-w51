import { createServer } from 'node:http';

import { config } from 'dotenv';

config({ path: '../../.env' });

/**
 * Receptor de teste para os webhooks de saída.
 *
 * Faz o que o sistema do integrador faria: recebe a entrega, verifica a
 * assinatura e imprime o resultado. Serve tanto para validar a implementação
 * quanto de exemplo executável do snippet publicado na documentação.
 *
 * Uso:
 *   tsx scripts/webhook-receiver.ts <segredo-do-endpoint> [porta]
 *
 * Como o WAHA e a API rodam em container e no host respectivamente, use
 * http://host.docker.internal:<porta>/hook ao cadastrar o endpoint em dev.
 */

const segredo = process.argv[2];
const porta = Number(process.argv[3] ?? 4444);

if (!segredo) {
  console.error('Informe o segredo do endpoint: tsx scripts/webhook-receiver.ts <segredo>');
  process.exit(1);
}

// --- Esta é exatamente a verificação publicada na documentação ---
async function verificar(corpo: string, header: string, segredo: string): Promise<boolean> {
  const { createHmac, timingSafeEqual } = await import('node:crypto');

  const partes = Object.fromEntries(
    header.split(',').map((p) => {
      const [k, ...r] = p.trim().split('=');
      return [k ?? '', r.join('=')];
    }),
  );

  const timestamp = Number(partes.t);
  const recebida = partes.v1 ?? '';

  // Recusa entregas antigas: é o que impede reenvio de uma requisição capturada.
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) {
    return false;
  }

  const esperada = createHmac('sha256', segredo).update(`${timestamp}.${corpo}`).digest('hex');
  const a = Buffer.from(esperada);
  const b = Buffer.from(recebida);

  return a.length === b.length && timingSafeEqual(a, b);
}

let recebidos = 0;

const servidor = createServer((req, res) => {
  let corpo = '';
  req.on('data', (c) => (corpo += c));

  req.on('end', () => {
    void (async () => {
      recebidos++;

      const assinatura = String(req.headers['x-gateway-signature'] ?? '');
      const valida = await verificar(corpo, assinatura, segredo);

      const evento = req.headers['x-gateway-event'];
      const tentativa = req.headers['x-gateway-attempt'];

      console.log(
        `[${recebidos}] ${evento} | assinatura ${valida ? 'VÁLIDA' : 'INVÁLIDA'} | tentativa ${tentativa}`,
      );

      try {
        const parsed = JSON.parse(corpo) as { session?: { phoneNumber?: string }; data?: unknown };
        if (parsed.session?.phoneNumber) console.log(`     número: ${parsed.session.phoneNumber}`);
        console.log(`     dados : ${JSON.stringify(parsed.data).slice(0, 120)}`);
      } catch {
        /* corpo não-JSON */
      }

      // Simula um endpoint fora do ar quando pedido, para exercitar as retentativas.
      if (process.env.RECEPTOR_FALHA === 'true') {
        res.writeHead(500).end('erro simulado');
        return;
      }

      res.writeHead(valida ? 200 : 401).end(valida ? 'ok' : 'assinatura inválida');
    })();
  });
});

servidor.listen(porta, () => {
  console.log(`Receptor ouvindo em http://localhost:${porta}/hook`);
  console.log(`Cadastre como: http://host.docker.internal:${porta}/hook`);
  console.log('');
});
