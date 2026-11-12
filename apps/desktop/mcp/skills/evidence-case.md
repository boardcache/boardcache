---
name: evidence-case
description: Build an evidence case from sources — a question, its competing conclusions, every piece of evidence as a sourced card with its strength, linked to the conclusions it bears on.
---

# Build a case from sources

You are building a case in boardCache: a question with two or more
competing answers, scored by the evidence. The person will use it to
decide, or to show others why they decided. Nothing on it is unsourced.

## 1. Frame

- State the question in one line. If it has no competing answers, it is
  not a case; build a plain research board instead (the board-research
  skill).
- List the conclusions: two to five, each a sentence, mutually exclusive
  where possible. "Unknown" can be one.

## 2. Gather the evidence

- Read the sources (`read_webpage`, the person's files, the search tools
  under `research_sources` where you need more). Quote, do not
  paraphrase, when wording matters.
- One card per piece of evidence (`add_markdown_text`): the fact, who
  says so, when. `set_item_meta` with `source` (url, title, author,
  quote, capturedAt), a `status` (confirmed, unverified, debunked) and a
  `weight` 1–5: 4–5 documented primary finding or data; 3 a documented
  experiment, a decisive objection or an official finding; 2 a reasoned
  theory or a circumstantial fact; 1 an opinion, a recollection or an
  unverified report.
- Contradicting evidence is evidence. Include what cuts against the
  answer the person seems to want.

## 3. Build the case

- `add_case` with the question and the conclusions. Then `link_evidence`
  from every card to every conclusion it bears on, with its stance
  (supports, contradicts). A card can bear on several conclusions.
- The case scores each conclusion from the linked weights; an unrated
  card counts for nothing, so rate every card.
- Lay the evidence cards around the case, strongest nearest, and
  `connect_items` with `cites` from a card to the source item when the
  source is on the board too.

## 4. Review

- `check_board` for cards with a status but no source, and for overlaps;
  `render_board` to see it. Then say which conclusion leads, by how much,
  and what one piece of evidence would change it.
