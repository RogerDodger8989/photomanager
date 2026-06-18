import { addClient, removeClient } from '../services/sseService.js';

export default async function eventsRoutes(fastify) {

  // GET /api/events — SSE-ström för realtidsuppdateringar
  // EventSource kan inte skicka Authorization-header — acceptera token som query-param
  fastify.get('/api/events', async (request, reply) => {
    try {
      const { token } = request.query;
      if (token) {
        const decoded = await request.server.jwt.verify(token);
        request.user = decoded;
      } else {
        await request.jwtVerify();
      }
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const userId = request.user.id;

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no'); // Nginx buffering av
    reply.raw.flushHeaders();

    // Välkomstping
    reply.raw.write(`: connected\n\n`);

    addClient(userId, reply);

    // Heartbeat var 30s (förhindrar timeout hos proxies)
    const heartbeat = setInterval(() => {
      try { reply.raw.write(`: ping\n\n`); }
      catch { clearInterval(heartbeat); }
    }, 30_000);

    // Städa upp när klienten kopplar ned
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      removeClient(userId, reply);
    });

    // Håll anslutningen öppen (Fastify stänger annars automatiskt)
    await new Promise((resolve) => request.raw.on('close', resolve));
  });
}
