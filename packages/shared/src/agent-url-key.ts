const AGENT_URL_KEY_DELIM_RE = /[^a-z0-9]+/g;
const AGENT_URL_KEY_TRIM_RE = /^-+|-+$/g;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidLike(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  return UUID_RE.test(value.trim());
}

export function normalizeAgentUrlKey(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(AGENT_URL_KEY_DELIM_RE, "-")
    .replace(AGENT_URL_KEY_TRIM_RE, "");
  return normalized.length > 0 ? normalized : null;
}

export function deriveAgentUrlKey(name: string | null | undefined, fallback?: string | null): string {
  return normalizeAgentUrlKey(name) ?? normalizeAgentUrlKey(fallback) ?? "agent";
}

/**
 * The URL key an agent is addressed by, in priority order.
 *
 * 1. An explicit `shortName`, when the agent has one. This is stable: renaming
 *    the agent no longer moves its URL, so saved links and scripts keep
 *    working.
 * 2. Otherwise the value derived from `name`, which is what every agent used
 *    before `shortName` existed, so behaviour is unchanged for agents without
 *    one.
 * 3. Otherwise the id. A name written entirely in non-ASCII characters (Chinese,
 *    for example) normalizes to nothing, and those agents are addressable only
 *    by bare UUID until someone gives them a `shortName`.
 */
export function resolveAgentUrlKey(agent: {
  id: string;
  name?: string | null;
  shortName?: string | null;
}): string {
  return normalizeAgentUrlKey(agent.shortName) ?? normalizeAgentUrlKey(agent.name) ?? agent.id;
}

/** The longest a `shortName` may be, so it stays usable in a URL. */
export const AGENT_SHORT_NAME_MAX_LENGTH = 64;

/**
 * Whether a string is acceptable as an explicit `shortName`.
 *
 * A short name has to survive `normalizeAgentUrlKey` unchanged, or the stored
 * value and the key the agent actually answers to would differ. That rules out
 * uppercase, spaces, punctuation and anything non-ASCII. A UUID-shaped value is
 * rejected too, because the resolver tries ids first and such a key could never
 * be reached.
 */
export function isValidAgentShortName(value: string): boolean {
  if (value.length === 0 || value.length > AGENT_SHORT_NAME_MAX_LENGTH) return false;
  if (isUuidLike(value)) return false;
  return normalizeAgentUrlKey(value) === value;
}
