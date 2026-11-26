import type { Cluster, ClusterNode, ClusterOptions, Redis, RedisOptions } from 'ioredis';

/** Factory tạo client Redis — test có thể override bằng ioredis-mock. */
export const REDIS_CLIENT_FACTORY = Symbol('REDIS_CLIENT_FACTORY');

export type RedisClientFactory = (options: RedisOptions) => Redis;

/** Factory tạo client Redis Cluster — tách riêng để giữ tương thích 100% với `REDIS_CLIENT_FACTORY` mock. */
export const REDIS_CLUSTER_FACTORY = Symbol('REDIS_CLUSTER_FACTORY');

export type RedisClusterFactory = (nodes: ClusterNode[], options: ClusterOptions) => Cluster;
