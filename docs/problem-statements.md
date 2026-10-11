# Problem statements from LeetCode

When you open a catalog problem, the app's local server can fetch that one
problem's statement and starter code from LeetCode, so you can read it next
to your notes (ADR 0015). This is the app's only network call besides your
own AI provider, and you can turn it off.

## What is sent

One `POST https://leetcode.com/graphql` request asks for that problem's
title, statement, example test cases and code snippets. The problem's name
comes from the link in the shipped catalog. There is no login, no cookie and
no API key, and none of your notes or data are sent. The `User-Agent` names
this project.

## When

Only when you open a problem that is not cached yet, or click **Refresh**.
One request at a time, at most 10 per 10 minutes, a 10 second timeout, a
1 MiB size limit, and no redirects.

## What is stored, and where

A cleaned copy goes to `<data folder>/problem-cache/<id>.json`, with
owner-only permissions. The HTML is reduced to text with a few formatting
tags (no links, images, scripts or styles). Only the Python 3 and Go snippets
are kept. The folder has a `.gitignore` of `*`, so a data folder in git does
not commit it. It is never sent to your AI provider. You can delete the
folder at any time; a problem is fetched again only when you open it.

Your code language and this setting are stored in
`<data folder>/preferences.json`.

## Premium or missing problems, or no connection

The app shows **Open on LeetCode** and a **Paste the problem** box instead.
Pasted text is stored in the same cache file, shown as plain text, and wins
over a fetched statement.

## How to turn it off

- In the app: **Settings → Problems & code → Fetch problem statements from
  LeetCode**.
- Or set `IBAI_LEETCODE_FETCH=off` (also `0` or `false`) in `.env` or your
  shell. This pins the setting, and the Settings toggle becomes read-only.
  `on`, `1` or `true` pins it on. Any other value is ignored with a startup
  warning.

Off means no request to LeetCode at all. Cached statements and pasted text
still show. Under Docker, `.env` is not passed into the container, so use the
Settings toggle there.

## Terms of service, plainly

LeetCode's terms restrict copying its content and automated access. This
project ships no LeetCode text. The fetch runs on your machine, only when you
open a problem, one problem at a time, rate-limited, without login, and the
result stays in your private data folder. If LeetCode blocks it or objects,
the app falls back to the link and the paste box, and the maintainers will
switch the default to off. This is a recorded risk (ADR 0015), not legal
advice. Turn it off if you prefer.
