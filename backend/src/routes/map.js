import { getMapClusters, getAssetsInBounds } from '../services/geoService.js';

export default async function mapRoutes(fastify) {

  // GET /api/map/clusters?minLat=&maxLat=&minLon=&maxLon=&zoom=
  fastify.get('/api/map/clusters', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        required: ['minLat', 'maxLat', 'minLon', 'maxLon', 'zoom'],
        properties: {
          minLat: { type: 'number' },
          maxLat: { type: 'number' },
          minLon: { type: 'number' },
          maxLon: { type: 'number' },
          zoom:   { type: 'integer', minimum: 1, maximum: 16 },
        },
      },
    },
  }, async (request, reply) => {
    const { minLat, maxLat, minLon, maxLon, zoom } = request.query;
    const bounds = { minLat, maxLat, minLon, maxLon };

    // Vid hög zoom visas individuella assets istället för kluster
    if (zoom >= 14) {
      const assets = await getAssetsInBounds(bounds);
      return reply.send({ data: { type: 'assets', items: assets } });
    }

    const clusters = await getMapClusters(bounds, zoom);
    return reply.send({ data: { type: 'clusters', items: clusters } });
  });
}
