export const TRACING_OPTIONS = Symbol('TRACING_OPTIONS');

export const TRACING_INSTRUMENTATION_NAME = 'core-framework';

export const TRACING_STREAM_PREFIX = 'traces';

export const SPAN_CATEGORY_ATTR = 'core.span.category';

export type SpanCategory = 'api' | 'db' | 'http' | 'job' | 'usecase' | 'internal';
