import { Bot } from "grammy";

const TG_API_KEY = process.env.TG_API_KEY;
const CHAT_ID = process.env.TELEGRAM_GROUP_ID;

class TelegramLogger {
  constructor() {
    this.bot = null;

    if (TG_API_KEY && CHAT_ID) {
      this.bot = new Bot(TG_API_KEY);
    } else {
      console.warn(
        "⚠️ Telegram Logger: TG_API_KEY or TELEGRAM_GROUP_ID missing in .env"
      );
    }
  }

  async _log(level, message, meta = null) {
    if (!this.bot) return;

    try {
      // 1. Timestamp similar to your Winston format
      const timestamp = new Date()
        .toISOString()
        .replace("T", " ")
        .split(".")[0];

      // 2. Define icons for visual scanning
      const icons = {
        INFO: "ℹ️",
        WARN: "⚠️",
        ERROR: "🚨",
      };
      const icon = icons[level] || "📝";

      // 3. Handle if 'message' is actually an Error object
      let msgContent = message;
      let stackTrace = meta;

      if (message instanceof Error) {
        msgContent = message.message;
        stackTrace = message.stack;
      }

      // 4. Construct HTML Message
      // <b> for bold headers, <pre> for code blocks (errors)
      let text = `<b>${icon} ${level}</b>  <code>${timestamp}</code>\n\n`;
      text += `${msgContent}`;

      if (stackTrace) {
        text += `\n<pre>${stackTrace}</pre>`;
      }

      // 5. Send via Grammy
      await this.bot.api.sendMessage(CHAT_ID, text, {
        parse_mode: "HTML",
      });
    } catch (err) {
      // Fallback: If Telegram fails (e.g. rate limit), log to console so you don't lose it
      console.error("❌ Failed to send Telegram alert:", err.message);
    }
  }

  info(message) {
    return this._log("INFO", message);
  }

  warn(message) {
    return this._log("WARN", message);
  }

  error(message, errorObj) {
    return this._log("ERROR", message, errorObj);
  }
}

// Export a singleton instance
const tgLogger = new TelegramLogger();
export default tgLogger;
