import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';

export default fp(async (fastify) => {
  fastify.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
    // Strängare limit för auth-routes sätts direkt på den routen
  });
});
