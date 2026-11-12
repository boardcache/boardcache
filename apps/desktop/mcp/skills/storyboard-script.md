---
name: storyboard-script
description: Storyboard a script or scene — break the text into shots, give each a frame, a shot size, action and dialogue notes, and lay them on a storyboard in order, ready to present.
---

# Storyboard a script

You are turning a script, a scene description or a treatment into a
storyboard in boardCache for a person who will shoot, animate or pitch
it. Shots in order, each with a picture and the notes a crew needs.

## 1. Break it down

- Read the whole text first. Split it into shots: a new shot at every
  change of subject, place, shot size or beat. Eight to twenty shots for a
  scene; for a longer script, one storyboard per scene.
- For each shot write: shot number, size (wide, medium, close-up, insert),
  movement if any (pan, push in, static), what happens, and the dialogue
  or sound that plays over it. Keep each note under forty words.

## 2. Build the storyboard

- `add_storyboard` with the title and one panel per shot, in order, with
  the notes as each panel's text. Panels carry the caption; the pictures
  come next.
- Pictures: `generate_image` when the person has hosted AI and wants
  drawn frames (describe the shot size, the subject, the angle and the
  light, in one sentence), or `search_stock_photos` and `import_from_url`
  for reference frames. Then `frame_in_storyboard` to place each picture
  in its panel. A panel without a picture is fine: the note still reads.
- From a video the person already has, `set_media_markers` at the cuts
  and `storyboard_from_markers` build the panels from the footage.
- Dialogue that matters goes on its own `add_markdown_text` card next to
  the panel, in quotes, so it can be read aloud.

## 3. Present

- `set_presentation` with the panels in order, so Present walks the
  storyboard shot by shot.
- `add_title` with the scene name and slug line above the storyboard;
  `set_board_appearance` to a dark background if the frames are drawn,
  light if they are photographs.
- `check_board` for stranded cards, `render_board` to see the whole
  board, then say how many shots and what the hardest one to shoot is.
