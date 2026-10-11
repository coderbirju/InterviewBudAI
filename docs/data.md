# Your data

Your notes and progress live in one folder on your computer. They are never
uploaded, and they are never part of this repo.

## Where it is

The default folder is `~/.interviewbudai/data`. The first start creates it,
with owner-only permissions. The startup message and **Settings → Data &
app** show the folder in use.

Inside it you find, among others:

- `notes/<problem id>.md`: your notes, one plain Markdown file per problem.
- `problems/`: problems you added yourself.
- `quiz-sessions/` and the competency files: quiz history.
- `problem-cache/`: cached problem statements (see
  [Problem statements](problem-statements.md)).
- `preferences.json`: your code language and the LeetCode fetch setting.
- `.backups/`: automatic backups (below).

## How the folder is chosen

The app decides the folder once, at start, in this order:

1. the `--data-dir=<path>` flag (when you run the server directly);
2. the `IBAI_DATA_DIR` variable;
3. the folder you picked on the Data page, saved in
   `~/.interviewbudai/config.json`;
4. the default `~/.interviewbudai/data`.

Only the default is created for you. A folder set by the flag or the
variable is "pinned": the Data page shows it but cannot change it. A broken
`config.json` is ignored with a warning, and the default is used.

## The Data page

Open **Data** in the app (`/data`). It shows:

- **Active folder:** the path, where it came from, and how many notes it
  has.
- **Found previous data:** shown when an older folder with notes is found
  (for example `~/.ibai/data`, the old default, or a folder an older version
  remembered in a browser cookie). Click to use it, or dismiss it.
- **Use an existing notes folder:** type a path, **Check** it first, then
  **Use this folder**. The choice is saved and used after restarts.
- **Import notes from CSV:** see below.

`/setup` is a plain page that does the same folder choice without
JavaScript.

If Home shows no solved problems, the active folder has no notes yet. The
banner on Home links to the Data page so you can point the app at the right
folder.

## Import notes from CSV

Import a Notion export (`.csv` files) on the Data page:

1. Pick the files and click **Preview**. Nothing is written yet.
2. Check each row: the matched problem, or *Unmatched*. For a problem that
   already has a note, choose skip, overwrite or merge. You can add an
   unmatched row as your own problem (pick a topic for it).
3. Click **Import**. The app makes a backup first, then writes the notes and
   shows a summary.

Limits: up to 64 files and 1 MiB in total.

## Backups

Before a CSV import, a problem delete with its note, and a practice history
reset, the app copies your data folder to
`<data folder>/.backups/<date and time>/`. It keeps the last 5. If the backup
fails, nothing is changed. To restore, copy a backup folder's contents back
into your data folder (stop the app first).

The `.backups` and `problem-cache` folders have a `.gitignore` of `*`, so if
you keep your data folder in git they are not committed.

## Upgrades and breaking changes

Any change to where your data lives, or to the file format, is listed under
**Breaking changes** in the [CHANGELOG](../CHANGELOG.md), with what you need
to do. Read it before you upgrade.

Under Docker, the data folder is the same by default. See
[Docker](docker.md#your-notes-folder).
