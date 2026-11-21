// Minimal Telegram Bot API client (long polling). No webhook, so no public URL is needed.

export function telegramClient({ token, apiBase = "https://api.telegram.org" }) {
  const base = `${apiBase}/bot${token}`;

  async function call(method, params, timeoutMs = 35_000) {
    const res = await fetch(`${base}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await res.json().catch(() => ({}));
    if (!j.ok) throw new Error(`telegram ${method}: ${j.description || res.status}`);
    return j.result;
  }

  return {
    // Long poll: waits up to `timeout` seconds for new messages or button taps.
    getUpdates: (offset, timeout = 25) =>
      call("getUpdates", { offset, timeout, allowed_updates: ["message", "callback_query"] }, (timeout + 10) * 1000),
    sendMessage: (chatId, text, replyTo, replyMarkup) =>
      call("sendMessage", {
        chat_id: chatId,
        text,
        ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    editMessageText: (chatId, messageId, text) =>
      call("editMessageText", { chat_id: chatId, message_id: messageId, text, reply_markup: { inline_keyboard: [] } }),
    answerCallbackQuery: (callbackQueryId, text) =>
      call("answerCallbackQuery", { callback_query_id: callbackQueryId, ...(text ? { text } : {}) }),
  };
}
