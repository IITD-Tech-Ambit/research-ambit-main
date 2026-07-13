// Worker count. Honor the INSTANCES env var (docker-compose sets it) instead of
// hardcoding 'max'. Default is 1: the directory.v1 gRPC listener is bound to a
// single fixed port (50055) per the Envoy contract, and grpc-js has no portable
// cross-worker port sharing — running multiple cluster workers makes several of
// them bind 50055 via SO_REUSEPORT, so Envoy's pooled connections land on
// different workers and any worker restart (max_memory_restart / crash) drops
// in-flight RPCs, causing intermittent directory failures. Scale out by running
// more backend containers behind Envoy rather than more workers per container.
const rawInstances = process.env.INSTANCES;
const instances = rawInstances === 'max'
  ? 'max'
  : Math.max(1, parseInt(rawInstances || '1', 10) || 1);

module.exports = {
  apps: [{
    name: 'backend-api',
    script: 'index.js',
    instances,
    exec_mode: 'cluster',
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: '/dev/stderr',
    out_file: '/dev/stdout',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    listen_timeout: 10000,
    kill_timeout: 5000,
    wait_ready: true,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 1000
  }]
};
