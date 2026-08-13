// Renders a post's key points as a plain typographic card (SVG -> PNG).
//
// Why not a generated picture: an AI image on a compliance post is the visual
// equivalent of an em dash. It reads as filler, it says nothing the text
// doesn't, and the tells (warped text, six-fingered stock photo people) are
// exactly what we spent the style rules avoiding. A card that states the
// framework, the claim, and two or three checkable points is information the
// reader can act on from the feed without expanding the post.
//
// It's also deterministic and free: no model call, no quota, same input gives
// the same image.
import { Resvg } from '@resvg/resvg-js';

// LinkedIn renders a square at full width in the feed and crops nothing.
const W = 1200;
const H = 1200;

// Matches the status page's palette so the card, the dashboard, and the repo
// all look like one thing.
const BG = '#0E1217';
const PANEL = '#161C24';
const TEXT = '#E8EBEF';
const MUTED = '#8B96A3';
const ACCENT = '#4CAF7D';
const RULE = '#26313C';

const FONT = 'DejaVu Sans, Liberation Sans, Arial, Helvetica, sans-serif';

function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])
  );
}

// resvg has no text layout engine we can query before rendering, so line
// breaking uses an average glyph width, measured against DejaVu Sans for
// mixed-case English. Bold is meaningfully wider than regular at the same
// point size and needs its own figure: sharing one estimate is what ran the
// first headline off the right edge of the card.
const AVG_GLYPH = 0.53;
const BOLD_GLYPH = 0.63;

function wrap(text, fontSize, maxWidth, glyph = AVG_GLYPH) {
  const maxChars = Math.max(8, Math.floor(maxWidth / (fontSize * glyph)));
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Shrink until the headline fits the space instead of letting a long title
// run off the card.
function fitHeadline(text, maxWidth, maxLines, start = 68, min = 40) {
  for (let size = start; size >= min; size -= 3) {
    const lines = wrap(text, size, maxWidth, BOLD_GLYPH);
    if (lines.length <= maxLines) return { size, lines };
  }
  const lines = wrap(text, min, maxWidth, BOLD_GLYPH).slice(0, maxLines);
  return { size: min, lines };
}

// Key points are written for a brief, not for a card: some are full sentences
// with a subordinate clause. Take the first sentence, and if that's still long,
// cut at a word boundary rather than mid-word.
function condense(point, limit = 130) {
  let s = String(point).trim().replace(/\s+/g, ' ');
  const firstSentence = s.match(/^(.+?[.!?])(\s|$)/);
  if (firstSentence && firstSentence[1].length >= 40) s = firstSentence[1];
  s = s.replace(/[.]$/, '');
  if (s.length <= limit) return { text: s, truncated: false };
  const cut = s.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  const text = (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:]$/, '');
  return { text: `${text}...`, truncated: true };
}

// A point cut off mid-clause ("...for in scope financial...") tells the reader
// nothing and looks careless. Briefs usually contain a mix of one-line facts
// and long explanatory ones, so fill the card with the points that survive
// whole and only fall back to a truncated one if there aren't enough.
function pickPoints(points, maxPoints) {
  const condensed = points.filter(p => typeof p === 'string' && p.trim()).map(p => condense(p));

  const whole = condensed.filter(p => !p.truncated);
  const cut = condensed.filter(p => p.truncated);
  return [...whole, ...cut].slice(0, maxPoints).map(p => p.text);
}

const PAD = 84;
// The band the content block has to live in: below the top margin, clear of
// the footer baseline. Layout reports its own height so it can be checked
// against this instead of being eyeballed against a rendered image.
const MIN_TOP = PAD + 40;
const FOOTER_TOP = H - PAD - 34;
const MAX_CONTENT = FOOTER_TOP - MIN_TOP;

/**
 * Lay the card out from y=0, returning the drawing commands and the height
 * they occupy. Separated from SVG assembly so the caller can measure a
 * candidate layout and back off before committing to it.
 */
function layout({ eyebrow, title, points, footer }, maxPoints) {
  const inner = W - PAD * 2;

  const head = fitHeadline(title, inner, 4);
  const chosen = pickPoints(points, maxPoints);

  const parts = [];
  const BODY = 34;
  const BODY_LINE = 46;
  let y = 0;

  if (eyebrow) {
    parts.push(
      `<text x="${PAD}" y="${y}" font-family="${FONT}" font-size="26" font-weight="600" fill="${ACCENT}" letter-spacing="3">${esc(
        eyebrow.toUpperCase()
      )}</text>`
    );
    y += 30;
  }

  parts.push(`<rect x="${PAD}" y="${y}" width="72" height="5" fill="${ACCENT}"/>`);
  y += 72;

  for (const line of head.lines) {
    y += head.size;
    parts.push(
      `<text x="${PAD}" y="${y}" font-family="${FONT}" font-size="${head.size}" font-weight="700" fill="${TEXT}">${esc(
        line
      )}</text>`
    );
    y += 14;
  }

  if (chosen.length) {
    y += 46;
    parts.push(
      `<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${RULE}" stroke-width="2"/>`
    );
    y += 44;

    for (const point of chosen) {
      const lines = wrap(point, BODY, inner - 70);
      const boxTop = y;
      const boxHeight = lines.length * BODY_LINE + 34;

      parts.push(
        `<rect x="${PAD - 24}" y="${boxTop}" width="${inner + 48}" height="${boxHeight}" rx="12" fill="${PANEL}"/>`,
        `<circle cx="${PAD + 6}" cy="${boxTop + 34}" r="6" fill="${ACCENT}"/>`
      );

      // First baseline sits one font-size below the box padding; each further
      // line advances by the line height.
      let ty = boxTop + 17 + BODY;
      for (const line of lines) {
        parts.push(
          `<text x="${PAD + 32}" y="${ty}" font-family="${FONT}" font-size="${BODY}" fill="${TEXT}">${esc(
            line
          )}</text>`
        );
        ty += BODY_LINE;
      }

      y = boxTop + boxHeight + 20;
    }
    // Trailing gap after the last box isn't part of the block.
    y -= 20;
  }

  return { parts, height: y, pointsUsed: chosen.length };
}

/**
 * Build the card SVG. Exported separately from the PNG render so the layout
 * can be inspected and measured without rasterising.
 *
 * Drops key points rather than overflowing: three points is the target, but a
 * long headline plus three long points does not fit, and a card whose last
 * line runs under the footer looks broken in a way that a two-point card does
 * not.
 */
export function buildCardSvg(spec) {
  const points = spec.points ?? [];

  let chosen = null;
  for (let n = Math.min(3, points.length); n >= 1; n--) {
    const candidate = layout({ ...spec, points }, n);
    chosen = chosen ?? candidate;
    if (candidate.height <= MAX_CONTENT) {
      chosen = candidate;
      break;
    }
  }
  const result = chosen ?? layout({ ...spec, points }, 0);

  // Centre in the available band, but never ride up past the top margin.
  const offset = Math.max(MIN_TOP, MIN_TOP + (MAX_CONTENT - result.height) / 2);

  const footerEl = spec.footer
    ? `<text x="${PAD}" y="${H - PAD}" font-family="${FONT}" font-size="26" fill="${MUTED}">${esc(
        spec.footer
      )}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect x="0" y="0" width="${W}" height="10" fill="${ACCENT}"/>
  <g transform="translate(0, ${offset.toFixed(1)})">
  ${result.parts.join('\n  ')}
  </g>
  ${footerEl}
</svg>`;
}

/** Measured height of the content block, for tests and overflow checks. */
export function measureCard(spec) {
  const points = spec.points ?? [];
  for (let n = Math.min(3, points.length); n >= 1; n--) {
    const candidate = layout({ ...spec, points }, n);
    if (candidate.height <= MAX_CONTENT) return { ...candidate, fits: true, max: MAX_CONTENT };
  }
  const last = layout({ ...spec, points }, 1);
  return { ...last, fits: last.height <= MAX_CONTENT, max: MAX_CONTENT };
}

/**
 * Render the card to PNG bytes.
 *
 * Throws if the rasteriser produced nothing usable, rather than returning a
 * blank image: a card with invisible text (a missing font on the runner, say)
 * is worse than no card, because it would still get attached to a real post.
 */
export function renderCardPng(spec) {
  const svg = buildCardSvg(spec);
  const png = new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
    fitTo: { mode: 'width', value: W },
  })
    .render()
    .asPng();

  // A card whose glyphs all failed to resolve still rasterises, just as flat
  // background. Real text compresses far worse than a solid field, so a tiny
  // PNG at this size means the type didn't render.
  if (png.length < 6000) {
    throw new Error(
      `card rendered to only ${png.length} bytes, which means no text was drawn ` +
        '(likely no usable system font). Refusing to attach a blank image.'
    );
  }
  return png;
}
