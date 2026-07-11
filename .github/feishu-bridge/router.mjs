/**
 * router.mjs — message → command dispatch (pure, fully testable)
 *
 * Exposed as a pure module so unit tests can exercise routing without
 * spinning up the Feishu SDK WebSocket or acquiring the lockfile.
 *
 * Routes:
 *   /bind <username>          → handleBind
 *   /set-pat <pat>            → handleSetPat
 *   /unbind                    → handleUnbind
 *   /status                    → handleStatus
 *   /help                      → static help text
 *   (anything else)            → unknown-command reply (no error)
 *
 * All replies are passed through maskPAT before being returned.
 */
import {
  handleBind,
  handleSetPat,
  handleUnbind,
  handleStatus,
  maskPAT,
} from './commands/bind.mjs';

const COMMAND_PREFIX = '/';

/** Parse a text message into a command + args tuple. Returns null for non-commands. */
export function parseCommand(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith(COMMAND_PREFIX)) return null;
  const [cmd, ...args] = trimmed.slice(COMMAND_PREFIX.length).split(/\s+/);
  return { command: cmd.toLowerCase(), args };
}

const HELP_TEXT =
  'Available commands:\n' +
  '  /bind <github-username>     Start binding your Feishu identity to a GitHub user\n' +
  '  /set-pat <github_pat_...>   Store your fine-grained PAT (after /bind verification)\n' +
  '  /unbind                     Remove your binding\n' +
  '  /status                     Show your current binding\n' +
  '  /help                       Show this help\n\n' +
  'Note: PAT must be fine-grained (github_pat_ prefix). Classic tokens are rejected.';

/**
 * Route a parsed command to the right handler, masking the reply before return.
 *
 * @param {object} opts
 * @param {object} opts.parsed — output of parseCommand
 * @param {Map} opts.sessions
 * @param {Buffer|null} opts.masterKey — null until bridge resolves keychain key
 * @param {object} opts.deps — { bind, unbind, lookup } identity-store functions
 * @param {string} opts.openId
 */
export async function routeCommand({ parsed, sessions, masterKey, deps, openId }) {
  if (!parsed) {
    return { reply: null, handled: false };
  }
  switch (parsed.command) {
    case 'bind':
      return withMask(await handleBind({ openId, args: parsed.args, sessions }));
    case 'set-pat':
      if (!masterKey) {
        return withMask({ reply: 'Bridge is still initializing the keychain master key. Try again in a moment.' });
      }
      return withMask(
        await handleSetPat({
          openId,
          args: parsed.args,
          sessions,
          masterKey,
          bindFn: deps.bind,
        }),
      );
    case 'unbind':
      return withMask(await handleUnbind({ openId, unbindFn: deps.unbind }));
    case 'status':
      return withMask(await handleStatus({ openId, lookupFn: deps.lookup }));
    case 'help':
      return withMask({ reply: HELP_TEXT });
    default:
      return withMask({
        reply: `Unknown command: "/${parsed.command}". Try /help.`,
      });
  }
}

function withMask(result) {
  if (result?.reply) {
    return { ...result, reply: maskPAT(result.reply) };
  }
  return result;
}

export const __internal = { HELP_TEXT, withMask };
