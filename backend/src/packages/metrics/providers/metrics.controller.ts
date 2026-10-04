import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Public } from '@packages/http/index.js';
import { MetricsRegistryService } from './metrics-registry.service.js';

/** `GET /api/v1/metrics` cho Prometheus scrape. Production chặn đường dẫn này ở nginx. */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsRegistryService) {}

  @Public()
  @Get()
  public async scrape(@Res() reply: FastifyReply): Promise<void> {
    const body = await this.metrics.metrics();
    await reply.header('Content-Type', this.metrics.contentType).send(body);
  }
}
