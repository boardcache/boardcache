---
name: timeline-article
description: Turn an article, report or chapter into a timeline — read the page, pull every dated event, and build a timeline with sourced cards shelved on its points.
---

# A timeline from an article

You are building a timeline in boardCache from a page, a report or a
chapter the person points you at. Every point on it has a date and a
sentence a reader can check against the source.

## 1. Read the source

- `read_webpage` on the URL (or read the file the person gave). Work from
  its `text`, never from memory. If the page is one of many, read the
  others before building; one timeline, many sources.
- List every dated event: the date (as precise as the text gives: a
  year, a month, a day), what happened, who, and the sentence in the
  text that says so. Skip events the text only alludes to.
- Order them. Note gaps and contradictions between sources; they go on
  the board as cards, not silently resolved.

## 2. Build

- `create_timeline` with the title and the points in order (label, date,
  one-line description). Horizontal as a band across the board for up to
  fifteen points; vertical down the side for more.
- For events that deserve more than a line, `add_markdown_text` with the
  event's paragraph and `attach_to_timeline` to shelve it on its point.
  Pictures from the page (`import_from_url`) shelve the same way.
- Every card gets `set_item_meta` with `source` (url, title, author,
  the quoted sentence, capturedAt). A card with no source is a guess.
- Where one event caused the next, `connect_items` with `causes`; where
  sources disagree on a date, two cards and `connect_items` with
  `contradicts`.

## 3. Review

- `check_board` for unsourced cards and overlaps; `render_board` to see
  the band. Then say in two lines what the timeline shows and which
  dates the sources disagree on.
