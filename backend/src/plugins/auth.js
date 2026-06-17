import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { config } from '../config.js';

export default fp(async (fastify) => {
  fastify.register(jwt, {
    secret: config.jwt.secret,
    sign: { expiresIn: config.jwt.accessExpires },
  });

  // Decorator: kräver giltig access token
  fastify.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // Decorator: kräver admin-roll
  fastify.decorate('requireAdmin', async (request, reply) => {
    try {
      await request.jwtVerify();
      if (request.user.role !== 'admin') {
        reply.status(403).send({ error: 'Forbidden' });
      }
    } catch {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });
});
