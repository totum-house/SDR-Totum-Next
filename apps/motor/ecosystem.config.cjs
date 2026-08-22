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
