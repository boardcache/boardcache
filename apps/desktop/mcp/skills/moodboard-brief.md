---
name: moodboard-brief
description: Build a moodboard from a creative brief — read the brief for its mood, materials and audience, then assemble real pictures, a palette, type and mood words on one board that reads at a glance.
---

# Build a moodboard from a brief

You are assembling a moodboard in boardCache for a person who will use it
to brief others: a designer, a client, a crew. It has to read in ten
seconds and hold up on a second look. Work in three passes: read, gather,
compose.

## 1. Read the brief

- Pull out the mood in three to five words (quiet, brass, dusk, worn),
  the materials and places it names, the audience, and anything it rules
  out. Keep these words: they become the mood words on the board.
- Decide the board's one sentence: what it is for and for whom. That
  sentence goes under the title.
- If the brief is thin, ask one question, not five, then proceed.

## 2. Gather

- Pictures come from `search_stock_photos` and land through
  `import_from_url`, or from `generate_image` when the person has hosted
  AI and asks for made pictures. Never type a picture URL from memory.
- When `create_moodboard` is available, use it first: it lays down the
  title and brief, a palette, real photos, mood words and a font
  specimen in one call. Then refine with the smaller tools.
- Six to twelve pictures. Fewer, stronger pictures beat a wall. Vary the
  scale: a wide establishing shot, two or three textures, one detail.
- The palette: `extract_palette` from the strongest picture, or
  `add_palette` with five swatches when the brief names colours. One
  palette per board.
- Type: one `add_title` in a face that fits the mood (`set_text_style`
  with `fontFamily`), and body text in the default face.

## 3. Compose

- Title top left, the sentence under it, the palette as a strip beside
  or below the title, pictures in a loose grid, mood words as short
  `add_markdown_text` cards tucked between pictures.
- `arrange_items` with `organize` for a first grid, then move the hero
  picture to the top and make it larger with `resize_item`.
- `set_board_appearance` to a background that lets the pictures breathe:
  near-white for bright boards, deep grey for night ones.
- Group it with `group_items` so it moves as one.
- Credit every picture: `set_item_meta` with `source` (url, title,
  author) so the board can be shared without a rights problem.
- Finish with `check_board` for overlaps and `render_board` to look at
  it. Fix what you see; then say in one line what mood the board carries.
