import { Message } from "./types";

const STORAGE_PREFIX = "chat-session:";
// Bump this when message shape changes to auto-invalidate stale sessionStorage entries.
const CACHE_VERSION = "v2";
const VERSION_KEY = "chat-session-cache-version";

// Wipe all old cache entries if the version changed (e.g. after an SSE format fix).
if (typeof sessionStorage !== "undefined") {
  try {
    if (sessionStorage.getItem(VERSION_KEY) !== CACHE_VERSION) {
      // Remove all entries written by this module
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k?.startsWith(STORAGE_PREFIX)) keysToRemove.push(k);
      }
      keysToRemove.forEach((k) => sessionStorage.removeItem(k));
      sessionStorage.setItem(VERSION_KEY, CACHE_VERSION);
    }
  } catch {
    // sessionStorage unavailable — ignore
  }
}

const cache = new Map<string, Message[]>();

export function getSession(agentId: string): Message[] {
  if (!cache.has(agentId)) {
    try {
      const raw = sessionStorage.getItem(STORAGE_PREFIX + agentId);
      // Validate: only keep entries where every message has a non-empty content
      // (guards against stale entries saved before the SSE buffer fix)
      const parsed: Message[] = raw ? JSON.parse(raw) : [];
      const valid = parsed.every((m) => m.role === "user" || m.content);
      cache.set(agentId, valid ? parsed : []);
    } catch {
      cache.set(agentId, []);
    }
  }
  return cache.get(agentId)!;
}

export function setSession(agentId: string, messages: Message[]): void {
  cache.set(agentId, messages);
  try {
    sessionStorage.setItem(STORAGE_PREFIX + agentId, JSON.stringify(messages));
  } catch {
    // sessionStorage full or unavailable — in-memory cache still works
  }
}

export function clearSession(agentId: string): void {
  cache.delete(agentId);
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + agentId);
  } catch {}
}
