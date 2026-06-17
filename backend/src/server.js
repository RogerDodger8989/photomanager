import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { pool } from './db/pool.js';

// Plugins
import corsPlugin from './plugins/cors.js';
import authPlugin from './plugins/auth.js';
import rateLimitPlugin from './plugins/rateLimit.js';
import staticPlugin from './plugins/staticFiles.js';

// Routes
import authRoutes    from './routes/auth.js';
import assetsRoutes  from './routes/assets.js';
import streamRoutes  from './routes/stream.js';
import adminRoutes   from './routes/admin.js';
import aiRoutes      from './routes/ai.js';
import searchRoutes  from './routes/search.js';
import exploreRoutes from './routes/explore.js';
import mapRoutes     from './routes/map.js';
import personsRoutes from './routes/persons.js';
import sharesRoutes  from './routes/shares.js';
import albumsRoutes  from './routes/albums.js';
import eventsRoutes  from './routes/events.js';
import exportRoutes  from './routes/export.js';
import uploadRoutes  from './routes/upload.js';
import pushRoutes    from './routes/push.js';
import foldersAdminRoutes from './routes/folders.js';

// Workers
import { startFileWatcher }     from './workers/fileWatcher.js';
import { startTrashCleanerCron } from './workers/trashCleaner.js';
import { startJobRunner }        from './workers/jobRunner.js';
import { buildEvents }           from './services/exploreService.js';
import { initAiWorker, shutdownAiWorker } from './services/aiService.js';

const fastify = Fastify({
  logger: {
    level: config.nodeEnv === 'production' ? 'warn' : 'info',
    transport: config.nodeEnv !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
});

// Registrera plugins i rätt ordning
await fastify.register(cookie);
await fastify.register(multipart);
await fastify.register(corsPlugin);
await fastify.register(rateLimitPlugin);
await fastify.register(authPlugin);
await fastify.register(staticPlugin);

// Routes
await fastify.register(authRoutes);
await fastify.register(assetsRoutes);
await fastify.register(streamRoutes);
await fastify.register(adminRoutes);
await fastify.register(aiRoutes);
await fastify.register(searchRoutes);
await fastify.register(exploreRoutes);
await fastify.register(mapRoutes);
await fastify.register(personsRoutes);
await fastify.register(sharesRoutes);
await fastify.register(albumsRoutes);
await fastify.register(eventsRoutes);
await fastify.register(exportRoutes);
await fastify.register(uploadRoutes);
await fastify.register(pushRoutes);
await fastify.register(foldersAdminRoutes);

// Health check
fastify.get('/api/health', async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  version: '1.0.0',
}));

// Global felhanterare
fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);
  const statusCode = error.statusCode ?? 500;
  reply.status(statusCode).send({
    error: statusCode === 500 ? 'Internt serverfel' : error.message,
  });
});

// Starta servern
const start = async () => {
  try {
    // Verifiera DB-anslutning
    await pool.query('SELECT 1');
    fastify.log.info('Databasanslutning OK');

    await fastify.listen({ port: config.port, host: config.host });
    fastify.log.info(`PhotoManager körs på http://${config.host}:${config.port}`);

    // Starta AI-worker (graceful degradation om modell-filer saknas)
    await initAiWorker();

    // Starta bakgrundsprocesser
    await startFileWatcher();
    startJobRunner();
    startTrashCleanerCron();
    // Bygg händelse-index i bakgrunden vid uppstart
    buildEvents().catch(console.error);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  fastify.log.info('Stänger ner...');
  await shutdownAiWorker();
  await fastify.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
