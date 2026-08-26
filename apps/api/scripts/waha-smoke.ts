import { config } from 'dotenv';

config({ path: '../../.env' });

/**
 * Smoke real contra o WAHA de desenvolvimento.
 *
 * Diferente dos testes unitários (que dublam o transporte), este exercita o
 * serviço de verdade: cria uma sessão, espera o QR e limpa tudo. Serve para
 * confirmar que o contrato tipado corresponde ao que o WAHA realmente devolve.
 */
async function main() {
  const { WahaClient } = await import('../src/modules/waha/waha.client');

  const cfg = {
    get: (k: string) =>
      ({
        WAHA_BASE_URL: process.env.WAHA_BASE_URL,
        WAHA_API_KEY: process.env.WAHA_API_KEY,
        WAHA_TIMEOUT_MS: 15000,
      })[k],
  };

  const client = new WahaClient(cfg as never);
  const nome = `smoke-${Date.now().toString(36)}`;

  console.log('1. health check');
  console.log('   ->', (await client.healthCheck()) ? 'WAHA no ar' : 'FORA DO AR');

  console.log('2. listar sessões');
  console.log('   ->', (await client.listSessions()).length, 'sessão(ões)');

  console.log(`3. criar sessão "${nome}" com metadata de rastreio`);
  const criada = await client.createSession({
    name: nome,
    start: true,
    config: {
      metadata: { 'application.id': 'smoke', 'gateway.session.id': 'teste' },
      noweb: { store: { enabled: true, fullSync: false } },
    },
  });
  console.log('   -> status', criada.status, '| engine', criada.engine?.engine);

  console.log('4. esperar SCAN_QR_CODE');
  let status = criada.status;
  for (let i = 0; i < 20 && status !== 'SCAN_QR_CODE'; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    status = (await client.getSession(nome)).status;
  }
  console.log('   -> status', status);

  if (status === 'SCAN_QR_CODE') {
    console.log('5. obter QR');
    const qr = await client.getQrValue(nome);
    console.log('   -> valor:', qr.value.slice(0, 55) + '...');

    const png = await client.getQrImage(nome);
    console.log(
      '   -> imagem:',
      png.length,
      'bytes, PNG:',
      png.subarray(1, 4).toString() === 'PNG',
    );

    console.log('6. metadata voltou intacto?');
    const s = await client.getSession(nome);
    console.log('   ->', JSON.stringify(s.config?.metadata));
  }

  console.log('7. erro esperado: sessão inexistente');
  await client.getSession('nao-existe-mesmo').catch((e: Error) => {
    console.log('   ->', e.constructor.name, '|', e.message);
  });

  console.log('8. limpar');
  await client.deleteSession(nome);
  console.log('   -> sessão removida');
}

main().catch((e) => {
  console.error('smoke falhou:', e);
  process.exitCode = 1;
});
