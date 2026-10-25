'use client';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  describeFigure,
  type FigureKind,
  type SourceRef,
} from '../thesis/source-ref';
import './styles/source-lock.css';

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString() : 'not given by the source';

/**
 * A number that explains itself. Tap it to see where it came from: the source,
 * the instrument, when Bitget observed it, when this app fetched it, whether the
 * US market was shut, and whether it is a fact read from Bitget or arithmetic
 * done by this app. Without a source it shows as plain text and is not offered
 * as evidence.
 */
export function SourcedNumber({
  source,
  kind,
  children,
  label,
}: {
  source: SourceRef | null | undefined;
  kind: FigureKind;
  children: ReactNode;
  /** What the number is, for screen readers, such as "Apple last close". */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(
    null,
  );
  const button = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 16);
    const left = Math.min(
      Math.max(8, rect.left),
      window.innerWidth - width - 8,
    );
    // Open above when there is more room there than below.
    const below = window.innerHeight - rect.bottom;
    const top =
      below < 220 && rect.top > below
        ? Math.max(8, rect.top - 6 - 200)
        : rect.bottom + 6;
    setPlace({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (card.current?.contains(target) || button.current?.contains(target))
        return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (!source) return <>{children}</>;
  const note = describeFigure(kind, source);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="srcnum"
        data-state={note.state}
        data-open={open ? 'true' : 'false'}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
      >
        {children}
        <span className="sr-only">
          {label ? `, ${label}` : ''}. Show source.
        </span>
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={card}
            id={id}
            role="group"
            aria-label="Where this number comes from"
            className="srcnum-card"
            data-state={note.state}
            data-srcnum-open="true"
            style={{
              top: place?.top ?? 0,
              left: place?.left ?? 0,
              visibility: place ? 'visible' : 'hidden',
            }}
          >
            <p className="srcnum-chip" data-state={note.state}>
              {note.state === 'observed'
                ? 'Observed fact'
                : 'Computed by this app'}
            </p>
            <p className="srcnum-how">{note.how}</p>
            <dl>
              <div>
                <dt>Source</dt>
                <dd>{source.label}</dd>
              </div>
              {source.instrumentId && (
                <div>
                  <dt>Instrument</dt>
                  <dd>{source.instrumentId}</dd>
                </div>
              )}
              <div>
                <dt>As of</dt>
                <dd>{when(source.observedAt)}</dd>
              </div>
              {source.windowStart && (
                <div>
                  <dt>Window from</dt>
                  <dd>{when(source.windowStart)}</dd>
                </div>
              )}
              <div>
                <dt>Fetched</dt>
                <dd>{when(source.fetchedAt)}</dd>
              </div>
            </dl>
            {source.marketClosed && (
              <p className="srcnum-closed">
                The US market is closed, or was when this was observed. A token
                price can be thin or stale. Exchange holidays are not checked.
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
