import type { TracedOptions } from '../contracts/tracing.types.js';
import { runInSpan } from '../utils/span.util.js';

/**
 * Bọc Use Case / Service method trong một OpenTelemetry span (`core.span.category = 'usecase'`).
 * Không tự động ghi tham số đầu vào để tránh rò rỉ dữ liệu nhạy cảm.
 */
export function Traced(spanName?: string, options?: TracedOptions): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const original = descriptor.value;
    if (typeof original !== 'function') {
      return descriptor;
    }

    const className =
      typeof target === 'function' ? target.name : (target.constructor?.name ?? 'UnknownService');
    const methodName = String(propertyKey);
    const resolvedName = spanName?.trim() || `${className}.${methodName}`;

    const wrapped = function (this: unknown, ...args: unknown[]): unknown {
      return runInSpan(
        resolvedName,
        {
          category: options?.category ?? 'usecase',
          attributes: {
            'code.namespace': className,
            'code.function': methodName,
            ...(options?.attributes ?? {}),
          },
        },
        () => (original as (...a: unknown[]) => unknown).apply(this, args),
      );
    };

    for (const metaKey of Reflect.getMetadataKeys(original)) {
      const metaValue: unknown = Reflect.getMetadata(metaKey, original);
      Reflect.defineMetadata(metaKey, metaValue, wrapped);
    }

    Object.defineProperty(wrapped, 'name', { value: methodName, configurable: true });
    (descriptor as PropertyDescriptor).value = wrapped;
    return descriptor;
  };
}
