/** Host session: Bitget MCP + Qwen via POST /api/bitget/research */

export type MessageProvenance = {
  symbol?: string | null;
  instrumentId?: string | null;
  mcpSource?: string | null;
  mcpEntryId?: string | null;
  timestamp?: string | null;
  mcpError?: string | null;
  /** Result of checking the answer's figures against the Bitget evidence. */
  sourceLock?: {
    checked: number;
    verified: number;
    withheld: number;
    refused: boolean;
    usMarketClosed: boolean;
  } | null;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status?: string;
  provenance?: MessageProvenance | null;
};

type Snapshot = {
  messages: ChatMessage[];
  chatId: string | null;
  streaming: boolean;
  isStreaming: boolean;
  error: string | null;
  errorCode: string | null;
  currentTool: string | null;
  lastSymbol: string | null;
  lastInstrumentId: string | null;
};

type Listener = () => void;

function mid() {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export class IrohSession {
  private snapshot: Snapshot = {
    messages: [],
    chatId: null,
    streaming: false,
    isStreaming: false,
    error: null,
    errorCode: null,
    currentTool: null,
    lastSymbol: null,
    lastInstrumentId: null,
  };
  private listeners = new Set<Listener>();
  private abortController: AbortController | null = null;
  private requestGen = 0;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private setStreaming(on: boolean) {
    this.snapshot = {
      ...this.snapshot,
      streaming: on,
      isStreaming: on,
    };
  }

  restore(
    chatId: string | null,
    messages: ChatMessage[],
    _legacyId: string | null,
  ) {
    this.snapshot = {
      ...this.snapshot,
      chatId,
      messages,
      streaming: false,
      isStreaming: false,
      error: null,
      errorCode: null,
      currentTool: null,
    };
    this.emit();
  }

  private thesisId: string | null = null;

  /** The thesis the trader opened Uncle from, or null for a free question. */
  setThesis(id: string | null) {
    this.thesisId = id;
  }

  reset() {
    this.thesisId = null;
    this.abortController?.abort();
    this.abortController = null;
    this.requestGen += 1;
    this.snapshot = {
      messages: [],
      chatId: null,
      streaming: false,
      isStreaming: false,
      error: null,
      errorCode: null,
      currentTool: null,
      lastSymbol: null,
      lastInstrumentId: null,
    };
    this.emit();
  }

  stop() {
    this.abortController?.abort();
    this.abortController = null;
    this.requestGen += 1;
    this.setStreaming(false);
    this.emit();
  }

  setInstrumentContext(input: {
    symbol?: string | null;
    instrumentId?: string | null;
  }) {
    this.snapshot = {
      ...this.snapshot,
      lastSymbol: input.symbol?.trim() || this.snapshot.lastSymbol,
      lastInstrumentId:
        input.instrumentId?.trim() || this.snapshot.lastInstrumentId,
    };
    this.emit();
  }

  async send(
    content: string,
    symbol?: string | null,
    opts?: { appendUser?: boolean; instrumentId?: string | null },
  ): Promise<void> {
    const question = content.trim();
    if (!question) return;

    const appendUser = opts?.appendUser !== false;
    const effectiveSymbol =
      (symbol && symbol.trim()) || this.snapshot.lastSymbol || null;
    const effectiveInstrumentId =
      (opts?.instrumentId && opts.instrumentId.trim()) ||
      this.snapshot.lastInstrumentId ||
      null;

    this.abortController?.abort();
    this.abortController = new AbortController();
    const gen = ++this.requestGen;

    if (appendUser) {
      this.snapshot = {
        ...this.snapshot,
        messages: [
          ...this.snapshot.messages,
          { id: mid(), role: 'user', content: question },
        ],
        lastSymbol: effectiveSymbol,
        lastInstrumentId: effectiveInstrumentId,
        error: null,
        errorCode: null,
        currentTool: null,
      };
    } else {
      this.snapshot = {
        ...this.snapshot,
        lastSymbol: effectiveSymbol,
        lastInstrumentId: effectiveInstrumentId,
        error: null,
        errorCode: null,
        currentTool: null,
      };
    }

    this.setStreaming(true);
    this.emit();

    try {
      const response = await fetch('/api/bitget/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          symbol: effectiveSymbol || undefined,
          instrumentId: effectiveInstrumentId || undefined,
          thesisId: this.thesisId || undefined,
          priorMessages: this.snapshot.messages
            .filter(
              (m) =>
                m.role === 'user' ||
                (m.role === 'assistant' && m.status === 'complete'),
            )
            .slice(-9)
            .map(({ role, content }) => ({ role, content })),
        }),
        signal: this.abortController.signal,
      });

      if (gen !== this.requestGen) return;

      const data = (await response.json()) as {
        answer?: string;
        error?: string;
        provenance?: MessageProvenance;
      };

      if (!response.ok) {
        throw new Error(data.error || `Research failed (${response.status})`);
      }

      const answer = (data.answer || '').trim() || 'No response generated.';
      this.snapshot = {
        ...this.snapshot,
        messages: [
          ...this.snapshot.messages,
          {
            id: mid(),
            role: 'assistant',
            content: answer,
            status: 'complete',
            provenance: data.provenance ?? null,
          },
        ],
        error: null,
        errorCode: null,
        currentTool: null,
      };
      this.setStreaming(false);
      this.emit();
    } catch (error: unknown) {
      if (gen !== this.requestGen) return;
      const err = error as { name?: string; message?: string };
      if (err?.name === 'AbortError') {
        this.setStreaming(false);
        this.emit();
        return;
      }
      this.snapshot = {
        ...this.snapshot,
        error: err?.message || 'Failed to fetch research',
        errorCode: 'research_api_error',
      };
      this.setStreaming(false);
      this.emit();
    }
  }

  async retry(): Promise<void> {
    const lastUser = [...this.snapshot.messages]
      .reverse()
      .find((m) => m.role === 'user');
    if (!lastUser) return;
    const idx = this.snapshot.messages.lastIndexOf(lastUser);
    this.snapshot = {
      ...this.snapshot,
      messages: this.snapshot.messages.slice(0, idx + 1),
      error: null,
      errorCode: null,
      currentTool: null,
    };
    this.emit();
    await this.send(lastUser.content, this.snapshot.lastSymbol, {
      appendUser: false,
      instrumentId: this.snapshot.lastInstrumentId,
    });
  }
}
