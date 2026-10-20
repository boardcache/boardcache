import { z } from 'zod';
import type { BoardTool } from '../../../lib/tools/registry';
import { loadThreadStore } from './ChatPanel';

/**
 * Thread memory: lets the assistant search this board's PAST chat threads
 * (stored locally, images stripped) so "what did we decide last week?"
 * retrieves the actual earlier conversation instead of guessing. The active
 * thread is excluded — it's already in the model's context. Purely local:
 * threads never leave the device.
 */

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const threadSearchTool: BoardTool = {
  name: 'search_chat_history',
  description:
    'Search PAST chat threads on this board — earlier conversations with the user (their questions, your answers, decisions made). Use when the user references something previously discussed ("like we said", "the plan from last time"). Returns matching messages with their thread title and date.',
  parameters: z.object({
    query: z.string().min(1).describe('Keywords to find in earlier conversations.'),
  }),
  access: 'read',
  execute: (args, ctx) => {
    const { activeId, threads } = loadThreadStore(ctx.doc().id);
    const terms = args.query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return { count: 0, matches: [] };
    const matches: {
      thread: string;
      date: string;
      role: string;
      text: string;
      score: number;
    }[] = [];
    for (const thread of threads) {
      if (thread.id === activeId) continue; // current conversation is already in context
      for (const entry of thread.entries) {
        if (entry.kind !== 'user' && entry.kind !== 'assistant') continue;
        const lower = entry.text.toLowerCase();
        let score = 0;
        for (const term of terms) if (lower.includes(term)) score += 1;
        if (score === 0) continue;
        matches.push({
          thread: thread.title,
          date: new Date(thread.updatedAt).toISOString().slice(0, 10),
          role: entry.kind,
          text: clip(entry.text.replace(/\s+/g, ' ').trim(), 600),
          score,
        });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    const top = matches
      .slice(0, 8)
      .map((m) => ({ thread: m.thread, date: m.date, role: m.role, text: m.text }));
    return {
      count: matches.length,
      matches: top,
      ...(threads.length === 0 ? { note: 'No past chat threads exist on this board yet.' } : {}),
    };
  },
};
