# Changelog

What changed in boardCache, for people who use it or build it: the app, the
desktop shell, the clipper, the schema and the open packages. Newest first;
dates are when the change landed. Each release's section becomes the notes of
the matching GitHub release.

## Unreleased

### Highlights

- **A Notes view.** Every text box on a board is a note: a list in folders, tabs, split panes, `[[links]]` between notes with backlinks, `![[embeds]]` of the board's pictures, frontmatter properties, a live Markdown editor with real tables you type into, and an import for a whole Obsidian vault. Notes written in the view stay off the canvas until you put them there.
- **Mail on the board.** Drop `.eml`, `.emlx`, `.mbox` or `.msg` files to keep messages as cards, and read your own mailboxes in an Email view that talks to your IMAP and SMTP servers through a stateless proxy: folders, search, reply, compose in HTML, Markdown or plain text with Bcc and drafts, multi-select, and Save to Board. Credentials never leave your devices.
- **Feeds, Calendar, Contacts, Graph and Projects as full views.** RSS feeds in folders with a reader and OPML import and export; a calendar with Month, Week, Day and List; contacts and contact lists from vCards with social profiles; a rebuilt Graph View with clusters, kinds and a legend; project tasks as pages with reminders.
- **Views beside the canvas.** Every full-screen view pops out into a window of its own, and two windows of one board edit it live, undo included.
- **Kanban boards, file cards and more on the canvas.** Standalone kanban boards with drag-to-file columns; any file the canvas cannot show kept as a downloadable card; video markers, A/B loops and rewind; sharper images at every zoom; a left rail of view icons; the command palette covering every menu.
- **Agents that work and can be checked.** Agents draw diagrams, run plans, check their own work, see the board and search the library within the limits you set under Privacy; their changes are held for review; the desktop app runs Claude Code from a button and can stay in the background.
- **Boards as folders, media per board, notifications.** The desktop app keeps boards as readable folders on disk, media belongs to its board, and reminders reach you by push in the browser or by email.
- **Hardened.** A second security review covered everything above: pinned outbound connections, sandboxed captures, verified share claims, stricter pop-out links and notification paths, and patched dependencies.

### Agents

- The desktop app can keep running in the background: with the switch on
  under Settings → General → Agents, closing the last window leaves the app
  in the tray, so an agent on the same computer, a scheduled one included,
  reaches it while nobody is looking. Launching with `--background` starts
  it that way, with no window. (2026-11-07)
- An agent's changes are held for review: the items it touched carry a
  mark, a bar says who changed how many, Show frames them, Keep lets them
  stand, Undo all takes every step back at once, and the board does not
  sync until you keep them. Your own edits are never held. Switch it off
  under Settings → Privacy to have changes land as they come. (2026-11-07)
- Five more skills ship with the desktop app's agent server, each a method
  for one kind of board: a moodboard from a brief, a storyboard from a
  script, a timeline from an article, an evidence case from sources, a
  project plan from a document. Every one is a resource, a prompt and a
  Claude Code skill. (2026-11-07)
- Recipes: a template can carry instructions for an agent. Write them with
  the Recipe button on the template card or File → Recipe Instructions;
  agents list recipes and start one, which makes a fresh board from the
  template and hands the instructions over, and Claude Code offers each
  recipe as a prompt. (2026-11-07)
- Agents can draw: `add_diagram` turns a Mermaid flowchart, a Graphviz
  DOT graph or plain "A -> B: label" lines into cards laid out in layers,
  with a shape behind decisions and circles, labelled connections, and
  groups for subgraphs, the whole drawing grouped and brought into view.
  (2026-11-07)
- Agents can check their work: `check_board` lists what an agent cannot
  see while it builds, with the ids to act on. Overlapping items, items
  stranded far from everything, empty containers, plain connections that
  say nothing, claims with no source, orphans of deleted pages, the same
  picture twice, texts that say nearly the same thing. (2026-11-07)
- Agents can build in one go: `apply_plan` runs a list of tool calls as a
  single undo step, checked before anything runs and taken back whole if a
  step fails, with later steps able to use what earlier ones returned.
  (2026-11-07)
- Settings has a Privacy section. It says how far an agent's tools reach
  beyond the board you point it at, for the in-app assistant and outside
  agents alike: whether an agent may search your other boards (off, every
  unlocked board, or only the folders you tick; locked boards and locked
  folders are never searched) and whether it may render a picture of the
  board. The anonymous feature counts moved here from General. (2026-11-07)
- Agents can see the board: `render_board` returns a picture of what is on
  screen, a whole page or chosen items, with the items inside it listed by
  position, so an agent can check a layout it just built. (2026-11-07)
- Agents can look across boards: `search_library` finds material on the
  other boards you have opened to them, by keyword and by meaning where
  the on-device model has read a board, and says which boards it searched,
  left out or skipped. (2026-11-07)

### Library and sync

- The boards index's cards carry no border or shadow in any view; the
  open board shows a thin ring. In the Details view the New Board line is
  one row among the rest, with no box of its own.
- Changes made on another device arrive within a second or two instead
  of on the next half-minute check: each signed-in device keeps a light
  channel open to the server that says only "a board changed", and the
  device pulls at once. The timed check stays as a safety net, a few
  minutes apart while the channel is open. Nothing about the board travels
  on the channel; the pull is the same end-to-end encrypted sync as before.
- Team rooms and the new channel keep themselves alive through proxies
  with a regular heartbeat, so a long-open board no longer drops its
  connection after a quiet spell.
- A Details view for the boards index beside Small cards, Cards and List: a
  compact text list with a small icon, the name, the date and the size on
  one line, no thumbnails or boxes, in the manner of a file manager's details
  pane.

- On a device that has never signed in, the library no longer talks about
  syncing: the board filter offers All boards and Locked, and the cards
  carry no Sync button. Both appear once you sign in, and stay for a device
  that has had an account. (2026-11-08)
- Find in All Boards looks inside boards kept in the Files folder as well
  as the library, and a hit from a folder says so beside the board's name.
  Untargeted clips are routed to folder boards too. (2026-11-06)
- Choosing "Every board" in Settings → Sync now says straight away when
  boards will wait: until you sign in, or until the account has a sync
  plan. (2026-11-06)
- An older version of the app that meets an account updated by a newer one
  is told so on the sync pill, and the server no longer lets it undo the
  newer account's media naming. (2026-11-06)
- Choose what syncs. Settings → Sync offers "Every board", where each
  board in the library backs up to your account as soon as it is saved,
  new and imported ones included, or "Boards I choose", today's way, where
  the ☁ Sync button on each board decides. The choice follows your account
  to your other devices. Templates and boards in the Files folder keep
  their own opt-in.
- A locked board now opens in a new window. If a window of yours already
  has it open, the new one opens straight away; otherwise it lands on the
  library with the password prompt for that board, and the password opens
  it there. (2026-11-05)
- The corner of the library shows the version. Tapping it opens the
  details: the build, the service worker and the browser. (2026-11-05)

### Desktop

- Screen recording and system audio on the desktop app. The app answers
  screen-share requests itself, and on Windows it hands the system's audio
  to Record Audio without a picker. macOS and Linux give apps no way to
  record the system's sound, so there the switch is off with a note
  pointing at a loopback device.
- Boards under Files are readable folders. A board folder now keeps its
  pictures, videos, audio, documents and fonts as ordinary files under
  folders of those names, each named as the item names it, where the file
  manager, your computer's search and other programs see them for what they
  are. Copies the app makes for itself sit under a hidden folder; a locked
  board keeps everything encrypted under hash names as before. Folders
  written by earlier versions convert the first time they open.
- Files put into a board folder reach the board. Drop a picture, video,
  audio file, PDF, EPUB or font into the right folder of a board and it is
  added to the canvas when the board is next open, or straight away while
  it is open. Replace a file in place and the items showing it update; take
  one away and its item says the media is missing; delete an item on the
  canvas and its file leaves the folder when the board closes.
- The portable Windows build is portable from its first start: it makes its
  data folder beside itself wherever it runs from and never borrows the
  installed app's data. Make portable in Settings now says the folder is
  ready and offers to restart.
- On a Mac with the board folder on an external drive, Settings → Storage
  offers to keep Spotlight off that drive, and says plainly that boards under
  Files are ordinary files your computer can search.
- On a Mac, when the app is kept off the local network and your sync server
  lives there, a notice says which setting to switch on, instead of only
  "Server unreachable". (2026-11-06)
- Boards in the Files folder receive items and clips. Copy to Board and
  Move to Board list them beside the library boards, marked with their
  place, and the items land in the folder with their media without the
  board opening; a locked board folder takes them through its Inbox. The
  browser clipper lists board folders too, named with their folder.
  (2026-11-06)
- Run Claude Code from the app. A button in Settings → Agents, and an entry
  in the File menu, opens your own terminal with Claude Code already
  connected to boardCache, in the open board's folder when the board lives
  under Files. Nothing to copy or configure; if Claude Code is not
  installed, the terminal says so.
- No menu bar inside the window on Windows and Linux; the app's own menus
  carry everything. macOS keeps its menu at the top of the screen.
  (2026-11-05)

### Graph View

- Graph View is a full view of its own now, with the same bar as Notes,
  Calendar and Projects and its own address, so a link reopens it. A panel on
  the left holds a search box, the display choices, the filters, a colour
  legend and the picked node's details.
- Nodes can be drawn as preview cards or as dots sized by their connections,
  in the style of Obsidian's graph, in 3D or in 2D. Preview cards are sharp
  now: pictures come from their own bytes at high resolution, and other items
  are rendered at twice their size.
- Click a node to pick it: it and its neighbours stay bright while the rest
  fade, and the panel lists its connections, each a row that walks to the
  other end. Open on canvas, or a double click, flies to the item. Shift-click
  two nodes for the shortest path between them, as before.
- Colour by cluster or by kind, with a legend that counts them. Hide kinds of
  item as well as kinds of connection. Drag a node to pin it; unpin them all
  from the panel. Fit brings everything into view.
- Save as a picture puts the graph on the board as an image.
- The display choices are remembered.

### Canvas

- Tables in Markdown: a Table button on the editing toolbar inserts a table of the size you sweep out, and inside a table it tidies the columns, adds or removes rows and columns and sets alignment; Tab and Shift+Tab move between cells and add a row past the last. Works in notes, text boxes and the lightbox. (2026-11-12)
- On a team board, text written by an AI model now reaches everyone in the room and can be undone as one step; a resize that switches a text box off auto-height reaches the room too; a file card's Download fetches the file for members who never had it; and reminders for events and tasks notify every member rather than only the first whose app happened to fire. (2026-11-12)
- Any file can live on a board. Drop a zip, a spreadsheet, a project file or anything else the canvas cannot show, and it is kept as a file card with its name and size and a Download button; the lightbox shows its details, the gallery filter lists Files, the Asset PDF and the plain-files export include them, and board folders keep them under documents. A program such as an installer asks before it downloads. A plain .zip only opens as a board when it holds one. (2026-11-12)
- Dragging a card between columns in the kanban lightbox, or a thumbnail between rows in the tier list lightbox, now works with the mouse; the drop was refused before. (2026-11-12)
- Kanban boards: a card written into a board that was scaled up or down
  takes the board's size, so its text no longer looks tiny beside the
  column heads. (2026-11-11)
- Kanban boards: filed cards fill their column in the lightbox; a Titles
  switch (on the lightbox, and in the column editor) puts each card's title
  under it; the plus on a column head writes a new text card straight into
  that column. Agents get `add_kanban_card`. (2026-11-11)
- Kanban boards: Add → Kanban Board puts a board of named columns on the
  canvas (To Do, Doing, Done to start). Drag any card onto a column to file
  it: it stacks in the lane, sized to fit, and the board grows to hold its
  longest column; drop between cards to pick the slot, drag off to unfile.
  The pencil names, colours, reorders, adds and removes columns; the
  lightbox shows the board full size with drag between columns. Agents get
  `add_kanban`, `edit_kanban` and `place_in_kanban`. Separate from the
  Projects suite. (2026-11-11)
- With a video selected on the canvas, Space plays and pauses it, as it
  does in the lightbox. Holding Space to pan still pans.
- Video markers show on the timeline again: each flagged time is a small
  accent mark on the seek bar, on the canvas and in the lightbox. They had
  been rendering as a blank button over the track.
- The lightbox sidebar's link field has a Copy link button beside Open
  link.
- Video markers on the canvas. The time markers you flag now show in a
  bar of their own right under the player's controls, for video files and
  for YouTube and Vimeo embeds alike; a chip jumps the player there, and
  the × removes it.
- Play a video backwards. The new rewind button steps the picture back at
  the chosen speed; Play runs it forward again.
- A/B points. Set A and B at any two times and playback stays between
  them, shown as a band on the timeline. With the points set, the scissors
  cut that range out as a new video beside the original, picture and
  sound; it takes as long as the clip does.
- Transcribe from the player. The video controls carry the transcription
  button, lit once a transcript exists and explaining what to set up when
  no service is configured.
- Recipe cards resize like the other cards: a corner drag scales the
  whole summary, hero, title, chips and ingredients, and an edge drag only
  changes the box and gives the summary more or less room.
- The tier list's lightbox has an Edit Tiers button, so the rows can be
  renamed, recoloured, added and removed without leaving it.
- Tier list labels fit their text. The label column widens to the longest
  word of any row, long labels wrap inside it, and the type steps down for
  a row too short for them, on the card, in its lightbox and in thumbnails.
  Nothing spills over the shelves any more.
- The image adjustments bar keeps one row when the caption is on: the
  caption's own controls rise in a flap above the bar's corner instead of
  stretching the whole bar.
- Tier lists resize like the other cards. A corner drag scales the whole
  card, its title bar, its label cells and every ranked item with it, and
  the ranked items follow the shelves live while you drag; an edge drag
  only changes the box and reflows the rows into it. Scaling several
  selected items at once brings along whatever a tier list, timeline,
  storyboard or tree among them holds.
- Record Audio, which replaces Record a Voice Note. The recorder takes
  the microphone, the system's audio, or both. System audio comes through
  the browser's share picker: pick a tab, or a screen with its audio
  shared, and the picture is let go at once. Both sources mix into one
  recording, or Save as separate tracks gives one audio item per source.
- Contact lists. A .vcf with several people in it now lands as one
  contact list, the board's address book as a card: the title and the
  count, then everyone by last name under letter headings, scrolling when
  the card is shorter than its rows. A click on a row opens the contact,
  and the button at the row's end sends them to the board as a card beside
  the list. Drop a card on the list to file it, or pick Put in Contact
  List from a card's menu, or from the menu of several selected cards.
  Once a page has a list, a new, imported or pasted contact files into it;
  Add → Add Contact List makes an empty one. A list carries its rows
  through duplicate, send to board and delete; Rename List and Send All
  to Board sit in its menu, and its own lightbox has a search box.
- Social profiles and custom fields on contacts. A contact can list its
  profiles on X, Instagram, LinkedIn, Facebook, GitHub, Mastodon, Bluesky,
  Threads, TikTok, YouTube or any other network, as a handle or a link;
  each opens its page from the lightbox and the Contacts view. Custom
  fields take any name and any text. Both come in from and go out to .vcf
  files.
- The lightbox shows the media connected to a contact. Draw a connector
  line from a photo, a document or a note to a contact, and it shows as a
  thumb under the contact's lines, one click from opening; the Contacts
  view shows the same strip on the contact's page.
- The contact editor's fields now all share one look and height, and a
  long form scrolls inside the dialog.
- A note drags by its embedded picture. A text box with an ![[embed]] in
  it moves when you drag the picture, like when you drag the words, and
  the content no longer jumps or flashes on the way; a still click on the
  picture still opens it, and a double-click anywhere on the box, picture
  included, edits it.
- Contacts on the board. A contact is a business card: the photo or the
  initials, the name, where they work, and up to three ways to reach them.
  Drop or paste a .vcf file from any address book to get a card per
  person, with the photo, the labels (home, work, mobile, or a label of
  your own), the address, the birthday and the notes kept; Add → Add
  Contact makes one by hand; Download → Contact card (.vcf) and the
  assistant's tools take them out again. The lightbox lists every line,
  and a line opens your mail, phone or map app. (2026-11-10)
- A Contacts view, next to Calendar in the View menu and on the rail:
  everyone on the board by last name with a search box, the picked
  contact with every line, and a notes field that writes straight to the
  card. Edit, Show on Board, Export and Delete are one click away; the
  view imports and exports a whole .vcf; its address carries the contact,
  so a link reopens it. Phones show the list and the contact one at a
  time. (2026-11-10)
- Scaling several items at once scales each the way one scales alone:
  with a few text boxes or cards selected, a corner drag now grows their
  text and content live as the boxes grow, not just when the mouse goes
  up. (2026-11-10)
- Code blocks follow the app's mode: Code Snippets settings now hold a
  theme for light mode and one for dark mode (GitHub Light and One Dark
  unless chosen), and the page switches with the app. Light mode offers
  the light themes and dark mode the dark ones; a dark theme chosen back
  when there was one setting becomes the dark-mode choice.
- The clusters of controls over the canvas (the menu bar, the status and
  zoom pills, the clusters at the corners) and the buttons at the bottom
  right no longer cast a shadow: a border alone sets them off.
- The Gallery's Add opens a sheet of tiles, an icon over a name under
  each heading, instead of a tall dropdown that ran off the edge.
- The Gallery's bar matches the other views: Back to canvas on the left
  with the titles toggle, the sort menu and the page and group filters;
  the view switch in the middle; Add and the theme toggle on the right,
  with room between them, and the sidebar lines up with the bar's first
  icon. The board's name no longer repeats in the bar;
  while in groups, the way back and the group's name sit on the left.
- The note inspector's tabs run Document, Related, Info, Tasks, Comments,
  Assistant.
- Title items in the gallery are centred on their card with room around
  the words, whatever their alignment on the canvas. A status bar under the grid shows how many items are listed and
  holds the thumbnail size slider.
- Long text pasted or dropped onto the canvas lands as a page in letter
  proportion that scrolls, instead of a narrow strip as tall as the whole
  text. Short text still takes a box the height of its content.
- A rail of icons on the left edge of the canvas, centred on the window,
  opens the board's views in one click: Gallery, Notes, Calendar, Projects
  and Graph View, the same entries as the View menu, on phones too.
- Notes, Calendar and Projects share one bar: Back to canvas first on the
  left, the view's own controls, and the theme toggle last on the right,
  every control the same flat icon with a tip.
- The Calendar has a List view beside Month, Week and Day: every event on the
  board by month, past ones softened, with Today jumping to the next one.

- Code snippets at rest, fenced code in text boxes and code in PDF exports are
  now coloured by the same grammars as the code editor, so a snippet looks the
  same whether it is being read or written. A second highlighting library is
  gone from the app.

### Email

- Select several messages in the mail view, with a box on each row and Shift or Ctrl-click, and mark them read or unread or delete them together. (2026-11-12)
- Email: Compose sits above the search box in the message list, and the
  compose sheet resizes from its corner, keeping the size. (2026-11-11)
- Email: a Compose button above the folders opens a message with To, Cc, Bcc
  and a body written as HTML with a formatting toolbar, as Markdown, or as
  plain text (the choice is kept, and switching converts the text). Save
  Draft files it under the account's Drafts folder; open a draft there and
  Edit Draft takes it up again, and sending it replaces the draft. (2026-11-11)
- Email view: drag the divider after the folders or after the message list
  to set each pane's width; the widths are remembered. Reply matches the
  reader's other buttons. (2026-11-11)
- Reader: To, Cc and Reply to fold behind a chevron (phones start folded and
  the choice is kept); on a phone the reader's buttons show icons alone, the
  name on a long press; the message list keeps one text size on iOS instead
  of enlarging an overflowing row. (2026-11-11)
- Drop an email file on the canvas and it becomes a card: `.eml`, Apple
  Mail's `.emlx`, Outlook's `.msg`, and `.mbox` spools (one card per
  message). The message and its attachments are kept whole, so Download
  hands back the `.eml` and each attachment.
- The lightbox reads the message in full: the envelope, the attachments,
  every header line on request, and HTML mail in a frame of its own where
  nothing runs and pictures hosted elsewhere stay blocked until asked.
- An Email view (View → Email): the board's messages as a mailbox with
  folders, and your own mail accounts beside it. Add an account with its
  IMAP and SMTP servers (the sign-in stays on your device; your sync server
  connects for you and keeps nothing), read folders and the inbox, open
  messages, reply, reply all, forward, mark unread, delete, and save a
  message to the board as a card.
- Agents list and read the board's messages and add one from its source;
  mail accounts stay out of their reach.

### Feeds

- Feeds: Import reads an OPML subscription list from another reader, adding
  the feeds it names in their folders (kept to the view), and Export hands
  the board's feeds back as one. Agents get `export_opml` and
  `import_opml`. (2026-11-11)
- A Feeds view: every RSS feed on the board in folders on the left, the
  picked feed's entries on the right at full width. Fold a folder shut,
  drag a feed into one, search by name or address, refresh one feed or all
  of them, rename a feed, change its address or delete it.
- A feed can live in the view alone: Hide from Canvas keeps its card off
  the canvas (the Layers panel's eye does the same), Show on Canvas brings
  it back, and Show on Board jumps to the card.
- The feed card lists headlines alone; the quote button in its title bar
  adds the excerpts and pictures, and the choice is kept on the card.
- A double-click on the card's title bar opens the reader in the lightbox,
  and the reader there has a handle at its right edge to set its width.
- The view keeps New feed, New folder and Refresh all under the search
  box, and a bar under the entries with the text size steps and a slider
  for the entries' width, as in Notes; both are remembered on the device.
  The feed's folder is the first control in the row above the entries.
- Add RSS Feed asks for the folder along with the address, and a folder's
  own add button opens it with that folder picked.
- The lightbox bar has an Open in Feeds button for a feed, and the entries
  in the view take the whole stage until the slider narrows them.
- Agents list, file and refresh feeds, and add one straight into a folder
  or off the canvas.

### Events

- Calendar: on a phone the Month, Week, Day and List switch sits on its own row
  under the title. (2026-11-11)

### Notes

- A view popped out beside the canvas now edits the same board live: what you change in either window shows in the other as you go, undo included. The popped window is a small window of its own rather than a tab, frameless in the desktop app, with no way back to the canvas and a close control in its bar. (2026-11-12)
- Every full-screen view has a pop-out button beside the theme switch: it opens that view in a new window and brings this one back to the canvas, so notes, feeds, mail or the calendar can sit beside the board. Notes: the list's first level lines up with the New note button; a note's menu gives it a colour, a soft tint on its row; Copy link and Copy path; Open in a new window. (2026-11-12)
- In the Notes view's Edit mode a table is a real table you type into: each cell is a field, Tab and Enter move and add rows, the arrows leave at the edges, and the Markdown is written as you go. The Table button's row, column and alignment edits act on the cell you are in. (2026-11-12)
- The Edit, Source, Preview and Split switch now sits in the middle of the top bar, as quiet icons like the bar's other buttons. The import menu offers a folder or a zip archive. (2026-11-12)
- Import an Obsidian vault into the Notes view, as a folder or a zip: every Markdown file becomes a note in its folder with its tags, pictures and other files come along as items the notes can embed, links and embeds are translated so they still resolve, and nothing lands on the canvas until you put it there. (2026-11-12)
- A note written in the Notes view stays in the view, off the canvas, until you choose Show on Canvas from its row menu or the inspector; Hide from Canvas takes a note off again without losing it, and hidden notes carry an eye-off mark in the list. Agents can write notes either way. (2026-11-12)
- A new note opens with its title line focused, so the name is the first
  thing you type; Enter moves on to the text.
- The first line of a note sits a little further below the toolbar.
- A centred or right-aligned embed (![[Picture|center]]) sits that way
  while you write, not only on the page.
- The Contacts view fills the window like the Notes view, without the
  gallery's margin around it.
- The toolbar's paper clip opens a picker of the board's items, tiles
  with their pictures, a search and pills by kind; picking one embeds it
  where the cursor was. The `![[` menu shows a small picture beside each
  title.
- The split menu at the end of a tab strip stays on screen when the
  inspector is closed.
- The open note's row in the list is marked quietly, like a hover.
- Split scrolls the source and the page together, by their share of the
  way down, as the lightbox's split does.
- Code in the live editor and in Source takes the code theme's colours
  and background, so it reads as it does on the page.
- A note that opens with a first-level heading shows it as its title
  and leaves the line out of the page and the editor, rather than saying
  it twice; editing the title rewrites the heading, and Source still
  shows the line as written.
- The inspector's tabs are icons with their names on hover, and a Tasks
  tab lists every box in the note: tick them there, or click one to go to
  its line. Properties: the fields on the Document tab lost their borders,
  the block in the page is a plain list with a faint line between rows,
  and an eye at the head of the section hides it in the note. On the
  canvas and in the lightbox properties are left out unless Settings →
  Text says to show them. Rest the pointer on a [[link]] for a card with
  the start of that note. Right-click a note in the list for Open, Open in
  a new tab, Open to the right, Open below, Rename, Duplicate and Delete.
- Two notes at once: the stage splits right, left, down or up from the
  button at the end of a tab strip or a tab's menu, as in Obsidian. Each
  pane has its own tabs, history and pins; tabs drag between panes; the
  line between halves drags; the last pane clicked is the one the list,
  the inspector and the address follow. The layout is remembered.
- A note shows in its own font, the one its text box has on the canvas
  and in the lightbox, and new notes take the default from Settings. A
  font menu at the end of the toolbar changes it; in Source the menu picks
  a font for the source view, monospace unless chosen.
- Properties: a note can open with a frontmatter block between two `---`
  lines, as Obsidian keeps it. The page shows it as a small table, the
  live editor keeps it as written, and the title, word count and outline
  leave it out. The inspector's Outline tab is now Document and lists the
  properties above the outline, editable in place, with Add property.
- Agents: read_note returns a note's properties and set_note_properties
  sets or removes them.
- On a phone, the list of notes and the inspector slide over the note and
  stop short of the far edge, so the note shows beside them and a tap on it
  closes the pane. A handle on the pane's edge widens it to the whole
  screen, and that choice is remembered.
- On a phone, a note never scrolls sideways: long words and addresses break,
  code wraps and a wide table scrolls inside its own box. The mode switch
  sits at the right under the title, Split is offered only when the phone is
  turned or the screen is wide enough, the status bar clears the home
  indicator when the app is installed, and the width slider sits behind an
  icon that opens it above the bar.
- Small things in Notes: a task's box stands alone in the live editor, with
  no bullet before it; the formatting toolbar is centred; narrowing the
  writing with the slider keeps the scrollbar at the window's edge; the text
  size buttons sit in the middle of the status bar; the folder picker calls
  the top level No folder; and New folder has a folder-with-plus icon.
- Tabs in Notes remember where they have been: Back and Forward at the start
  of the tab strip, or Alt+Left and Alt+Right, walk through the notes a tab has
  shown, so a link followed is easy to come back from. A click on a note in
  the list opens it in the current tab and a double click opens a new one.
  Right-click a tab to pin it: a pinned tab leads the strip, keeps its note,
  cannot be closed until unpinned, and a note picked while it is active opens
  beside it. Close other tabs is in the same menu. Pins and history survive
  a reload.
- Linking and embedding without typing the brackets: the toolbar has Link to
  a note and Embed buttons, the slash menu has Link to note and Embed item,
  and each opens the list of titles at once. In Notes, drag a note from the
  list into the editor to drop a link to it where the pointer is.
- Embedded items can be aligned: `![[Harbour|center]]`, `![[Harbour|right]]`,
  or `![[Harbour|200|center]]` with a width.
- The slash and `[[` menus in the live editor accept Enter reliably right
  after a keystroke; before, a quick Enter could break the line instead.
- Notes on a phone: swipe in from the left edge for the list of notes and in
  from the right edge for the inspector, and swipe a pane back towards its
  edge to close it. The bar keeps Back to canvas and the list on the left and
  the inspector and the theme on the right, the title has its own line, and
  picking a note in the list brings up the note itself.
- Pictures and other items of the board can sit inside a note. Write
  `![[Harbour]]` and the picture titled Harbour appears in the page; a video or
  a sound gets its player, and anything else a small card. Typing `![[` offers
  the board's media titles, so you choose from what is on the canvas, and
  `![[Harbour|300]]` sets a width. Embeds show in the live editor, the
  preview, on the canvas and in the lightbox, and a click opens the item in
  the lightbox with the way back to the note.
- Writing a note is now a live page. Edit styles your Markdown as you type:
  headings large, emphasis emphasised, links and [[links]] as links, tasks
  as boxes you can tick, quotes with their bar, code highlighted. The markup
  shows only on the line the cursor is on; everywhere else the note reads as
  the finished page. A new Source view shows the plain text, and Split and
  Preview are as before. The toolbar, the / commands, [[ completion and
  Ctrl or Cmd+E all work in every view.
- The note's title row has a text size stepper, the same steps as the lightbox,
  for the page and the editor. The inspector's tabs have room between them and
  wrap to a second row in a narrow sidebar instead of running together.
- The Notes view's bar is tighter: its buttons sit at the screen's edges and the
  bar no longer repeats the view's name. Edit, Preview and Split are icons, and
  Ctrl or Cmd+E switches between writing and reading from anywhere in the view.
  The title row and the formatting toolbar span the page; only the writing
  below follows the width slider.
- The notes list sorts: by title either way, or newest or oldest first, from
  the sort button beside New note and New folder. The order is remembered.
- The Related tab leads with Media: small thumbnails of the pictures and other
  items grouped with the note or connected to it. A thumbnail opens the item
  in the lightbox, and the lightbox's bar has Back to note.
- A Notes view of the board (View → Notes, or Open in Notes on a text box):
  every text box as a note, listed by title in folders you make, with tags
  as filters and a search over titles and text. Notes open in tabs; a Ctrl
  or Cmd click opens another. The page has Edit, Preview and Split with
  the usual Markdown editor, and saves to the board as you pause. The
  inspector on the right shows the outline of the note's headings (a click
  scrolls to one), its folder, link and tags, its comments, and what it
  relates to: the notes it links to and is linked from, the media grouped
  with it and its connections. Both sidebars fold away and resize.
- Links between notes: write [[The Crew]] in any text box to link to the
  note of that title, or [[The Crew|other words]]. In the Notes view a
  link opens the note, and a link to a note that does not exist yet makes
  it. On the canvas and in the lightbox, a click on a link goes to the
  linked note's place on the board, selected and framed.
- Typing [[ in any Markdown editor offers the board's note titles and
  completes the link; tabs in the Notes view reorder by drag; the outline
  folds by level; the page sits centred at a width you set with the slider
  in a new status bar that counts words and characters; the inspector gains
  the board assistant; and a text box opens in Notes from the lightbox bar
  and from the text panel on the canvas.
- Agents gain list_notes, read_note, write_note and edit_note.

### Canvas

- An empty text box keeps the size you drag it to. Scaling a text box
  from a corner before typing anything used to snap it back to a single
  line as soon as you let go; it now stays at the size you gave it, the
  same as a box with text in it.
- Shift on a corner handle resizes the box without scaling it. A corner
  drag still scales an item as a whole, keeping its shape and growing a
  card's content or a text's type with it. With Shift held, the corner sets
  the width and height together and leaves the content alone, the way an
  edge handle sets one side: the box changes, nothing zooms.
- Hi-res images show their real pixels wherever you look closely. The
  canvas draws a large picture from a 2048 px copy, and zooming in past
  that copy's size used to leave it soft. Now the original takes over as
  soon as the picture is drawn wider than the copy holds, and goes back
  to the copy when you zoom out again, so memory stays in check on a board
  of fifty photos while the one you are inspecting is sharp.
- The lightbox stays sharp while you zoom. A zoomed picture was a
  stretched copy of the fit-size drawing until the browser caught up,
  which on a big photo took seconds and looked like a low-resolution
  version popping into focus. The viewer now redraws the picture at true
  resolution the moment a zoom rests, decodes the original before showing
  it so the first frame is sharp, and shows the canvas copy at the same
  place while a huge file decodes.
- Cropped images stay sharp on the canvas. A cropped image was judged by
  the size of its crop, not of the whole picture, so it switched to the
  small far-out copy too early and showed a stretched slice of it. The
  whole picture decides now, and a tight crop is as crisp as the image
  beside it. (2026-11-07)
- Pictures that look alike. With Image search (CLIP) on under Settings →
  General, More Like This, the lightbox's Related tab, Board Insights and
  Organize by Topic see pictures that resemble each other, and a note beside
  the picture it describes, marked "Looks alike". The clips inbox routes a
  picture clip to the board with pictures like it. (2026-11-07)
- Every remaining browser-native dialog is now the app's own: adding a
  marker or chapter, naming a video, color or palette, editing a QR code
  or an item's link, embedding a video or webpage, the passphrase of an
  encrypted board file (hidden as you type), deleting boards or a
  community group, and every error that used to pop up as an alert.
  (2026-11-06)
- Reset Bounding Box and restoring a cropped image no longer blank the
  picture for a frame while the new rendition takes over. (2026-11-06)
- A link button can open another board. Add → Add Board Link picks one from
  the library (or the Files folder), the button takes its name, and opening
  it brings that board up in a new window, or a new tab in the browser.
  A button's panel and menu can change which board it points at. Agents
  have `add_board_link`. (2026-11-05)
- The command palette now offers everything on the File, View and Add menus,
  with a submenu's entries named by their path, such as "Export: Dossier
  PDF", and every plugin's additions, so nothing on a menu is out of its
  reach. (2026-11-05)

### Account

- Push notifications in the browser. Settings → Notifications → Push
  subscribes this browser, or the app on your phone's home screen, so task
  and event reminders and account events reach you while the app is
  closed. What a reminder says is sealed for your own devices before it
  leaves; the server learns only when something is due. Mail reminders
  stay as they were. (2026-11-07)

- Settings has a Notifications section. Choose whether this device shows
  notifications and for what (tasks due, events, team and community
  activity), the hour a due date without a time reminds at, how far ahead
  a task reminds, and quiet hours that hold a reminder until they end.
  (2026-11-05)
- Reminders by email. With an account, turn on "Email me reminders" and the
  moments your open board's tasks and events come due are registered with
  the server, which mails you a link at each, whether or not the app is
  open. The server learns only when and which link; a task's name goes in
  the mail only if you choose to include it. (2026-11-05)

### Projects

- A task opens as a page: its facts, the notes rendered as markdown, the
  subtasks, its attachments from the board as previews, and the comments.
  **Edit** turns the page into the form and **Done** turns it back.
  (2026-11-05)
- The task and milestone pane resizes by dragging its left edge, and a
  button in its head fills the view with it; both are remembered.
  (2026-11-05)
- Tasks take a web address, shown as a link on the page, and a time of day
  on the due date. Agents can set both. (2026-11-05)
- Reminders only look ahead. A task dated for a day or time that has already
  passed when you set it no longer sends a notification on the spot; a due
  later today, with a time, reminds at that time, and a day without a time
  reminds at 9:00. Moving a due date forward re-arms its reminder. Checklist
  cards follow the same rule. (2026-11-05)
- On the All Projects page, the hover shadow wraps each project's card
  exactly, rather than a taller box under it. (2026-11-05)
- Tapping a task in the Timeline or Board view no longer activates whatever
  the pane opens under your finger. (2026-11-05)

### Canvas

- Locking the canvas now leaves the group you were editing, closes any
  open editor or dialog and clears the selection, so view-only mode starts
  at the root of the board with nothing open. (2026-11-04)
- Paste puts down what you copied last. Copying items on a board no longer
  shadows an image or text copied in another app afterwards: the newer copy
  wins, on the keyboard and from the menu. (2026-11-04)
- A pasted or dropped image that takes a moment to prepare shows a
  placeholder card at once, so a slow paste is seen to be under way rather
  than pasted again; a paste with nothing behind it says so. (2026-11-04)

### Board locks

- A board file, offline viewer or plain zip made from an open locked board
  holds its media readable, as the board is while open. (2026-11-04)

### Desktop

- The desktop app reads the clipboard itself, so a copied image pastes
  whatever format it is in (on Linux in particular), and a picture, video,
  audio file or PDF copied in the file manager pastes onto the board.
  (2026-11-04)
- Exporting a board that lives in a folder, while it is open, now carries
  every picture, including ones the canvas had not shown yet. (2026-11-04)
- Boards can live in a folder on disk. Choose one in Settings → General →
  Storage and the library gains a Files section: every board you put there
  is a folder of its own, holding the board, its previews and its media as
  plain files, so a backup or sync tool can carry it between computers.
  Folders inside it organise boards as deep as you like. A board folder is
  an unpacked board file: zip it and it is a `.boardcache`, drop a
  `.boardcache` on Files and it unpacks. Boards move between the library and
  the folder from their menu or by dragging, keep their password locks on
  disk, and a board changed on disk while open is reloaded. Agents see the
  folder through the same tools, with `storage` on every board.
  (2026-11-04)
- The desktop app can be portable. A folder named `boardcache-data` beside
  the app makes it keep everything there, boards and settings included, so
  the app and its data travel together on a drive; Settings → General →
  Storage shows where the data lives and creates that folder for you. A
  portable app keeps its boards in a `boardcache-boards` folder beside it
  unless you choose another, and Windows gets a portable build that installs
  nothing. (2026-11-04)

### Library and sync

- Every board keeps its own media. A picture on two boards is stored once
  for each, so deleting a board removes all of its media, a lock covers
  everything a board shows, and a picture you remove from a board is dropped
  when you close it. Copying, pasting, sending or duplicating items between
  boards copies their media along. A library from earlier versions is moved
  over the first time it opens, which also frees the media of boards deleted
  long ago. (2026-11-04)
- On the sync server, media belongs to its board the same way: deleting a
  synced board deletes its media from the account, and the same file on two
  boards counts twice toward the storage quota. Existing accounts are moved
  to the new naming once, on the first sync after updating; a board not yet
  downloaded on a device is moved when it is. (2026-11-04)
- A picture that is on this device but cannot be read says "can't be read"
  and, on a synced board, takes the server's copy; the "locked with another
  board" state and its Unlock button are gone, since boards no longer share
  media. (2026-11-04)

### Canvas

- Text boxes resize like the other cards: drag a corner and the text
  scales with the box, drag an edge and it reflows at the same size. The
  toolbar's size list is gone; Settings → Text still sets the size new
  boxes start at. (2026-11-04)
- The lightbox has a reading size: A- and A+ scale the editor and the
  preview together, remembered on this device for every box, without
  changing the box's own size on the canvas. (2026-11-04)
- A text box reads the same written and rendered: the blank line between
  paragraphs, headings and lists is one line of text in both views, as it
  already was while editing. (2026-11-04)
- Drop any file the Add menu can import onto the canvas: Office documents,
  text documents, swatch files and board files, as well as media. A file
  nothing can import says so. (2026-11-04)
- Converting a document shows progress, named after the file, instead of
  leaving the canvas silent for a few seconds. (2026-11-04)
- Office documents get a picture of their first page, used on the library
  card, the zoomed-out view and exports. A document without one paints as
  a sheet of paper in the theme's colours. (2026-11-04)

### Clipper

- A picture clipped from a page keeps the file name its site gave it,
  taken from the image's own address, instead of the page's title; the
  title stays as the source.
- A screenshot shows a box on the canvas the moment the capture starts,
  where the picture will land; drag the box and the picture follows. The
  clipper announces the capture before stitching and uploading, and the
  picture replaces the announcement. A capture that fails takes its box
  away. Clips sent to your account now reach the open board at once rather
  than on the next check.
- An Instagram profile page clips as the person, not their grid: one card
  with the profile picture beside the name, handle, bio, counts and links,
  opening the profile, grouped as one. A profile without a picture clips
  as the card alone. Any picture clip that carries text now lands the same
  way, the text as a card beside it.
- Version 1.7.2: the right-click menu's list of boards keeps up with the
  picker in the clipper's window. The list is refreshed when the window
  opens (the menus take the same boards it shows), when the browser comes
  back into focus after a board was made in the app, every few minutes,
  and after each clip, and the menus are rebuilt only when it changed.
- The clipper's icon comes in 64 and 96 px too, the sizes Firefox's add-on
  manager and HiDPI toolbars ask for, so it no longer risks falling back to
  the generic puzzle piece there.
- Version 1.7.1: the Firefox clipper now reaches the desktop app. Firefox
  only grants site access inside the click itself, and the clipper asked a
  moment too late, so the board list stayed empty and a clip reported the
  app closed while it was open. The clipper asks within the click now, and
  the desktop app answers the clipper directly, so pairing it needs no site
  access at all. (2026-11-07)
- The clipper for Firefox is on Firefox Add-ons; the download page links
  to it. The Chrome Web Store listing is still in review. (2026-11-07)
- Version 1.7.0: the Send to picker and the right-click menus list the
  desktop app's boards under Files beneath their own heading, each with its
  folder, apart from the library boards. (2026-11-06)

- The Firefox build declares the data it sends, which Firefox now asks of every extension: the content you clip and the token you entered, both to your own boardCache. It needs Firefox 140 or newer. (2026-11-04)

### Security

- A security review of everything added since September: links in contact cards and pop-outs open web addresses only, notifications open only pages of the app, the desktop app's research fetches check every redirect, imported vaults have size limits, and the sync server's mail proxy, screenshots, team rooms, shares and push registrations each close a gap found in review. (2026-11-12)

## 0.2.0 — 2026-11-02

Boards saved by this version (locked boards, and unlocked boards that keep
their media key) do not open in 0.1.x builds. Update every device before
locking or unlocking a synced board.

### Board locks

- A board keeps one media key for life. The first lock makes it; the
  password only wraps it. Removing a lock and setting it again, with the
  same password or another, opens everything the earlier lock sealed, on
  this device, on other devices and on the sync server. Locks made before
  this version carry over when they are removed. (2026-11-02)
- A lock covers exactly the board's own media. Media arriving from sync or
  a team room is stored as it comes, a board file's media belongs to the
  board being imported, and a picture shared with an unlocked board is
  stored plain the moment it is shared. Unlocking a board repairs records an
  earlier version left under its key, and the server copies follow: locking
  a synced board seals its media there, removing the lock opens it.
  (2026-11-02)
- An image that cannot be shown says why: "not downloaded" when the bytes
  never reached the device (Retry fetches again), "locked with <board>"
  when they are here under another board's password (Unlock asks for it,
  and says when the password is right but the media predates the board's
  key), "can't be read" when the stored record is damaged. A device whose
  record will not open takes the server's copy. A synced board's menu has
  Re-upload media. (2026-11-02)

### Library and sync

- An imported board is always a new board, with its own identity, so
  importing a board's own export or restoring a backup beside the
  original never changes the original, here or on other devices.
  (2026-11-02)
- Board names are unique: a board imported, created, duplicated or renamed
  to a name the library already has gets a counter, "Trip (1)", "Trip (2)".
  (2026-11-02)
- Every dialog opens with its first text field focused, on desktop and on
  the phone sheet, and keeps that focus. (2026-11-01)
- A lapsed sign-in is no longer a silent signed-out index: a row names the
  account and offers to sign in again, and Download on a synced board asks
  for the sign-in instead of failing quietly. (2026-10-31)
- Pull to refresh on the index: on a touch screen, drag down from the top
  of a signed-in index to ask the sync server for news. (2026-10-31)
- The library tour works on a phone: the sidebar drawer opens for the steps
  whose controls live in it and the coach-mark card stays on screen.
  (2026-10-30)

### Canvas

- Link buttons take the theme's accent colour by default and follow a theme
  or mode switch; a chosen colour still sticks. (2026-10-30)
- Zoomed-out low-detail previews are reliable: a preview painted before an
  image's bytes arrived is repainted when they do, and View → Rebuild
  Low-Detail Previews redraws them all. (2026-10-30)

### Desktop

- YouTube videos play in the desktop app again. YouTube began refusing
  players that arrive without a referring page, which the app's embedded
  frames did; they now identify themselves the way the web app does.
  (2026-11-04)

## 0.1.1 — 2026-10-29

### Security

- Media on the sync server is named by a keyed hash under an account key,
  never the plain content hash; existing accounts relabel on their next
  sign-in. Shares, encrypted backups and board, folder and device locks
  derive their keys with Argon2id (older records still open). The content
  security policy no longer allows scripts from cdnjs. (2026-10-24)
- Hardening passes over share links and the viewer, outbound fetches, the
  desktop shell's bridge, protocol, permissions and endpoint, and the
  clipper's token handling. (2026-10-20, 2026-10-21)

### Sharing and publishing

- Share links are snapshots served piece by piece: the viewer paints at once
  and fetches media as it comes into view; passwords are checked by the
  server; each link has its own page with a title and card image. Share
  links come with the Personal and Team plans. (2026-10-24)
- The hosted viewer is a code-split module build, about 135 KB of script and
  48 KB of style, with PDF, KaTeX, EPUB and the rest loaded on first use. The
  offline export keeps the single-file viewer. (2026-10-24)
- A published board opens to anyone with its link, no account needed; its
  page carries a canonical address and a card image. (2026-10-24)
- Publications: Unpublish and Edit are buttons; versions can be viewed,
  restored or replaced in place; covers render per theme. (2026-10-24,
  2026-10-25)

### Canvas and items

- Videos remember a pause as well as a position; the control bar wraps in a
  narrow window instead of clipping. (2026-10-27)
- Cases rate each piece of evidence where they score it; evidence strength
  badges are off by default (View → Show Evidence Strength). The case view
  fits a phone. (2026-10-21, 2026-10-25)
- Link buttons and storyboards scale like project cards; the storyboard
  editor is larger and opens from the lightbox. (2026-10-22)
- Audio players scale like the other cards: a corner drag zooms the whole
  player, an edge drag changes only the width or height. Schema v86.
  (2026-10-28)
- Lightbox: a click on the picture hides the chrome as a tap does, and the
  picture takes the whole window. (2026-10-26)
- Project descriptions render as sanitised Markdown. (2026-10-22)
- Settings → Canvas shows the board's cover item and can remove it.
  (2026-10-19)
- Events: calendar events as cards with an editor, reminders, iCalendar in
  and out, and View → Calendar with Month, Week and Day scopes. Assistant
  tools add, edit, import and export them. Schema v85. (2026-10-27)
- Semantic search, CLIP and transcription load their runtime from the app
  itself instead of a CDN, so they work under the enforced content security
  policy. Nothing in the app evals. (2026-10-28, 2026-10-29)

### Styling

- One central style definition: semantic tokens, a controls sheet that owns
  every button, segmented control and text field, dialog sizes in one place,
  and a lint guard against stray colour literals. (2026-10-27)

### Library and onboarding

- A welcome board is seeded once into a new library; its Presentation Mode
  is a tour of the canvas, and View → Welcome board brings it back. A short
  library tour runs once on desktop and replays from View → Library tour.
  (2026-10-25)
- Open a board in a new window: Shift-click a card, or Open in New Window
  from its menu. Ctrl/Cmd-click adds to the selection. (2026-10-26)
- Folders merge entry by entry across devices. Import shows progress; board
  files can be dropped on the index. (2026-10-20)

### Mobile

- Tapping a note on a phone opens it in the Notes view, where it has
  room, instead of the lightbox.
- Embedded YouTube and Vimeo players play in the iOS and Android apps.
  The web view ran on a custom scheme that sends no Referer, which the
  players refuse (error 153); it now runs on https://localhost like a
  website. A server allowing the apps must list that origin.
- One finger pans from anywhere in view mode. Less memory while panning and
  zooming on iPhones and iPads. (2026-10-25)
- The bottom bar clips the board name before the item count; the library
  drawer keeps clear of the status bar and home indicator; iOS 26's scroll
  edge effect no longer draws under the status bar in dark mode.
  (2026-10-25, 2026-10-27)

### Clipper 1.6.0

- Clips go to the desktop app on the same computer for free; clipping
  through the account needs a sync plan. Instagram posts, carousels, videos
  and stories clip reliably. (2026-10-22, 2026-10-23)

### Desktop

- A desktop variant (`appName` in `build.local.json`) installs and runs
  beside the shipped app on every platform; the Mac app asks for local
  network permission itself when the sync server is on a private address.
  (2026-10-27)
- Electron 44 and electron-builder 26; the Linux app shows its own icon.
  (2026-10-21, 2026-10-22)
- Interface size: Settings → Appearance scales text and controls together
  (80% to 150%); View → Larger/Smaller Interface. (2026-10-26)
- The Linux app keeps its sync session across restarts on desktops without
  a keyring Chromium recognises. (2026-10-28)

### Account

- Delete your own account from the app. (2026-10-21)
- The old product name is gone from the code and docs; `.refboard` files
  still import and `REFBOARD_*` variables still work. (2026-10-26)
- Stock media: Openverse is unticked by default. (2026-10-22)
- The service worker no longer precaches the share page, which kept it from
  updating in production. (2026-10-27)

## 0.1.0 — 2026-10-20

First public snapshot: the client, the desktop shell and the schema, e2ee
and text packages, under Apache-2.0.
