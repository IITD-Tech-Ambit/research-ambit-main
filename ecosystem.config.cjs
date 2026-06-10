module.exports = {
  apps: [{
    name: 'backend-api',
    script: 'index.js',
    // One worker per CPU; set INSTANCES=1 in env to force a single process.
    instances: process.env.INSTANCES || 'max',
    exec_mode: 'cluster',
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
    },
    error_file: '/dev/stderr',
    out_file: '/dev/stdout',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    listen_timeout: 10000,
    kill_timeout: 5000,
    // Requires process.send('ready') after app.listen — see index.js
    wait_ready: true,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 1000,
  }],
};
