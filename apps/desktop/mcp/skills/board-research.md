---
name: board-research
description: Research a subject thoroughly and build a boardCache board from it — sourcing hierarchy, verification and rights rules, the board tools to use, and how to make each board visually its own.
---

# Research a subject and build a board

You are building a research board in boardCache for a person who will read
it, share it, and judge it on whether it is true, well sourced and good to
look at. Work in four passes: frame, gather, build, review. Do not skip
the review.

## 1. Frame the request

- Restate the subject as one or two questions the board should answer. A
  mystery has a "what happened?"; a comparison has "which is better for
  whom?"; a history has "how did we get here?".
- Decide what a reader must leave with: three to seven claims they can
  check, with the evidence for each.
- Note what is contested. Contested claims need two independent sources
  and get a **case** (see below) rather than a flat statement.
- Note the rights constraints: the board may be shared publicly, so quotes
  stay short and attributed, and images are public domain, Creative
  Commons or CC0 unless the person says otherwise.

## 2. Gather

Order of trust, highest first. Work down the list; say on the board which
level a fact comes from.

1. **Primary sources**: the document, the data, the recording, the court
   file, the press release, the person's own words. Quote them.
2. **Scholarly and official**: peer-reviewed papers, government reports,
   museum and archive catalogues, standards bodies.
3. **Reputable secondary**: books by named authors, established newspapers
   and magazines, named journalists.
4. **Tertiary**: encyclopaedias, including Wikipedia. Use these as a map of
   the subject and a bibliography, then go to what they cite. Quote them
   only when the wording itself is the point.
5. **Social and forums**: X/Twitter, Bluesky, Mastodon, Reddit, blogs. A
   post is a primary source for what its author said and when, and nothing
   more. Record the handle, the date and a link; verify any factual claim
   elsewhere before relying on it.

Where to look, with what each needs. When the boardCache Research plugin
is on, start with `research_sources` to see which providers this device
can reach, then use `search_web`, `search_news`, `search_papers`,
`search_collections`, `search_books` and `search_social`; they return
normalised results (title, url, snippet, date, author, site, image,
license) you can cite and import directly. Otherwise, or in addition:

- **Search**: use your web search tool first; refine with site: filters
  (site:gov, site:edu, site:ac.uk), dates, and the subject's own vocabulary.
  When a page refuses automated fetching (Cloudflare "Just a moment",
  HTTP 403), find the same material elsewhere: a syndicated copy, the
  publisher's press release, an archive. Do not scrape around a block.
- **Wikipedia and Wikidata**: the article's wikitext via the API gives you
  clean text and the reference list; the Commons API gives image
  licences. Text is CC BY-SA 4.0; say so when you quote it.
- **Digitised newspapers**: the Library of Congress (Chronicling America,
  United States before 1963; everything before 1929 is public domain) has a
  JSON search, OCR text per page and IIIF image crops; Trove (Australia)
  and Europeana (Europe) are similar, with free keys. For OCR, transcribe
  the passage from the scan yourself rather than quoting garbled OCR.
- **Books**: Wikisource and Project Gutenberg for public-domain text; the
  Internet Archive for page scans (search, then the djvu XML to find the
  leaf, then the page image). Google Books gives snippets only, needs a
  key with quota, and the snippet must be quoted as a snippet.
- **Papers**: arXiv, PubMed, OpenAlex and CrossRef need no key; Semantic
  Scholar is better with one. Prefer the paper's own abstract to a news
  summary of it.
- **Images**: Wikimedia Commons, the Smithsonian Open Access collection,
  the Met, the Rijksmuseum, NASA, the Library of Congress, Flickr Commons.
  Read the licence on the file page, not the search result. Record artist,
  date, licence and the file page URL for every image.
- **Official records**: court dockets, legislative records, company
  filings, FOIA reading rooms. Some block automated fetching (the FBI site
  does); the Internet Archive's Wayback Machine often has the page.
- **Data**: when numbers matter, get the table, not the sentence about it,
  and cite the dataset and its date.

Rules while gathering:

- Never quote from memory. Every quotation on the board is copied from a
  source you fetched in this session, and carries the source URL, title,
  author if known, and the date you captured it.
- Keep copyrighted quotations short: a sentence or two that the board
  needs, with a link to the rest. Public-domain and CC-licensed text may be
  quoted at length with the licence named.
- Two independent sources for any contested or surprising claim; note when
  all the sources trace back to one origin.
- Write down what you could not find or verify. A board that says "the
  only source for this is X" is better than one that hides it.
- Keep a running credits list as you go: text sources with licences,
  images with artist, date, licence and file page.

## 3. Build

Use the board tools (call `get_board_summary` first on an existing board).
Every item that comes from a source gets `set_item_meta` with `source`
(`url`, `title`, `author`, `quote`, `capturedAt`) and, for evidence, a
`status` (confirmed, unverified, debunked) and a `weight` 1–5.

Strength scale, say it on the board's case card:
4–5 documented primary finding or data; 3 a documented experiment, a
decisive objection or an official finding; 2 a reasoned theory or a
circumstantial fact; 1 an opinion, a recollection or an unverified report.

Structures, and when to use them:

- **Case** (`add_case`, `link_evidence`, `edit_case`): a question with
  competing conclusions. Link each evidence item to every conclusion it
  bears on, with stance and relevance, so the scores mean something. One
  case per contested question.
- **Timeline** (`create_timeline`, `edit_timeline`, `attach_to_timeline`):
  anything with dates. Shelve the photographs and documents on their
  points. Vertical when it runs down the side of a board, horizontal as a
  band.
- **Tree / mind map** (`add_tree`, `attach_to_tree`): how a story,
  argument or taxonomy branches.
- **Tier list** (`add_tierlist`, `place_in_tier`): ranking by a stated
  criterion (credibility, cost, quality). Resize the tier list tall before
  ranking cards so they stay readable.
- **Storyboard** (`add_storyboard`, `frame_in_storyboard`): sequences of
  images or scenes.
- **Project** (`create_project`, `add_task`): plans with dates and work.
- **Connections** (`connect_items`): typed lines (supports, contradicts,
  cites, follows, causes) with a short label. Use them where a reader
  needs to see the relation, not everywhere.
- **Groups** (`group_items`, `edit_group`): one per band or theme, with a
  quiet background tint; the presentation tour can step to a group.
- **Documents**: `add_html_embed` for a table or a period-styled document;
  `add_markdown_text` for everything else; `import_file` / `import_from_url`
  for scans, photographs, PDFs; `add_link_button` to an article;
  `add_qr_code` for the main source; `extract_palette` from a key image;
  `add_map` for places.
- Always: a title, a short standfirst saying what the board is and how to
  read it, a **Sources and credits** card, a cover item
  (`set_board_appearance`), and a presentation tour (`set_presentation`)
  of eight to twelve steps that reads like a guided walk.

Make the board its own. Boards built by the same hand look alike; avoid
it on purpose:

- Choose a shape for the subject: a hero image with the title over it; a
  ledger of small slips instead of a table; a vertical log beside a ring of
  evidence around the case ("string board"); a wall of captioned
  portraits; a document band of scans with transcriptions beside them; a
  tier list for the retellings. Mix two or three, not all.
- Vary card widths, use text backgrounds and type sizes (`set_text_style`),
  a few tinted "pinned notes", captions on images
  (`set_image_options` with `caption`), and a board theme that fits the
  subject (`set_board_appearance` with `themeId`: corkboard for an
  investigation, nord for the sea, solarized for a document trove).
- Lay out by measuring: create, read sizes with `get_items`, then
  `move_items` to exact positions; `arrange_items` with `spread` to fix
  overlaps. Containers carry their shelved items when moved.
- Keep type readable at the zoom a reader will use; check the board at
  "fit to screen" and at 100%.

## 4. Review

Before you call it done:

- Export a PNG (`export_board` with `format: png` in the desktop app) and
  look at it: overlaps, orphaned items, unreadable text, empty space.
- Open `get_board_summary` and check every evidence item has a source,
  a status and a weight, and that the case scores read the way the
  evidence does.
- Read the credits card against the items: every image credited, every
  quoted source listed with its licence.
- Walk the presentation tour once.
- Say, in your reply to the person, what you could not verify and which
  judgement calls (strengths, rankings) are yours.
