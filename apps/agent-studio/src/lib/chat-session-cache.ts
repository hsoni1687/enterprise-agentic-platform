import { Message } from "./types";

const STORAGE_PREFIX = "chat-session:";
const cache = new Map<string, Message[]>();

export function getSession(agentId: string): Message[] {
  if (!cache.has(agentId)) {
    try {
      const raw = sessionStorage.getItem(STORAGE_PREFIX + agentId);
      cache.set(agentId, raw ? JSON.parse(raw) : []);
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
