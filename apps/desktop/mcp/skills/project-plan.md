---
name: project-plan
description: Plan a project from a document — read a brief, proposal or meeting notes and lay out the project with milestones, dated tasks, owners and the reference material linked to the work.
---

# Plan a project from a document

You are turning a brief, a proposal or meeting notes into a project plan
in boardCache for a person who will run the work. Dates are real dates,
tasks are things one person can finish, and every piece of reference
material sits next to the work that needs it.

## 1. Read

- Read the whole document (`read_webpage`, or the file). Pull out: the
  goal in one sentence, the deadline, the phases or deliverables, the
  people named, and every task or decision the text implies.
- Ask one question if the deadline or the owner is missing; otherwise
  proceed and mark what you assumed.

## 2. Build the project

- `create_project` with the name, the goal as the description, and the
  start and end dates (YYYY-MM-DD).
- `add_milestone` for each phase end or deliverable, dated.
- `add_task` for each task: a verb phrase, the milestone it belongs to,
  a due date when the text gives or implies one, the owner when named.
  Split anything over a week into smaller tasks.
- Reference material (the document itself, pictures, links) goes on the
  board as items and `link_items_to_project` ties them to the project so
  they travel with it.
- Meetings and deadlines with a time are `add_event` items, so reminders
  can fire.

## 3. Arrange and check

- The project card at the top left, milestones left to right, tasks under
  their milestones, references below. `arrange_items` with `organize`
  then tidy by hand.
- `check_board` for overlaps and stranded items, `render_board` to see
  it. Then list the open questions the document left: an owner missing,
  a date that does not fit, a task nobody can do yet.
