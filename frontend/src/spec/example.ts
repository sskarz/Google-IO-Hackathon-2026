import type { Spec } from './schema'

// A representative spec that covers most node types and all edge kinds.
// Used to develop the renderer without depending on Gemini.
export const exampleSpec: Spec = {
  metadata: {
    name: 'E-commerce backbone',
    description: 'Demonstrates client + edge + service + storage + async tiers',
  },
  nodes: [
    { id: 'users', type: 'client', label: 'Users' },
    { id: 'cdn', type: 'cdn', subtype: 'cloudfront', label: 'CDN' },
    { id: 'lb', type: 'load_balancer', label: 'Load Balancer' },
    { id: 'gateway', type: 'api_gateway', label: 'API Gateway' },
    { id: 'api', type: 'service', label: 'Orders API', replicas: 3 },
    { id: 'cache', type: 'cache', subtype: 'redis', label: 'Cache' },
    { id: 'db_primary', type: 'database', subtype: 'postgres', label: 'Postgres (primary)' },
    { id: 'db_replica', type: 'database', subtype: 'postgres', label: 'Postgres (replica)' },
    { id: 'events', type: 'stream', subtype: 'kafka', label: 'Events' },
    { id: 'worker', type: 'worker', label: 'Order Worker', replicas: 2 },
    { id: 'jobs', type: 'queue', subtype: 'sqs', label: 'Jobs' },
    { id: 'blobs', type: 'object_store', subtype: 's3', label: 'Receipts' },
    { id: 'search', type: 'search_index', subtype: 'opensearch', label: 'Catalog Search' },
    { id: 'stripe', type: 'external', label: 'Stripe' },
  ],
  edges: [
    { id: 'users_to_cdn', from: 'users', to: 'cdn', kind: 'sync', protocol: 'http' },
    { id: 'cdn_to_lb', from: 'cdn', to: 'lb', kind: 'sync', protocol: 'http' },
    { id: 'lb_to_gateway', from: 'lb', to: 'gateway', kind: 'sync', protocol: 'http' },
    { id: 'gateway_to_api', from: 'gateway', to: 'api', kind: 'sync', protocol: 'http' },
    { id: 'api_to_cache', from: 'api', to: 'cache', kind: 'sync', protocol: 'redis' },
    { id: 'api_to_db', from: 'api', to: 'db_primary', kind: 'sync', protocol: 'sql' },
    { id: 'api_to_search', from: 'api', to: 'search', kind: 'sync', protocol: 'http' },
    { id: 'api_to_stripe', from: 'api', to: 'stripe', kind: 'sync', protocol: 'http' },
    { id: 'db_replication', from: 'db_primary', to: 'db_replica', kind: 'replication', protocol: 'sql' },
    { id: 'api_to_events', from: 'api', to: 'events', kind: 'async', protocol: 'kafka' },
    { id: 'events_to_worker', from: 'events', to: 'worker', kind: 'async', protocol: 'kafka' },
    { id: 'worker_to_jobs', from: 'worker', to: 'jobs', kind: 'async', protocol: 'sqs' },
    { id: 'worker_to_blobs', from: 'worker', to: 'blobs', kind: 'data_flow', protocol: 'http' },
  ],
}
