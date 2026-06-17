import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import { config } from '../config.js';

export default fp(async (fastify) => {
  const allowedOrigins =
    config.nodeEnv === 'development'
      ? true  // tillåt alla i dev
      : [process.env.FRONTEND_URL ?? 'http://localhost:3000'];

  fastify.register(cors, {
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
});
