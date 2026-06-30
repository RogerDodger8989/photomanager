import { query } from '../db/pool.js';
import { getOnThisDay } from '../services/exploreService.js';
import { sendPushToUser } from '../routes/push.js';

async function sendDailyMemoriesPush() {
  const { rows: subs } = await query(
    'SELECT DISTINCT user_id FROM push_subscriptions'
  );
  if (!subs.length) return;

  for (const { user_id } of subs) {
    try {
      const { rows: [user] } = await query(
        'SELECT is_admin FROM users WHERE id = $1',
        [user_id]
      );
      if (!user) continue;

      const memories = await getOnThisDay(user_id, user.is_admin);
      if (!memories.length) continue;

      const total = memories.reduce((s, m) => s + m.count, 0);
      const yearsBack = memories.length;
      const body = yearsBack === 1
        ? `Du har ${total} bilder från för ${memories[0].yearsAgo} år sedan idag 📸`
        : `Du har ${total} bilder från ${yearsBack} olika år idag 📸`;

      await sendPushToUser(user_id, {
        title: '🗓️ Minnen idag',
        body,
        icon: '/icons/icon-192.png',
        url: '/#/explore',
      });
    } catch (err) {
      console.error(`DailyPush: fel för user ${user_id}:`, err.message);
    }
  }
}

function msUntilNextEight() {
  const now  = new Date();
  const next = new Date();
  next.setHours(8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

export function startDailyPushJob() {
  const delay = msUntilNextEight();
  setTimeout(() => {
    sendDailyMemoriesPush().catch(console.error);
    setInterval(() => sendDailyMemoriesPush().catch(console.error), 24 * 60 * 60 * 1000);
  }, delay);
  console.log(`DailyPush: minnespush schemalagd kl 08:00 (om ${Math.round(delay / 60000)} min)`);
}
