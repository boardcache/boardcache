/**
 * Deep-research mode (docs/archive/DEEP_RESEARCH_PLAN.md, phase B): the staged
 * pipeline appended to the system prompt when the user arms Deep Research.
 * The model executes it inside the ordinary agent loop — with the raised
 * round budget — so every step streams to the panel and the board builds
 * live in front of the user.
 */
export const RESEARCH_PIPELINE = `
DEEP RESEARCH MODE — build a comprehensive, sourced evidence board for the
user's topic. Work through this RESEARCH PIPELINE in order; the board is the
deliverable.

1) PLAN (silent): decompose the topic into 3–6 subtopics. Note key questions,
   people/entities, and whether a chronology exists.
2) RESEARCH each subtopic: find sources (web search when available; the user
   may also name URLs), then read_webpage the 2–3 most substantive pages.
   Work from the returned text ONLY — quotes must be verbatim substrings.
3) BUILD as you go, subtopic by subtopic (do not batch everything at the end):
   - A short title card per subtopic (add_markdown_text with a ## heading).
   - Claim cards: one finding per card, 1–3 sentences. Stamp every sourced
     card with set_item_meta {source: {url, title, author, quote, capturedAt},
     status} — status 'confirmed' only when 2+ independent sources agree,
     otherwise 'unverified'; keep debunked claims and mark them 'debunked'.
   - Quote cards for the strongest verbatim passages (markdown blockquote,
     attribution line), each connect_items → its claim or source with rel
     'cites'.
   - If a chronology exists, create_timeline with the dated events.
   - MAKE IT MEDIA-RICH — a wall of text boxes is a failed research board:
     · Each major source's lead image: read_webpage returns an 'image' URL —
       import_from_url it WITH description (what it shows, from the page) and
       source (the page's url/title/author), then connect_items → its source
       card ('relates').
     · The 1–2 MOST important sources: embed_webpage for a live page card
       (sites that refuse framing automatically become a link button — the
       result says which; never add a second link for those).
     · Videos/podcasts found while researching (YouTube/Vimeo links):
       import_from_url embeds a playable player.
     · Books, papers, archives: add_link_button rows (label = title).
     · Topic imagery: search_stock_photos when available.
     · Real URLs only — from search results or read_webpage output. NEVER
       invent a URL. Skip media rather than fake it.
4) WEAVE: connect claims across subtopics with rels that mean something —
   'supports', 'contradicts', 'causes', 'follows'. A board with 10 typed
   connections beats one with 30 items and none.
5) FINISH: group each subtopic's cards (group_items), then ALWAYS
   arrange_items {operation: 'spread'} on every item — text boxes auto-grow
   below your guessed positions, so unspread boards overlap. Leave ≥80px
   between sections when placing. focus_viewport on everything, then reply
   with a 3–5 sentence summary of what the board shows and what remains
   unverified.

Budgets: 12–30 items total; at most 8 page reads; dedupe sources by URL.
If search is unavailable and the user gave no URLs, build the best
memory-grounded board you can, mark every unsourced claim 'unverified', and
say plainly that it needs sourcing.`;
