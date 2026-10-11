import { createContext, useContext, type ReactNode } from 'react';
import { DockPaints, stationGlyph } from '../StationDock';
import { BUILDER, ORIGINAL_REPO_URL, PROJECT, REPO_URL } from './content';
import { LotusMark } from './LotusMark';

export type SketchPage = {
  key: string;
  render: (live: boolean) => ReactNode;
};

const Folio = ({ n }: { n: number }) => (
  <span className="sb-folio" aria-hidden="true">
    {n}
  </span>
);

function sketchSources(src: string) {
  if (src.endsWith('sketch-shop-front.webp')) {
    return {
      src,
      srcSet:
        '/images/waiting-room/sketch-shop-front-640w.webp 640w, /images/waiting-room/sketch-shop-front.webp 960w',
      sizes: '(max-width: 720px) 320px, 40vw',
    };
  }
  if (src.includes('/waiting-room/team-')) {
    return {
      src,
      srcSet: `${src.replace('.webp', '-480w.webp')} 480w, ${src} 768w`,
      sizes: '(max-width: 720px) 240px, 280px',
    };
  }
  return { src, srcSet: undefined, sizes: undefined };
}

/** The same candidate `srcset` would pick, so a page-shot bake is not a second download. */
export function sketchPreloadUrl(src: string) {
  if (typeof window === 'undefined') return src;
  const small = window.matchMedia('(max-width: 720px)').matches;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const team = src.includes('/waiting-room/team-');
  const css = team
    ? small
      ? 240
      : 280
    : small
      ? 320
      : window.innerWidth * 0.4;
  const need = css * dpr;
  if (src.endsWith('sketch-shop-front.webp'))
    return need <= 640 ? src.replace('.webp', '-640w.webp') : src;
  if (team) return need <= 480 ? src.replace('.webp', '-480w.webp') : src;
  return src;
}

/** True inside the sketchbook's hidden baker, whose page copies are never shown. */
export const BakerCopy = createContext(false);

function Sketch({
  src,
  alt,
  live,
  className = '',
  priority = false,
}: {
  src: string;
  alt: string;
  live: boolean;
  className?: string;
  priority?: boolean;
}) {
  const baking = useContext(BakerCopy);
  const image = sketchSources(src);
  return (
    <img
      className={`sb-sketch ${className}`}
      src={image.src}
      srcSet={image.srcSet}
      sizes={image.sizes}
      alt={live ? alt : ''}
      draggable={false}
      // A page turn swaps the leaf's snapshot for this page in one frame; a
      // lazy or async image paints blank for a frame there. Only the hidden
      // baker copies stay lazy, so they never download twice.
      decoding={baking ? 'async' : 'sync'}
      loading={priority || !baking ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
    />
  );
}

const SHOP_SKETCH = '/images/waiting-room/sketch-shop-front.webp';
const ROOM_SKETCH = '/images/waiting-room/sketch-tea-room.webp';

export const SKETCH_PAGES: SketchPage[] = [
  {
    key: 'cover',
    render: (live) => (
      <div className="sb-page-inner sb-cover-art">
        <Sketch
          src={SHOP_SKETCH}
          alt="Ink and watercolour sketch of the tea shop front at dusk, doors open under a cherry tree."
          live={live}
          priority={live}
        />
        <p className="sb-caption-hand">
          The shop at dusk. The doors stay open.
        </p>
        <Folio n={1} />
      </div>
    ),
  },
  {
    key: 'title',
    render: () => (
      <div className="sb-page-inner sb-title">
        <span className="sb-mark" aria-hidden="true">
          <LotusMark variant="sketch" />
        </span>
        <p className="sb-kicker">
          {PROJECT.studio}
        </p>
        <h1 className="sb-name">{PROJECT.name}</h1>
        <p className="sb-tagline">{PROJECT.tagline}</p>
        <span className="sb-rule" aria-hidden="true" />
        <p className="sb-body">{PROJECT.summary}</p>
        <div className="sb-sign">
          <p className="sb-fine">{PROJECT.honesty}</p>
          <span className="sb-seal" aria-hidden="true">
            茶
          </span>
        </div>
        <p className="sb-turn-hint" aria-hidden="true">
          turn the page →
        </p>
        <Folio n={2} />
      </div>
    ),
  },
  {
    key: 'room',
    render: (live) => (
      <div className="sb-page-inner sb-room">
        <Sketch
          src={ROOM_SKETCH}
          alt="Ink sketch of the tea room: the counter and lantern, a low tea table with a teapot, and Uncle, the host, seated beside the shelf with a cup, his straw hat on the floor."
          live={live}
          className="sb-room-art"
        />
        <p className="sb-kicker">Inside</p>
        <h2 className="sb-heading">Four stops, one pot of tea.</h2>
        <p className="sb-body">
          Move through the room at your own pace. The counter reads Bitget
          prices for three stock theses. The shelf shows how much of the
          catalog is checked. Uncle asks Bitget when you talk to him. The
          orrery shows how the biggest stocks are moving.
        </p>
        <Folio n={3} />
      </div>
    ),
  },
  {
    key: 'stations',
    render: () => (
      <div className="sb-page-inner sb-stations">
        <DockPaints />
        <p className="sb-kicker">How the room works</p>
        <ol>
          {PROJECT.steps.map((step) => (
            <li key={step.label}>
              <span className="sb-step-icon" aria-hidden="true">
                <svg viewBox="0 0 32 32">{stationGlyph(step.label)}</svg>
              </span>
              <div>
                <h3>
                  {step.label} <small>{step.caption}</small>
                </h3>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="sb-caption-hand">
          Explore as a guest. Create an account only if you want Uncle to
          remember your conversations.
        </p>
        <Folio n={4} />
      </div>
    ),
  },
  {
    key: 'builder',
    render: (live) => (
      <div className="sb-page-inner sb-hello">
        <p className="sb-kicker">The builder</p>
        <h2 className="sb-heading">Made by {BUILDER.name}.</h2>
        <p className="sb-body">{BUILDER.bio}</p>
        <a
          className="sb-link"
          href={BUILDER.url}
          target="_blank"
          rel="noreferrer"
          tabIndex={live ? undefined : -1}
        >
          @{BUILDER.handle} on GitHub <span aria-hidden="true">↗</span>
        </a>
        <a
          className="sb-link"
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          tabIndex={live ? undefined : -1}
        >
          Explore the code on GitHub <span aria-hidden="true">↗</span>
        </a>
        <div className="sb-sign">
          <p className="sb-fine">
            Built on the open-source{' '}
            <a
              href={ORIGINAL_REPO_URL}
              target="_blank"
              rel="noreferrer"
              tabIndex={live ? undefined : -1}
            >
              Iroh&apos;s Tea Shop
            </a>
            .
          </p>
          <p className="sb-caption-hand">
            The lanterns are lit. Choose a thesis and step inside.
          </p>
        </div>
        <Folio n={5} />
      </div>
    ),
  },
  {
    key: 'end',
    render: () => (
      <div className="sb-page-inner sb-hello sb-end">
        <p className="sb-kicker">End of the book</p>
        <h2 className="sb-heading">Choose a thesis. Check the evidence.</h2>
        <div className="sb-sign">
          <span className="sb-seal" aria-hidden="true">
            茶
          </span>
        </div>
        <Folio n={6} />
      </div>
    ),
  },
];

export const SPREAD_TITLES = ['The Tea Shop', 'The Room', 'The Builder'];
