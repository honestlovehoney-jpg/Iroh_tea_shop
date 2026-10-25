'use client';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import { IrohSession, type ChatMessage } from '../chat/session';
import { MAX_QUESTION_LENGTH } from '../chat/limits';
import type { ResearchAvailability } from '../chat/availability';
import type { PublicUser } from '../auth/service';
import { IrohMessage } from './IrohMessage';
import './styles/panels.css';

type ChatSummary = { id: string; title: string; updatedAt: string };
type SavedMessage = Pick<ChatMessage, 'role' | 'content' | 'status'> & {
  id: number;
};

export function IrohChat({
  session,
  user,
  research = 'bitget',
  draft: draftPrefill = null,
}: {
  session: IrohSession;
  user: PublicUser | null;
  research?: ResearchAvailability | string;
  draft?: { text: string; key: number } | null;
}) {
  const chat = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const [draft, setDraft] = useState('');
  const [researchSymbol] = useState('');
  const [history, setHistory] = useState<ChatSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(Boolean(user));
  const [hasUserKey, setHasUserKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [keyFormOpen, setKeyFormOpen] = useState(false);
  const loadGeneration = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const lastAnswer = useRef<HTMLElement>(null);
  // Sending disables the composer, and the browser drops its focus to <body>.
  const refocusAfterAnswer = useRef(false);

  const fetchChats = async () => {
    const response = await fetch('/api/iroh/chats', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    return ((await response.json()) as { chats: ChatSummary[] }).chats;
  };
  // Failures show fixed copy, never raw fetch text such as 'Failed to fetch'.
  // Skip the result when an unmount, openChat, or newer newChat made it stale.
  const createChat = async () => {
    const generation = loadGeneration.current;
    const response = await fetch('/api/iroh/chats', { method: 'POST' });
    if (!response.ok) throw new Error();
    const { chat } = (await response.json()) as { chat: ChatSummary };
    if (generation !== loadGeneration.current) return;
    session.restore(chat.id, [], null);
    setSelectedId(chat.id);
    setHistory((current) => [chat, ...current]);
  };

  const openChat = async (chatId: string) => {
    const generation = ++loadGeneration.current;
    session.stop();
    setHistoryError(null);
    const response = await fetch(
      `/api/iroh/chats/${encodeURIComponent(chatId)}`,
      { cache: 'no-store' },
    );
    if (!response.ok) throw new Error();
    const data = (await response.json()) as {
      chat: {
        id: string;
        nansenConversationId: string | null;
        messages: SavedMessage[];
      };
    };
    if (generation !== loadGeneration.current) return;
    session.restore(
      data.chat.id,
      data.chat.messages.map((message) => ({
        ...message,
        id: String(message.id),
      })),
      data.chat.nansenConversationId,
    );
    setSelectedId(chatId);
    input.current?.focus();
  };

  const newChat = async () => {
    setDraft('');
    input.current?.focus();
    if (!user) return session.reset();
    ++loadGeneration.current;
    session.stop();
    setHistoryError(null);
    try {
      await createChat();
    } catch {
      setHistoryOpen(true);
      setHistoryError('Could not create a chat.');
    }
  };

  useEffect(() => {
    setHasUserKey(Boolean(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const initialize = async () => {
      try {
        const chats = await fetchChats();
        if (cancelled) return;
        setHistory(chats);
        const current = session.getSnapshot().chatId;
        const target =
          current && chats.some((chat) => chat.id === current)
            ? current
            : chats[0]?.id;
        if (target) {
          setSelectedId(target);
          if (current !== target) await openChat(target);
        } else {
          await createChat();
        }
      } catch {
        if (!cancelled) {
          setHistoryOpen(true);
          setHistoryError('Could not load your chats.');
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    };
    void initialize();
    return () => {
      cancelled = true;
      ++loadGeneration.current;
    };
  }, [session, user?.id]);

  // The composer is disabled while chats load, so focus it once loading ends.
  useEffect(() => {
    if (!historyLoading) input.current?.focus();
  }, [historyLoading]);
  useEffect(() => {
    if (!draftPrefill) return;
    setDraft(draftPrefill.text);
    const field = input.current;
    if (!field) return;
    field.focus();
    const end = draftPrefill.text.length;
    field.setSelectionRange(end, end);
  }, [draftPrefill?.key]);
  useEffect(() => {
    const last = chat.messages.at(-1);
    const box = transcript.current;
    const answer = lastAnswer.current;
    // A finished answer opens at its first line, so the reader starts at the verdict.
    if (last?.role === 'assistant' && last.content && box && answer) {
      box.scrollTop +=
        answer.getBoundingClientRect().top -
        box.getBoundingClientRect().top -
        8;
      return;
    }
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [chat.messages.at(-1)?.content, chat.error]);
  useEffect(() => {
    if (chat.isStreaming || !refocusAfterAnswer.current) return;
    refocusAfterAnswer.current = false;
    // Only hand focus back if the visitor has not moved on to something else.
    if (!document.activeElement || document.activeElement === document.body)
      input.current?.focus();
  }, [chat.isStreaming]);
  const dailyCap = false;
  const needsUserKey = false; // Bitget + Qwen: no Nansen BYOK
  const saveUserKey = (event: FormEvent) => {
    event.preventDefault();
    if (!false) return;
    setHasUserKey(true);
    setKeyDraft('');
    setKeyFormOpen(false);
    input.current?.focus();
  };
  const clearStoredKey = () => {
    undefined;
    setHasUserKey(false);
    setKeyFormOpen(false);
  };
  const send = () => {
    const pending = session.send(draft, researchSymbol.trim() || null);
    if (pending) {
      refocusAfterAnswer.current = document.activeElement === input.current;
      // A click anywhere (selecting answer text, dragging the room) means the
      // visitor moved on, even if focus stays on <body>.
      if (refocusAfterAnswer.current)
        document.addEventListener(
          'pointerdown',
          () => (refocusAfterAnswer.current = false),
          { once: true, capture: true },
        );
      setDraft('');
      if (user) void pending.then(fetchChats).then(setHistory, () => {});
    }
  };
  const byokActions = (
    <div className="iroh-byok">
      {keyFormOpen ? (
        <form className="iroh-byok-form" onSubmit={saveUserKey}>
          <label htmlFor="iroh-user-key" className="sr-only">
            Research API key (unused)
          </label>
          <input
            id="iroh-user-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={keyDraft}
            onChange={(event) => setKeyDraft(event.target.value)}
            placeholder="Not required for Bitget read-only mode"
          />
          <button type="submit" disabled={!keyDraft.trim()}>
            Save
          </button>
          <button type="button" onClick={() => setKeyFormOpen(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="iroh-limit-cta"
          onClick={() => setKeyFormOpen(true)}
        >
          Enter your key
        </button>
      )}
      <a className="iroh-limit-cta" href="#" target="_blank" rel="noreferrer">
        Bitget docs ↗
      </a>
    </div>
  );
  return (
    <div className="iroh-chat">
      <header className="iroh-chat-head">
        <div className="iroh-chat-title">
          <div className="eyebrow">THE HOST · UNCLE</div>
          <h1>
            Ask <em>Uncle</em>
          </h1>
          <p>
            {false || hasUserKey
              ? 'Bitget research desk'
              : 'Uncle · Bitget evidence + Qwen · read-only'}
          </p>
        </div>
        <div className="iroh-chat-actions">
          {user && (
            <button
              type="button"
              aria-controls="iroh-history"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              {historyOpen ? 'Hide history' : 'Chat history'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void newChat()}
            disabled={historyLoading}
          >
            Begin a new conversation
          </button>
        </div>
      </header>
      <div
        className={`iroh-chat-body${historyOpen && user ? ' has-history' : ''}`}
      >
        {user && (
          <aside
            id="iroh-history"
            className="iroh-history"
            aria-label="Chat history"
            hidden={!historyOpen}
          >
            <div className="iroh-history-label">YOUR CHATS</div>
            {historyLoading && <p>Loading chats…</p>}
            {historyError && <p role="alert">{historyError}</p>}
            {history.map((item) => (
              <button
                type="button"
                key={item.id}
                className={item.id === selectedId ? 'is-selected' : ''}
                aria-current={item.id === selectedId ? 'page' : undefined}
                onClick={() =>
                  void openChat(item.id).catch(() =>
                    setHistoryError('Could not open this chat.'),
                  )
                }
              >
                {item.title}
              </button>
            ))}
          </aside>
        )}
        <div
          className="iroh-transcript"
          ref={transcript}
          role="log"
          aria-label="Uncle conversation"
          aria-live="polite"
        >
          {chat.messages.length === 0 && (
            <div className="iroh-greeting">
              <span className="iroh-seal" aria-hidden="true">
                茶
              </span>
              <p className="iroh-greeting-title">
                Ask about a Reality stock — price, coverage, or evidence.
              </p>
              {(false || hasUserKey) && (
                <p>
                  I’ll consult Bitget Research Agent and bring back the Bitget
                  market evidence.
                </p>
              )}
              {research === 'unavailable' && !dailyCap && (
                <p>
                  Uncle can’t reach his research desk right now, so he can’t
                  bring back Bitget evidence. Please try again later.
                </p>
              )}
              {!user && (
                <p>
                  <a href="/account">Log in</a> to save this chat.
                </p>
              )}
            </div>
          )}
          {chat.messages
            // An empty reply shows no card: the activity line below is the
            // one waiting signal, and a failed reply shows the error box.
            .filter(
              (message) => message.content || message.status === 'stopped',
            )
            .map((message) => (
              <article
                className={`iroh-message is-${message.role}`}
                key={message.id}
                ref={
                  message.role === 'assistant' &&
                  message.id === chat.messages.at(-1)?.id
                    ? lastAnswer
                    : undefined
                }
              >
                <div className="iroh-speaker">
                  {message.role === 'user' ? 'You' : 'Uncle'}
                </div>
                {message.content && (
                  <>
                    <IrohMessage content={message.content} />
                    {message.role === 'assistant' && message.provenance ? (
                      <p className="iroh-provenance" role="note">
                        <strong>Provenance</strong>{' '}
                        {[
                          message.provenance.symbol
                            ? `Symbol ${message.provenance.symbol}`
                            : null,
                          message.provenance.mcpSource
                            ? `Source ${message.provenance.mcpSource}`
                            : null,
                          message.provenance.timestamp
                            ? `Fetched ${new Date(message.provenance.timestamp).toLocaleTimeString()}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        {message.provenance.sourceLock && (
                          <span
                            className="iroh-lock"
                            data-withheld={
                              message.provenance.sourceLock.withheld > 0 ||
                              message.provenance.sourceLock.refused
                            }
                          >
                            {' '}
                            Source Lock:{' '}
                            {message.provenance.sourceLock.refused
                              ? 'answer refused, its figures did not match the evidence'
                              : message.provenance.sourceLock.checked === 0
                                ? 'no figures to check'
                                : `${message.provenance.sourceLock.verified} of ${message.provenance.sourceLock.checked} figures matched the Bitget evidence${
                                    message.provenance.sourceLock.withheld > 0
                                      ? `, ${message.provenance.sourceLock.withheld} withheld`
                                      : ''
                                  }`}
                            {message.provenance.sourceLock.usMarketClosed
                              ? '. The US market is closed, so token prices may be thin or stale.'
                              : '.'}
                          </span>
                        )}
                      </p>
                    ) : null}
                  </>
                )}
                {message.status === 'stopped' && (
                  <small>Stopped · partial answer</small>
                )}
              </article>
            ))}
          {chat.isStreaming && (
            <p className="iroh-activity" role="status">
              {true && !hasUserKey
                ? 'Uncle · Bitget evidence + Qwen · read-only'
                : chat.currentTool
                  ? `Researching: ${chat.currentTool}`
                  : 'Uncle is thinking…'}
            </p>
          )}
          {chat.error && (
            <div
              className={`iroh-error${dailyCap ? ' is-limit' : ''}`}
              role="alert"
            >
              <p>{chat.error}</p>
              {dailyCap
                ? !hasUserKey && byokActions
                : (false || hasUserKey) && (
                    <button type="button" onClick={() => session.retry()}>
                      Try again
                    </button>
                  )}
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>
      {hasUserKey && (
        <p className="iroh-byok-using">
          Using research key{' '}
          <button type="button" onClick={clearStoredKey}>
            Clear
          </button>
        </p>
      )}
      <form
        className="iroh-compose"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label htmlFor="iroh-question" className="sr-only">
          Ask a stock research question
        </label>
        <textarea
          id="iroh-question"
          ref={input}
          value={draft}
          maxLength={MAX_QUESTION_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={
            historyLoading
              ? 'Loading your chats…'
              : needsUserKey
                ? dailyCap
                  ? 'Daily limit reached. Enter your key to continue.'
                  : 'Uncle · Bitget evidence + Qwen · read-only'
                : 'Ask about any stock or coin, e.g. Is TSLA stronger than Bitcoin this week?'
          }
          rows={2}
          disabled={
            chat.isStreaming ||
            historyLoading ||
            (Boolean(user) && !selectedId && false)
          }
        />
        <div className="iroh-compose-bottom">
          <span>
            {draft.length}/{MAX_QUESTION_LENGTH} characters
          </span>
          {chat.isStreaming ? (
            <button
              type="button"
              className="primary"
              onClick={() => session.stop()}
              aria-label="Stop generation"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="primary"
              disabled={!draft.trim() || historyLoading || chat.isStreaming}
            >
              Ask Uncle <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
