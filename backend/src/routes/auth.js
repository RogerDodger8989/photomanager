import {
  findUserByUsername,
  verifyPassword,
  updateLastLogin,
  getUserPermissions,
  logAudit,
} from '../services/authService.js';
import { config } from '../config.js';

export default async function authRoutes(fastify) {
  // POST /api/auth/login
  fastify.post('/api/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 1 },
          password: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { username, password } = request.body;

    const user = await findUserByUsername(username);
    if (!user) {
      return reply.status(401).send({ error: 'Felaktigt användarnamn eller lösenord' });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      await logAudit(user.id, 'login_failed', null, null, null,
        request.ip, request.headers['user-agent']);
      return reply.status(401).send({ error: 'Felaktigt användarnamn eller lösenord' });
    }

    await updateLastLogin(user.id);
    const permissions = await getUserPermissions(user.id);

    const payload = { id: user.id, username: user.username, role: user.role, can_upload: user.can_upload ?? false };

    const accessToken = fastify.jwt.sign(payload, {
      expiresIn: config.jwt.accessExpires,
    });
    const refreshToken = fastify.jwt.sign(
      { id: user.id, type: 'refresh' },
      { expiresIn: config.jwt.refreshExpires }
    );

    // Refresh token i httpOnly cookie
    reply.setCookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'strict',
      path: '/api/auth/refresh',
      maxAge: 60 * 60 * 24 * 30, // 30 dagar
    });

    await logAudit(user.id, 'login', null, null, null,
      request.ip, request.headers['user-agent']);

    return reply.send({
      data: {
        accessToken,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          avatarPath: user.avatar_path,
          permissions,
        },
      },
    });
  });

  // POST /api/auth/refresh
  fastify.post('/api/auth/refresh', async (request, reply) => {
    const token = request.cookies?.refresh_token;
    if (!token) {
      return reply.status(401).send({ error: 'Ingen refresh token' });
    }

    let decoded;
    try {
      decoded = fastify.jwt.verify(token);
    } catch {
      return reply.status(401).send({ error: 'Ogiltig eller utgången refresh token' });
    }

    if (decoded.type !== 'refresh') {
      return reply.status(401).send({ error: 'Ogiltig token-typ' });
    }

    const { query } = await import('../db/pool.js');
    const result = await query('SELECT * FROM users WHERE id = $1 AND is_active = true', [decoded.id]);
    const freshUser = result.rows[0];

    if (!freshUser) {
      return reply.status(401).send({ error: 'Användaren finns inte' });
    }

    const newAccessToken = fastify.jwt.sign(
      { id: freshUser.id, username: freshUser.username, role: freshUser.role, can_upload: freshUser.can_upload ?? false },
      { expiresIn: config.jwt.accessExpires }
    );

    return reply.send({ data: { accessToken: newAccessToken } });
  });

  // POST /api/auth/logout
  fastify.post('/api/auth/logout', async (request, reply) => {
    try {
      await request.jwtVerify();
      await logAudit(request.user.id, 'logout', null, null, null,
        request.ip, request.headers['user-agent']);
    } catch {}
    reply.clearCookie('refresh_token', { path: '/api/auth/refresh' });
    reply.clearCookie('refresh_token', { path: '/' });
    return reply.send({ data: { message: 'Utloggad' } });
  });

  // GET /api/auth/me — hämta inloggad användares profil
  fastify.get('/api/auth/me', {
    onRequest: [fastify.authenticate],
  }, async (request, reply) => {
    const { query } = await import('../db/pool.js');
    const { rows } = await query(
      'SELECT id, username, email, role, avatar_path, created_at, last_login FROM users WHERE id = $1',
      [request.user.id]
    );
    if (!rows[0]) return reply.status(404).send({ error: 'Användaren hittades inte' });

    const permissions = await getUserPermissions(request.user.id);
    return reply.send({ data: { ...rows[0], permissions } });
  });
}
