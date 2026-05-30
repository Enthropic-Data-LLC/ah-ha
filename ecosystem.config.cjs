module.exports = {
  apps: [
    {
      name: 'ah-ha-api',
      script: 'dist/api.js',
      cwd: '/home/pi/projects/ah-ha',
      interpreter: 'node',
      env: {
        NODE_ENV: 'development',
      },
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
      // Wait for API to be up before bridge starts appending
      wait_ready: false,
    },
  ],
}
