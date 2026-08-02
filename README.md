# social-automation

Auto-post, schedule, cross-post drafts from `design-studio.html`, reply to
mentions, and post GitHub "lab completed" commits to social accounts —
built on [Composio](https://composio.dev), which handles OAuth to each
platform so you don't need to register a developer app on X/LinkedIn/etc.
yourself.

Runs on a GitHub Actions cron (`.github/workflows/social-cron.yml`, every 15
min) rather than a server you have to keep alive — nothing here needs to run
on your own machine once it's set up.

## 1. One-time setup (run these locally, they're interactive)

```bash
npm install
cp .env.example .env
# fill in COMPOSIO_API_KEY from https://dashboard.composio.dev/settings
```

For each platform you want to use:

```bash
npm run connect -- twitter      # opens an OAuth link, waits for you to approve
npm run connect -- linkedin
npm run connect -- instagram
npm run connect -- facebook
```

Then, for each platform, find the real tool slugs (they vary by account/toolkit
version, so `config/actions.config.json` ships with placeholders rather than
guessed names):

```bash
npm run list-actions -- twitter post      # prints candidate slugs + descriptions
npm run list-actions -- twitter mention
```

Paste the slugs you want into `config/actions.config.json` (`post`,
`searchMentions`, `reply` per platform). Anything left as `"REPLACE_ME"` is
skipped at runtime rather than erroring the whole run.

## 2. Wire up GitHub Actions

Repo → Settings → Secrets and variables → Actions, add:

- `COMPOSIO_API_KEY` — same value as in `.env`.
- `LAB_WATCH_TOKEN` (optional) — a read-only PAT, only needed if the repos in
  `config/lab-watch.json` are private. Public repos work unauthenticated
  (lower GitHub API rate limit, fine at this polling frequency).

That's it — the cron workflow runs `lab-watcher.mjs`, `schedule-run.mjs`,
`mentions.mjs`, and `send-replies.mjs` every 15 minutes and commits state back
to the repo so it stays consistent across runs.

## 3. Everyday use

**Post something now:**

```bash
mkdir -p drafts/my-post && cd drafts/my-post
echo "launch caption here" > caption.txt
echo '{"platforms": ["twitter", "linkedin"]}' > meta.json
cp ~/Downloads/design.png image.png
cd ../.. && npm run post -- drafts/my-post
```

**Schedule it instead:** put the same folder under `scheduled/` and add
`"publishAt": "2026-08-10T15:00:00Z"` to `meta.json` — the cron job publishes
it once due, no manual step needed.

**Cross-posting from design-studio.html:** use the "Export for Social" button
in the studio — it downloads an image + caption named to match this
convention. Drop both files into a new folder under `drafts/` (or
`scheduled/`) with a `meta.json` — see `drafts/README.md`.

**Labs → auto-post:** edit `config/lab-watch.json` to list the repos/branches
to watch. Every new commit becomes a scheduled post (`publishAt` = now) using
`captionTemplate`, published on the same or next cron run — no approval step,
by design, since that's what was asked for. To hold a post back, either give
it a future `publishAt`, or delete its folder from `scheduled/` before the
next cron tick.

**Mentions → replies:** `mentions.mjs` only *drafts* replies, into
`pending-replies/<platform>-<id>.json`:

```json
{
  "platform": "twitter",
  "mentionId": "...",
  "text": "the mention text",
  "approved": false,
  "replyText": ""
}
```

Nothing sends until you edit a file, fill in `replyText`, and set
`"approved": true`, then commit+push (or run `npm run send-replies` locally).
This is the one deliberate safety default in the whole setup: auto-sending a
bad public reply is hard to take back, auto-posting a lab or a scheduled
draft you already wrote is not. Flip it by having `mentions.mjs` call
`send-replies` logic directly instead of writing a pending file, if you'd
rather it be fully automatic.

## Notes / things that need your judgment, not a default

- **Tool slugs and argument shapes are per-account.** `post.mjs`,
  `mentions.mjs`, and `send-replies.mjs` all have a `// NOTE:` comment where
  the argument names (e.g. `media_path`, `since_id`, `in_reply_to_id`) are my
  best guess from Composio's conventions, not verified against your live
  connected accounts. Run `list-actions.mjs` and adjust those spots once you
  see the real schema.
- **Image posting** assumes the underlying tool takes a local file path or
  will accept one; some toolkits want a URL or base64 upload instead — check
  what `list-actions` shows for the `post` tool's parameters.
