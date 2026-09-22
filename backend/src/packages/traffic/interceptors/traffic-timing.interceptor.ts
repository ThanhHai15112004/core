import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { TrafficCollectorService } from '../providers/traffic-collector.service.js';

/** Đánh dấu mốc handler trong timeline (sau guard/pipe → trước/sau controller). */
@Injectable()
export class TrafficTimingInterceptor implements NestInterceptor {
  constructor(private readonly collector: TrafficCollectorService) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const raw = context.switchToHttp().getRequest<FastifyRequest>().raw;
    this.collector.mark(raw, 'handlerStart');
    return next.handle().pipe(finalize(() => this.collector.mark(raw, 'handlerEnd')));
  }
}
