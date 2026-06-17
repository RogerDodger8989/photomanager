export const config = {
  port: parseInt(process.env.PORT ?? '3000'),
  host: process.env.HOST ?? '0.0.0.0',
  nodeEnv: process.env.NODE_ENV ?? 'development',

  database: {
    connectionString: process.env.DATABASE_URL ?? 'postgresql://pm:secret@localhost:5432/photomanager',
  },

  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },

  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev_secret_change_in_production',
    accessExpires: process.env.JWT_ACCESS_EXPIRES ?? '15m',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES ?? '30d',
  },

  media: {
    photosPath: process.env.MEDIA_PHOTOS_PATH ?? './media/photos',
    thumbsPath: process.env.MEDIA_THUMBS_PATH ?? './media/thumbs',
    transcodePath: process.env.MEDIA_TRANSCODE_PATH ?? './media/transcode',
  },

  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    email: process.env.VAPID_EMAIL ?? 'admin@example.com',
  },

  trash: {
    autoCleanDays: parseInt(process.env.TRASH_AUTO_CLEAN_DAYS ?? '30'),
  },
};
