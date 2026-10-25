import type { ChatMessage } from "./types";

/** Branch metadata is kept beside the linear log; messages are never rewritten. */
export interface BranchNode { messageId: string; parentId: string | null; branchId: string; retryOf?: string }
export interface BranchState { nodes: BranchNode[]; activeLeaf: string | null }

export const emptyBranches = (): BranchState => ({ nodes: [], activeLeaf: null });

/** Append a message under the current active leaf. */
export function appendNode(s: BranchState, messageId: string, retryOf?: string): BranchState {
  if (s.nodes.some(n => n.messageId === messageId)) return s;
  const parentId = s.activeLeaf;
  const branchId = parentId && s.nodes.some(n => n.parentId === parentId) ? `b-${messageId}` : (s.nodes.find(n => n.messageId === parentId)?.branchId ?? "main");
  return { nodes: [...s.nodes, { messageId, parentId, branchId, ...(retryOf ? { retryOf } : {}) }], activeLeaf: messageId };
}

/** Fork: make `fromMessageId` the active leaf so the next message starts a sibling branch. */
export function forkFrom(s: BranchState, fromMessageId: string | null): BranchState {
  if (fromMessageId !== null && !s.nodes.some(n => n.messageId === fromMessageId)) return s;
  return { ...s, activeLeaf: fromMessageId };
}

/** Linear path root -> leaf. Cycle-safe. */
export function pathTo(s: BranchState, leaf: string | null): string[] {
  const by = new Map(s.nodes.map(n => [n.messageId, n]));
  const out: string[] = []; const seen = new Set<string>();
  let cur = leaf;
  while (cur && by.has(cur) && !seen.has(cur)) { seen.add(cur); out.unshift(cur); cur = by.get(cur)!.parentId; }
  return out;
}

/** Same rule as native Db::active_history: tracked messages follow the active path; untracked ones inherit from the message before. */
export function activeMessages(s: BranchState, all: ChatMessage[]): ChatMessage[] {
  if (!s.nodes.length) return all;
  const ids = new Set(pathTo(s, s.activeLeaf));
  const tracked = new Set(s.nodes.map(n => n.messageId));
  let keep = true;
  return all.filter(m => { if (tracked.has(m.id)) keep = ids.has(m.id); return keep; });
}

/** Start tracking an existing linear log: user turns chained in order, replies inherit. */
export function seedFromLog(all: ChatMessage[]): BranchState {
  let s = emptyBranches();
  for (const m of all) if (m.role === "user") s = appendNode(s, m.id);
  return s;
}

/** Fork at a user message: the next send becomes its sibling. */
export function forkAtUser(s: BranchState, userMessageId: string): BranchState {
  const n = s.nodes.find(x => x.messageId === userMessageId);
  return n ? { ...s, activeLeaf: n.parentId } : s;
}

export function siblings(s: BranchState, messageId: string): string[] {
  const n = s.nodes.find(x => x.messageId === messageId); if (!n) return [];
  return s.nodes.filter(x => x.parentId === n.parentId).map(x => x.messageId);
}

/** Latest leaf descending from a node (used when switching sibling). */
export function leafOf(s: BranchState, messageId: string): string {
  let cur = messageId; const seen = new Set<string>();
  for (;;) { seen.add(cur); const kids = s.nodes.filter(n => n.parentId === cur && !seen.has(n.messageId)); if (!kids.length) return cur; cur = kids[kids.length - 1].messageId; }
}
export const switchTo = (s: BranchState, siblingId: string): BranchState => s.nodes.some(n => n.messageId === siblingId) ? { ...s, activeLeaf: leafOf(s, siblingId) } : s;
