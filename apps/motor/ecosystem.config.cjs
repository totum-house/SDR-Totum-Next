// Segredos (SUPABASE_SERVICE_ROLE_KEY, OPENWA_API_KEY, etc.) NÃO vivem
// aqui — este arquivo é rastreado pelo git. Eles vêm de apps/motor/.env
// (gitignored), carregado via `require('dotenv').config()` no topo de
// src/server.js. O `env` abaixo só cobre o que não é segredo e serve de
// fallback antes do dotenv rodar.
//
// Rodar sempre com cwd = apps/motor (`cd apps/motor && pm2 start
// ecosystem.config.cjs`) — dotenv.config() sem path explícito carrega
// ./.env relativo ao cwd do processo.
module.exports = {
  apps: [
    {
      name: 'sdr-motor',
      script: './src/server.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        MOTOR_PORT: 3100,
        MOTOR_BIND: '127.0.0.1',
      },
      error_file: './logs/sdr-motor-error.log',
      out_file: './logs/sdr-motor-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
