import fp from 'fastify-plugin';
import staticPlugin from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_PUBLIC = resolve(__dirname, '../../../frontend/public');
const FRONTEND_SRC    = resolve(__dirname, '../../../frontend/src');

export default fp(async (fastify) => {
  // Thumbnails
  fastify.register(staticPlugin, {
    root: config.media.thumbsPath,
    prefix: '/thumbs/',
    decorateReply: true,   // första registrering sätter sendFile-decorator
  });

  // Frontend JS-moduler (api.js, utils.js, vyer, komponenter)
  fastify.register(staticPlugin, {
    root: FRONTEND_SRC,
    prefix: '/src/',
    decorateReply: false,
    setHeaders: (res) => { res.setHeader('Cache-Control', 'no-store'); },
  });

  // Frontend PWA-rot (index.html, app.js, manifest.json, sw.js)
  fastify.register(staticPlugin, {
    root: FRONTEND_PUBLIC,
    prefix: '/',
    decorateReply: false,
    wildcard: false,
    index: 'index.html',
    setHeaders: (res, path) => {
      if (path.endsWith('.js') || path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  });

  // Catch-all för SPA: alla okända GET-routes → index.html
  fastify.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/api/')) {
      return reply.sendFile('index.html', FRONTEND_PUBLIC);
    }
    reply.status(404).send({ error: 'Not found' });
  });
});
