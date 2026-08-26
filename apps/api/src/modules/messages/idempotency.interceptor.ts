import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, of, switchMap, tap } from 'rxjs';

import { MessagesService } from './messages.service';

import type { SendResultDto } from './dto/send.dto';
import type { Request, Response } from 'express';

/**
 * Suporte ao header `Idempotency-Key`.
 *
 * Este é o par necessário da decisão de **não retentar envios automaticamente**
 * (tarefa 07). Sem ele, o integrador que sofre um timeout fica sem saída: repetir
 * arrisca duplicar a mensagem no aparelho do destinatário, não repetir arrisca
 * perdê-la. Com a chave, repetir é seguro.
 *
 * O fluxo tem três estados no Redis:
 *   ausente   -> reserva (SET NX) e segue
 *   PENDING   -> uma requisição concorrente está em voo: 409
 *   resultado -> devolve o original, com `Idempotency-Replayed: true`
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly messages: MessagesService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const chave = request.headers['idempotency-key'];
    const applicationId = request.apiKey?.application.id;

    if (typeof chave !== 'string' || !chave.trim() || !applicationId) {
      return next.handle();
    }

    const chaveLimpa = chave.trim().slice(0, 200);

    return from(this.messages.buscarIdempotente(chaveLimpa, applicationId)).pipe(
      switchMap((existente) => {
        if (existente === 'em-andamento') {
          throw new ConflictException(
            'Já existe uma requisição em andamento com esta Idempotency-Key. ' +
              'Aguarde a conclusão antes de repetir.',
          );
        }

        if (existente) {
          response.setHeader('Idempotency-Replayed', 'true');
          return of(existente);
        }

        return from(this.messages.reservarIdempotencia(chaveLimpa, applicationId)).pipe(
          switchMap((reservou) => {
            if (!reservou) {
              throw new ConflictException(
                'Já existe uma requisição em andamento com esta Idempotency-Key.',
              );
            }

            return next.handle().pipe(
              tap({
                next: (resultado) => {
                  void this.messages.registrarIdempotencia(
                    chaveLimpa,
                    applicationId,
                    resultado as SendResultDto,
                  );
                },
                // A liberação depende de a não-entrega ser CERTA.
                //
                // Erro de validação, sessão desconectada, destinatário inválido:
                // nada saiu, o integrador corrige e repete com a mesma chave.
                // Liberar é o comportamento útil.
                //
                // Timeout ou erro de conexão: a entrega é INCERTA — pode ter
                // chegado com a resposta perdida. Manter a chave reservada é o
                // que impede que um retry duplique a mensagem no aparelho do
                // destinatário, que é justamente o dano que a idempotência
                // existe para evitar.
                error: (erro: unknown) => {
                  if (naoEntregaCerta(erro)) {
                    void this.messages.liberarIdempotencia(chaveLimpa, applicationId);
                  }
                },
              }),
            );
          }),
        );
      }),
    );
  }
}

/**
 * Distingue falhas em que a mensagem certamente **não** saiu.
 *
 * Erros 4xx do gateway (validação, sessão desconectada, destinatário inválido)
 * acontecem antes de qualquer byte chegar ao WhatsApp. Já um timeout ou falha de
 * conexão deixa a entrega em aberto — e nesse caso a chave permanece reservada,
 * porque repetir poderia duplicar a mensagem.
 */
function naoEntregaCerta(erro: unknown): boolean {
  if (erro instanceof HttpException) {
    const status = erro.getStatus();
    return status >= 400 && status < 500 && status !== 408 && status !== 429;
  }

  const status = (erro as { status?: number })?.status;
  if (typeof status === 'number') {
    return status >= 400 && status < 500 && status !== 408 && status !== 429;
  }

  return false;
}
