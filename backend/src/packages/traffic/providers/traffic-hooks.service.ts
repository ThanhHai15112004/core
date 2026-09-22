import { Injectable, Logger, RequestMethod, type OnModuleInit } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, HttpAdapterHost, MetadataScanner } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';
import { CoreConfigService } from '@packages/config/index.js';
import { TrafficCollectorService } from './traffic-collector.service.js';

const toArray = (v: unknown): string[] =>
  v === undefined ? [] : (Array.isArray(v) ? v : [v]).map((x) => String(x));
const joinPath = (...parts: string[]) =>
  `/${parts
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')}`;

/**
 * Gắn hook Fastify ở tầng server → mọi route của mọi module (hiện tại và sau này) đều được đo,
 * kể cả request bị guard chặn (401/403) và 404. Module nghiệp vụ không cần import hay decorator gì.
 */
@Injectable()
export class TrafficHooksService implements OnModuleInit {
  private readonly logger = new Logger(TrafficHooksService.name);

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly collector: TrafficCollectorService,
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly config: CoreConfigService,
  ) {}

  public onModuleInit(): void {
    const fastify = this.adapterHost.httpAdapter?.getInstance<FastifyInstance>();
    if (!fastify || typeof fastify.addHook !== 'function') {
      this.logger.warn('HTTP adapter is not Fastify — traffic collection disabled');
      return;
    }
    const c = this.collector;
    // Lifecycle hook của Fastify được gắn vào route lúc `ready`, nên thêm ở đây vẫn áp dụng cho mọi route.
    fastify.addHook('onRequest', (req, _reply, done) => {
      c.start(req);
      done();
    });
    fastify.addHook('preHandler', (req, _reply, done) => {
      c.mark(req.raw, 'routed');
      c.keepRequestBody(req);
      done();
    });
    fastify.addHook('onSend', (req, _reply, payload, done) => {
      c.mark(req.raw, 'send');
      c.keepResponsePayload(req, payload);
      done(null, payload);
    });
    fastify.addHook('onResponse', (req, reply, done) => {
      c.finish(req, reply);
      done();
    });
    fastify.addHook('onRequestAbort', (req, done) => {
      c.finish(req, null);
      done();
    });
    fastify.addHook('onReady', (done) => {
      c.registerRoutes(this.discoverRoutes(fastify));
      done();
    });
  }

  /**
   * Tự phát hiện endpoint từ metadata controller của Nest. Global prefix có thể có hoặc không
   * (vd. test không đặt prefix) nên kiểm tra với Fastify xem biến thể nào thực sự tồn tại.
   */
  private discoverRoutes(fastify: FastifyInstance): { method: string; route: string }[] {
    const prefix = this.config.app.apiPrefix;
    const found: { method: string; route: string }[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const controllerPaths = toArray(Reflect.getMetadata(PATH_METADATA, metatype));
      const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
      for (const name of this.scanner.getAllMethodNames(proto)) {
        const handler = proto[name];
        if (typeof handler !== 'function') continue;
        const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as unknown;
        const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        if (methodPath === undefined || requestMethod === undefined) continue;
        const method = RequestMethod[requestMethod];
        if (!method || method === 'ALL') continue;
        for (const base of controllerPaths.length ? controllerPaths : ['']) {
          for (const sub of toArray(methodPath)) {
            const candidates = [joinPath(prefix, base, sub), joinPath(base, sub)];
            const route = candidates.find((url) =>
              fastify.hasRoute({ url, method: method as never }),
            );
            if (route) found.push({ method, route });
          }
        }
      }
    }
    return found;
  }
}
