import { useEffect, useRef, useState } from 'react';
import { ArrowUpIcon, GearIcon } from '../../../components/icons';
import { renderMarkdown } from '../../../lib/text/markdown';
import { ensureHostedAi, enabledModels, useAIStore } from '../../../state/aiStore';
import { AGENT_PROVIDERS } from './adapters';
import type { AgentProviderId } from './adapters';
import { runAgentTurn } from './agent';
import { useChatStore } from './ChatPanel';

/**
 * "Chat with item": an embedded conversation scoped to one canvas item,
 * rendered in the lightbox sidebar's Assistant tab. Each item owns at most
 * one thread (created lazily on the first message); the item's full detail
 * — and pixels, for images — ride in every model round as focus context.
 * Shares the global chat store, so the floating panel shows the same
 * conversation if opened.
 */
export function ItemChat({ itemId }: { itemId: string }) {
  const entries = useChatStore((s) => s.entries);
  const busy = useChatStore((s) => s.busy);
  const activeItemId = useChatStore((s) => s.itemId);
  const [draft, setDraft] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Entering the tab (or stepping to another item) activates that item's
  // conversation — existing thread, or a fresh unsaved one.
  useEffect(() => {
    if (useChatStore.getState().itemId !== itemId) {
      useChatStore.getState().openItemThread(itemId);
    }
  }, [itemId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries.length, busy]);

  const hostedInfo = useAIStore((s) => s.hosted);
  useEffect(() => void ensureHostedAi(), []);
  const models = enabledModels().filter((m) =>
    m.providerId === 'hosted'
      ? Boolean(hostedInfo?.ops.agent)
      : (AGENT_PROVIDERS as string[]).includes(m.providerId),
  );
  const [modelKey, setModelKey] = useState(
    () => localStorage.getItem('boardcache:chatModel') ?? '',
  );
  const active =
    models.find((m) => `${m.providerId}::${m.model}` === modelKey) ?? models[0] ?? null;

  const send = async () => {
    const text = draft.trim();
    if (!text || busy || !active) return;
    setDraft('');
    const push = (entry: (typeof entries)[number]) =>
      useChatStore.setState((s) => ({ entries: [...s.entries, entry] }));
    push({ kind: 'user', text });
    useChatStore.setState({ busy: 'Thinking' });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const history = await runAgentTurn({
        providerId: active.providerId as AgentProviderId | 'hosted',
        model: active.model,
        history: useChatStore.getState().history,
        userText: text,
        focusItemId: itemId,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'status') useChatStore.setState({ busy: event.label });
          else if (event.type === 'tool') push({ kind: 'tool', text: event.summary, ok: event.ok });
          else push({ kind: 'assistant', text: event.text });
        },
      });
      useChatStore.setState({ history, busy: null });
      useChatStore.getState().persistActive();
    } catch (err) {
      push({ kind: 'error', text: err instanceof Error ? err.message : 'Something went wrong.' });
      useChatStore.setState({ busy: null });
    } finally {
      abortRef.current = null;
    }
  };

  if (models.length === 0) {
    return (
      <p className="chat-empty" data-testid="itemchat-nomodels">
        Enable a text model first (Settings → Plugins → AI Generation).
      </p>
    );
  }

  const showing = activeItemId === itemId ? entries : [];

  return (
    <div className="item-chat" data-testid="item-chat">
      <div className="item-chat-scroll" ref={scrollRef}>
        {showing.length === 0 && (
          <p className="chat-empty">
            Start a conversation about this item — it becomes the assistant’s full context. Nothing
            is saved until you send the first message.
          </p>
        )}
        {showing.map((entry, i) =>
          entry.kind === 'tool' ? (
            <div key={i} className={`chat-toolchip${entry.ok === false ? ' failed' : ''}`}>
              <GearIcon size={12} /> {entry.text}
            </div>
          ) : entry.kind === 'user' ? (
            <div key={i} className="chat-msg user" data-testid="itemchat-user-msg">
              {entry.text}
            </div>
          ) : entry.kind === 'error' ? (
            <div key={i} className="chat-msg error" role="alert">
              {entry.text}
            </div>
          ) : (
            <div
              key={i}
              className="chat-msg assistant md-rendered"
              data-testid="itemchat-assistant-msg"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.text) }}
            />
          ),
        )}
        {busy && (
          <div className="chat-busy">
            <span className="pending-import-spinner" aria-hidden /> {busy}
            <button type="button" onClick={() => abortRef.current?.abort()}>
              Stop
            </button>
          </div>
        )}
      </div>
      <div className="chat-composer item-chat-composer">
        <textarea
          className="chat-input"
          value={draft}
          rows={5}
          placeholder="Ask about this item"
          data-testid="itemchat-input"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
            e.stopPropagation(); // lightbox arrows must not steal keys
          }}
        />
        <div className="chat-composer-row">
          <select
            className="chat-model"
            value={active ? `${active.providerId}::${active.model}` : ''}
            data-testid="itemchat-model"
            onChange={(e) => {
              setModelKey(e.target.value);
              localStorage.setItem('boardcache:chatModel', e.target.value);
            }}
          >
            {models.map((m) => (
              <option key={`${m.providerId}::${m.model}`} value={`${m.providerId}::${m.model}`}>
                {m.model} ({m.providerId})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="chat-send"
            aria-label="Send"
            title="Send"
            disabled={!draft.trim() || busy !== null}
            data-testid="itemchat-send"
            onClick={() => void send()}
          >
            <ArrowUpIcon size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
