import { getMapClusters, getAssetsInBounds, getMapExtent, getClusterPhotos } from '../services/geoService.js';

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
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';

    if (zoom >= 16) {
      const { rows, total, truncated } = await getAssetsInBounds(bounds, userId, isAdmin);
      return reply.send({ data: { type: 'assets', items: rows, total, truncated } });
    }

    const clusters = await getMapClusters(bounds, zoom, userId, isAdmin);
    return reply.send({ data: { type: 'clusters', items: clusters } });
  });

  // GET /api/map/extent — bounding box för alla foton med GPS
  fastify.get('/api/map/extent', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';
    const data = await getMapExtent(userId, isAdmin);
    return reply.send({ data });
  });

  // GET /api/map/cluster-photos?lat=&lon=&radiusMeters=&offset=
  fastify.get('/api/map/cluster-photos', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        required: ['lat', 'lon', 'radiusMeters'],
        properties: {
          lat:          { type: 'number' },
          lon:          { type: 'number' },
          radiusMeters: { type: 'number' },
          offset:       { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const { lat, lon, radiusMeters, offset = 0 } = request.query;
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';
    const result = await getClusterPhotos(lat, lon, radiusMeters, userId, isAdmin, offset);
    return reply.send({ data: result });
  });
}
