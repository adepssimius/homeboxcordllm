/**
 * Headless chat REPL — the same bot, driven from stdin. See the README.
 *
 *   DATA_DIR="$PWD/.local" HOMEBOX_URL=… HOMEBOX_TOKEN=… pnpm chat
 */
import { chat } from "discordllm";
import bot from "./bot.js";

chat(bot);
