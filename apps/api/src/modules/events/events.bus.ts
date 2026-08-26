import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Observable, Subject, filter, map } from 'rxjs';

import { AppConfig } from '../../config';

const CANAL = 'gateway:events';

export interface EventoAoVivo {
  type: string;
  applicationId?: string;
  sessionId?: string;
  data: unknown;
  at: string;
}

/**
 * Barramento de eventos ao vivo.
 *
 * Usa **Redis pub/sub**, não um Subject local: com mais de uma instância da API,
 * um evento processado na instância A precisa chegar ao painel conectado à
 * instância B. Um barramento em memória funcionaria em desenvolvimento e falharia
 * silenciosamente ao escalar — o pior tipo de bug.
 *
 * O ioredis exige uma conexão dedicada para subscribe: uma conexão em modo
 * assinante não aceita outros comandos, e a principal serve cache e filas.
 */
@Injectable()
export class EventsBus implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsBus.name);
  private readonly stream = new Subject<EventoAoVivo>();

  private publisher!: Redis;
  private subscriber!: Redis;

  constructor(private readonly config: AppConfig) {}

  onModuleInit(): void {
    const url = this.config.get('REDIS_URL');

    this.publisher = new Redis(url, { maxRetriesPerRequest: null });
    this.subscriber = new Redis(url, { maxRetriesPerRequest: null });

    this.subscriber.subscribe(CANAL).catch((erro: unknown) => {
      this.logger.warn(`Não foi possível assinar ${CANAL}: ${String(erro)}`);
    });

    this.subscriber.on('message', (_canal, mensagem) => {
      try {
        this.stream.next(JSON.parse(mensagem) as EventoAoVivo);
      } catch {
        this.logger.warn('Evento recebido no barramento não é JSON válido');
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.stream.complete();
    await this.publisher?.quit().catch(() => undefined);
    await this.subscriber?.quit().catch(() => undefined);
  }

  /** Publica um evento. Falha aqui nunca propaga — é sinalização, não dado. */
  publicar(evento: Omit<EventoAoVivo, 'at'>): void {
    const completo: EventoAoVivo = { ...evento, at: new Date().toISOString() };

    void this.publisher
      ?.publish(CANAL, JSON.stringify(completo))
      .catch((erro: unknown) => this.logger.debug(`Falha ao publicar evento: ${String(erro)}`));
  }

  /** Fluxo para o painel — vê tudo. */
  todos(): Observable<EventoAoVivo> {
    return this.stream.asObservable();
  }

  /** Fluxo restrito a uma aplicação — é o que o integrador consome. */
  daAplicacao(applicationId: string, sessionId?: string): Observable<EventoAoVivo> {
    return this.stream.asObservable().pipe(
      filter((e) => e.applicationId === applicationId),
      filter((e) => !sessionId || e.sessionId === sessionId),
    );
  }

  /** Heartbeat: proxies costumam encerrar conexões ociosas em 30–60 s. */
  static comHeartbeat<T>(fonte: Observable<T>): Observable<T | { type: 'heartbeat' }> {
    return fonte.pipe(map((v) => v));
  }
}
