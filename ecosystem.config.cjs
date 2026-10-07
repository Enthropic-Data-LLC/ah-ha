module.exports = {
  apps: [
    {
      name: 'ah-ha-api',
      script: 'dist/api.js',
      cwd: '/home/pi/projects/ah-ha',
      interpreter: 'node',
      // NODE_ENV comes from each host's .env (dotenv never overrides a PM2-set value,
      // so hard-coding it here ran live as development until 2026-10-07).
      log_file: '/home/pi/logs/ah-ha-api.log',
      error_file: '/home/pi/logs/ah-ha-api-error.log',
      time: true,
      restart_delay: 2000,
      max_restarts: 10,
    },
    {
      name: 'ah-ha-mqtt-bridge',
      script: 'dist/mqtt-bridge.js',
      cwd: '/home/pi/projects/ah-ha',
      interpreter: 'node',
      log_file: '/home/pi/logs/ah-ha-mqtt-bridge.log',
      error_file: '/home/pi/logs/ah-ha-mqtt-bridge-error.log',
      time: true,
      restart_delay: 5000,
      max_restarts: 10,
    },
    {
      name: 'ah-ha-notifier',
      script: 'dist/notifier.js',
      cwd: '/home/pi/projects/ah-ha',
      interpreter: 'node',
      log_file: '/home/pi/logs/ah-ha-notifier.log',
      error_file: '/home/pi/logs/ah-ha-notifier-error.log',
      time: true,
      restart_delay: 5000,
      max_restarts: 10,
    },
  ],
}
