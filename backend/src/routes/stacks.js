import { query } from '../db/pool.js';

export default async function stacksRoutes(fastify) {

  // POST /api/stacks — skapa ny stack av 2+ assets
  fastify.post('/api/stacks', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['assetIds'],
        properties: {
          assetIds: { type: 'array', items: { type: 'string' }, minItems: 2 },
          coverId:  { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { assetIds, coverId } = request.body;
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';

    // Verifiera att alla assets tillhör användaren
    const { rows: assets } = await query(
      `SELECT id FROM assets WHERE id = ANY($1::uuid[]) AND status = 'active' AND ($2 OR owner_id = $3)`,
      [assetIds, isAdmin, userId],
    );
    if (assets.length < 2) return reply.status(400).send({ error: 'Minst 2 bilder krävs för en stack' });

    const validIds    = assets.map((a) => a.id);
    const coverAsset  = coverId && validIds.includes(coverId) ? coverId : validIds[0];

    // Rensa gamla stack-kopplingar — varje asset kan bara tillhöra en stack
    await _removeAssetsFromOldStacks(validIds);

    // Skapa stack
    const { rows: [stack] } = await query(
      `INSERT INTO stacks (cover_asset_id, owner_id) VALUES ($1, $2) RETURNING id`,
      [coverAsset, userId],
    );

    // Koppla assets till stacken
    for (let i = 0; i < validIds.length; i++) {
      await query(
        `INSERT INTO stack_assets (stack_id, asset_id, sort_order) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [stack.id, validIds[i], i],
      );
    }

    // Uppdatera stack_id på assets
    await query(
      `UPDATE assets SET stack_id = $1 WHERE id = ANY($2::uuid[])`,
      [stack.id, validIds],
    );

    return reply.status(201).send({ data: { stackId: stack.id, coverAssetId: coverAsset } });
  });

  // GET /api/stacks/:id — hämta stack med alla members
  fastify.get('/api/stacks/:id', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';

    const { rows: [stack] } = await query(
      `SELECT s.*, a.file_name AS cover_name
       FROM stacks s JOIN assets a ON a.id = s.cover_asset_id
       WHERE s.id = $1 AND ($2 OR s.owner_id = $3)`,
      [id, isAdmin, userId],
    );
    if (!stack) return reply.status(404).send({ error: 'Stack hittades inte' });

    const { rows: members } = await query(
      `SELECT a.id, a.file_name, a.thumb_small_path, a.thumb_large_path,
              a.taken_at, a.mime_type, a.duration, a.location_label,
              a.rating, a.flag, a.color_label, a.width, a.height,
              a.file_size, a.indexed_at, a.is_motion_photo, a.stack_id,
              (SELECT COUNT(*)::int FROM assets s WHERE s.stack_id = a.stack_id AND s.status = 'active') AS stack_size,
              EXISTS(SELECT 1 FROM favorites fv WHERE fv.asset_id = a.id AND fv.user_id = $2) AS is_favorite,
              sa.sort_order
       FROM stack_assets sa JOIN assets a ON a.id = sa.asset_id
       WHERE sa.stack_id = $1 AND a.status = 'active'
       ORDER BY sa.sort_order`,
      [id, userId],
    );

    return reply.send({ data: { stack, members } });
  });

  // POST /api/stacks/:id/assets — lägg till fler assets i stack
  fastify.post('/api/stacks/:id/assets', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['assetIds'],
        properties: {
          assetIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { assetIds } = request.body;
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';

    const { rows: [stack] } = await query(
      `SELECT id FROM stacks WHERE id = $1 AND ($2 OR owner_id = $3)`,
      [id, isAdmin, userId],
    );
    if (!stack) return reply.status(404).send({ error: 'Stack hittades inte' });

    const { rows: [maxRow] } = await query(
      `SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM stack_assets WHERE stack_id = $1`,
      [id],
    );
    let order = (maxRow?.max_order ?? -1) + 1;

    // Rensa gamla stack-kopplingar innan vi lägger till i ny stack
    await _removeAssetsFromOldStacks(assetIds);

    for (const assetId of assetIds) {
      await query(
        `INSERT INTO stack_assets (stack_id, asset_id, sort_order) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [id, assetId, order++],
      );
      await query(`UPDATE assets SET stack_id = $1 WHERE id = $2`, [id, assetId]);
    }

    return reply.send({ data: { ok: true } });
  });

  // DELETE /api/stacks/:stackId/assets/:assetId — ta bort enskild asset från stack
  fastify.delete('/api/stacks/:stackId/assets/:assetId', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { stackId, assetId } = request.params;
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';

    const { rows: [stack] } = await query(
      `SELECT id, cover_asset_id FROM stacks WHERE id = $1 AND ($2 OR owner_id = $3)`,
      [stackId, isAdmin, userId],
    );
    if (!stack) return reply.status(404).send({ error: 'Stack hittades inte' });

    await query(`DELETE FROM stack_assets WHERE stack_id = $1 AND asset_id = $2`, [stackId, assetId]);
    await query(`UPDATE assets SET stack_id = NULL WHERE id = $1`, [assetId]);

    // Om det var omslagsbilden: välj en annan
    if (stack.cover_asset_id === assetId) {
      const { rows: [newCover] } = await query(
        `SELECT asset_id FROM stack_assets WHERE stack_id = $1 ORDER BY sort_order LIMIT 1`,
        [stackId],
      );
      if (newCover) {
        await query(`UPDATE stacks SET cover_asset_id = $1 WHERE id = $2`, [newCover.asset_id, stackId]);
      } else {
        // Inga members kvar — ta bort hela stacken
        await query(`DELETE FROM stacks WHERE id = $1`, [stackId]);
        return reply.send({ data: { ok: true, stackDeleted: true } });
      }
    }

    return reply.send({ data: { ok: true } });
  });

  // PATCH /api/stacks/:id — ändra omslagsbild
  fastify.patch('/api/stacks/:id', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['coverId'],
        properties: {
          coverId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { coverId } = request.body;
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';

    const { rows: [stack] } = await query(
      `SELECT id FROM stacks WHERE id = $1 AND ($2 OR owner_id = $3)`,
      [id, isAdmin, userId],
    );
    if (!stack) return reply.status(404).send({ error: 'Stack hittades inte' });

    // Verifiera att coverId tillhör stacken
    const { rows: [member] } = await query(
      `SELECT asset_id FROM stack_assets WHERE stack_id = $1 AND asset_id = $2`,
      [id, coverId],
    );
    if (!member) return reply.status(400).send({ error: 'Assetet är inte i stacken' });

    await query(`UPDATE stacks SET cover_asset_id = $1 WHERE id = $2`, [coverId, id]);
    return reply.send({ data: { ok: true } });
  });

  // PUT /api/stacks/:id/order — spara ny sort_order, första item blir cover
  fastify.put('/api/stacks/:id/order', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['order'],
        properties: {
          order: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { order } = request.body;
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';

    const { rows: [stack] } = await query(
      `SELECT id FROM stacks WHERE id = $1 AND ($2 OR owner_id = $3)`,
      [id, isAdmin, userId],
    );
    if (!stack) return reply.status(404).send({ error: 'Stack hittades inte' });

    for (let i = 0; i < order.length; i++) {
      await query(
        `UPDATE stack_assets SET sort_order = $1 WHERE stack_id = $2 AND asset_id = $3`,
        [i, id, order[i]],
      );
    }
    if (order[0]) {
      await query(`UPDATE stacks SET cover_asset_id = $1 WHERE id = $2`, [order[0], id]);
    }
    return reply.send({ data: { ok: true, coverId: order[0] } });
  });

  // DELETE /api/stacks/:id — upplös hela stacken (assets blir fristående)
  fastify.delete('/api/stacks/:id', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params;
    const userId  = request.user.id;
    const isAdmin = request.user.role === 'admin';

    const { rows: [stack] } = await query(
      `SELECT id FROM stacks WHERE id = $1 AND ($2 OR owner_id = $3)`,
      [id, isAdmin, userId],
    );
    if (!stack) return reply.status(404).send({ error: 'Stack hittades inte' });

    await query(`UPDATE assets SET stack_id = NULL WHERE stack_id = $1`, [id]);
    await query(`DELETE FROM stacks WHERE id = $1`, [id]);

    return reply.send({ data: { ok: true } });
  });
}

/**
 * Tar bort givna asset-ID:n från eventuella gamla stackar de tillhör.
 * Om en gammal stack har < 2 kvar efter borttagningen, upplöses den helt.
 */
async function _removeAssetsFromOldStacks(assetIds) {
  for (const assetId of assetIds) {
    const { rows: [existing] } = await query(
      `SELECT stack_id FROM assets WHERE id = $1 AND stack_id IS NOT NULL`,
      [assetId],
    );
    if (!existing?.stack_id) continue;

    const oldStackId = existing.stack_id;
    await query(`DELETE FROM stack_assets WHERE stack_id = $1 AND asset_id = $2`, [oldStackId, assetId]);
    await query(`UPDATE assets SET stack_id = NULL WHERE id = $1`, [assetId]);

    const { rows: [cnt] } = await query(
      `SELECT COUNT(*)::int AS c FROM stack_assets WHERE stack_id = $1`,
      [oldStackId],
    );
    if ((cnt?.c ?? 0) < 2) {
      // För få members kvar — upplös hela gamla stacken
      await query(`UPDATE assets SET stack_id = NULL WHERE stack_id = $1`, [oldStackId]);
      await query(`DELETE FROM stacks WHERE id = $1`, [oldStackId]);
    } else {
      // Kolla om den borttagna var omslagsbild — välj ny i så fall
      const { rows: [oldStack] } = await query(
        `SELECT cover_asset_id FROM stacks WHERE id = $1`,
        [oldStackId],
      );
      if (oldStack?.cover_asset_id === assetId) {
        const { rows: [newCover] } = await query(
          `SELECT asset_id FROM stack_assets WHERE stack_id = $1 ORDER BY sort_order LIMIT 1`,
          [oldStackId],
        );
        if (newCover) {
          await query(`UPDATE stacks SET cover_asset_id = $1 WHERE id = $2`, [newCover.asset_id, oldStackId]);
        }
      }
    }
  }
}
