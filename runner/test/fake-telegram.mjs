// Stand-in for the Telegram Bot API (getUpdates + sendMessage), for tests.
import http from "node:http";

export async function startFakeTelegram({ token = "123:abc" } = {}) {
  const updates = []; // queued incoming updates
  const sent = []; // messages the bot sent: { chat_id, text, reply_to, reply_markup, message_id }
  const edits = []; // { chat_id, message_id, text }
  const callbackAnswers = []; // { id, text }
  let nextUpdateId = 1;
  let nextMessageId = 100;

  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const params = body ? JSON.parse(body) : {};
    const send = (result) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, result }));

    const m = req.url.match(/^\/bot([^/]+)\/(\w+)$/);
    if (!m || m[1] !== token) {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, description: "Unauthorized" }));
      return;
    }
    if (m[2] === "getUpdates") {
      // Telegram semantics: offset confirms everything below it. Long poll briefly (max 300 ms here).
      const deadline = Date.now() + Math.min((params.timeout || 0) * 1000, 300);
      const pending = () => updates.filter((u) => u.update_id >= (params.offset || 0));
      while (!pending().length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      while (updates.length && updates[0].update_id < (params.offset || 0)) updates.shift();
      return send(updates.slice());
    }
    if (m[2] === "sendMessage") {
      const message_id = nextMessageId++;
      sent.push({ chat_id: String(params.chat_id), text: params.text, reply_to: params.reply_parameters?.message_id, reply_markup: params.reply_markup, message_id });
      return send({ message_id });
    }
    if (m[2] === "editMessageText") {
      edits.push({ chat_id: String(params.chat_id), message_id: params.message_id, text: params.text });
      return send(true);
    }
    if (m[2] === "answerCallbackQuery") {
      callbackAnswers.push({ id: params.callback_query_id, text: params.text });
      return send(true);
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));

  return {
    token,
    apiBase: `http://127.0.0.1:${server.address().port}`,
    sent,
    edits,
    callbackAnswers,
    // The user taps an inline button on one of the bot's messages.
    userTaps(chatId, messageId, data) {
      updates.push({ update_id: nextUpdateId++, callback_query: { id: `cq${nextUpdateId}`, data, message: { message_id: messageId, chat: { id: Number(chatId) } } } });
    },
    userSays(chatId, text) {
      const message_id = nextMessageId++;
      updates.push({ update_id: nextUpdateId++, message: { message_id, chat: { id: Number(chatId) }, text } });
      return message_id;
    },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}
