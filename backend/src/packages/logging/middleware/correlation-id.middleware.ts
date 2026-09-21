import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { RequestContextService } from '../context/request-context.service.js';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly contextService: RequestContextService) {}

  public use(req: FastifyRequest['raw'], res: FastifyReply['raw'], next: () => void): void {
    const headerVal = req.headers['x-correlation-id'];
    const correlationId = (Array.isArray(headerVal) ? headerVal[0] : headerVal) || randomUUID();

    res.setHeader('x-correlation-id', correlationId);

    this.contextService.run({ correlationId }, () => {
      next();
    });
  }
}
