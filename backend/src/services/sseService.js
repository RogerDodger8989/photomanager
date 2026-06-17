// Enkel in-process event bus för SSE.
// Alla aktiva SSE-anslutningar (reply-objekt) lagras per user-id.
// Workers anropar broadcast() för att pusha events till klienter.

const clients = new Map(); // userId → Set<reply>

export function addClient(userId, reply) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(reply);
}

export function removeClient(userId, reply) {
  clients.get(userId)?.delete(reply);
  if (clients.get(userId)?.size === 0) clients.delete(userId);
}

// Skicka event till en specifik användare
export function sendToUser(userId, eventType, data) {
  const conns = clients.get(userId);
  if (!conns) return;
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const reply of conns) {
    try { reply.raw.write(payload); } catch { conns.delete(reply); }
  }
}

// Broadcast till alla inloggade klienter (t.ex. ny fil indexerad)
export function broadcast(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const conns of clients.values()) {
    for (const reply of conns) {
      try { reply.raw.write(payload); } catch { conns.delete(reply); }
    }
  }
}
