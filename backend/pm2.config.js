/**
 * PM2-konfiguration för multi-process Docker-container.
 *
 * Processer:
 *   1. insightface  — Python Flask-server som laddar InsightFace-modellen
 *   2. fastify      — Node.js Fastify-backend
 *
 * InsightFace startas först. Fastify har intern retry-logik (waitForInsightFace)
 * och blockerar INTE om Python tar tid på sig att ladda modeller från volymen.
 */

module.exports = {
  apps: [
    {
      name: 'insightface',
      // Använd Python från venv — inte systemets Python
      script: '/app/venv/bin/python3',
      args: 'insightface_server.py',
      interpreter: 'none',
      cwd: '/app',
      env: {
        // Styr var InsightFace laddar ner och cachar modellerna.
        // Mappa /app/models som Docker Volume i Unraid för att
        // slippa ladda ner ~300 MB vid varje container-uppdatering.
        INSIGHTFACE_HOME: '/app/models',
        PYTHONUNBUFFERED: '1',
      },
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
    },
    {
      name: 'fastify',
      script: 'src/server.js',
      interpreter: 'node',
      cwd: '/app',
      env: {
        NODE_ENV: 'production',
        INSIGHTFACE_URL: 'http://127.0.0.1:5000',
      },
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
    },
  ],
};
