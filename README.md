# social-automation

Also doubles as a portfolio home for finished labs/work — see `portfolio/`.
Anything dropped there is a candidate for the auto-post pipeline above once
it's linked up from `config/lab-watch.json`.

Auto-post, schedule, cross-post drafts, reply to mentions, and post GitHub
"lab completed" commits to social accounts — built on
[Composio](https://composio.dev), which handles OAuth to each platform so
you don't need to register a developer app on X/LinkedIn/etc. yourself.

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
- `GEMINI_API_KEY` (optional) — only needed if you want `research-content.mjs`
  to draft original posts (see "AI-written content" below). Free, from
  https://aistudio.google.com/apikey.

That's it — the cron workflow runs `lab-watcher.mjs`, `schedule-run.mjs`,
`mentions.mjs`, `send-replies.mjs`, `research-content.mjs`, and
`send-content.mjs` every 15 minutes and commits state back to the repo so it
stays consistent across runs.

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

**Cross-posting a design or any other image:** export/save the image
yourself, then create a folder under `drafts/` (or `scheduled/`) with that
image, a `caption.txt`, and a `meta.json` — see `drafts/README.md`.

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
rather it be fully automatic. Once sent, the file moves to
`pending-replies/posted/<file>` (stamped with `postedAt`) instead of being
deleted, so you have a browsable history of what actually went out.

**AI-written content → LinkedIn posts:** if `GEMINI_API_KEY` is set,
`research-content.mjs` picks the next topic from `config/content-topics.json`
(rotates through the list, at most once per `cadenceHours`), and uses Gemini's
free tier to write an original reference/cheat-sheet-style post — the kind of
"here's a practical breakdown of X" post InfoSec/GRC folks share, not news
commentary — into `pending-posts/linkedin-<timestamp>.json`:

```json
{
  "platform": "linkedin",
  "topic": "SOC 2 audits and readiness checklist",
  "text": "the drafted post",
  "approved": false
}
```

Same safety default as mentions, and for the same reason: this is the
model's own take on a topic, not your own verified work, so it needs your
review before it goes out. Edit `text` if you want, set `"approved": true`,
commit+push (or run `npm run send-content` locally). Once sent, the file
moves to `pending-posts/posted/<file>` (stamped with `postedAt`) instead of
being deleted. `config/content-topics.json`'s
topics are a starting point for a GRC/IT-focused profile — edit the list to
match your own field. The prompt in `research-content.mjs` explicitly bans em
dashes and instructs plain, human phrasing — tune it further if posts still
read as AI-written. If `GEMINI_API_KEY` isn't set, `research-content.mjs`
fails immediately (no content-gen without a key); the rest of the cron
pipeline is unaffected since it runs as its own step.

**Homelab write-ups → portfolio posts:** drop a Markdown file describing a
project into `homelabs/` and commit it. `homelab-watcher.mjs` turns it into a
story-driven portfolio post in `pending-posts/`, same approval gate as
everything else. It's told to use only what's in your notes and to write less
rather than invent details, so vague notes give a vague post. Files are
tracked by content hash in `state/homelab-seen.json`: re-running does
nothing, editing a write-up regenerates it. See `homelabs/README.md`.

**Approving from your phone:** every new draft opens a GitHub issue assigned
to you, which is what makes the GitHub mobile app push a notification. Reply
`approve` to publish or `decline` to throw it away, and the next run acts on
it. To edit first, change `text` in the draft file, then reply `approve`.

Only comments from the repo owner count. Anyone can comment on a public
repo's issues and a comment here publishes to your real account, so the
author check in `check-approvals.mjs` is the security boundary of the whole
flow. Don't loosen it. The word has to be the whole comment, so "I'd approve
this if..." doesn't fire.

Editing `approved` in the JSON directly still works if you'd rather.

**House style:** `lib/style.mjs` holds the voice rules both writers share: a
banned-phrase list (`delve`, `testament`, `in today's digital age`, and the
rest), a hard ban on em dashes and hyphen bullets, and an instruction to vary
sentence length. Every draft carries a `styleFlags` array listing anything
that slipped through, so you can see it before approving. It's advisory, not
enforced. Edit the list in `lib/style.mjs` to taste.

**Why LinkedIn only:** this pipeline can't do X/Twitter-style "find and
comment on other people's posts" — LinkedIn's API (even for a fully connected
member OAuth) has no topic/feed search action, only posting, commenting on a
*specific known* post, and account stats. Genuine cross-account engagement
needs a platform whose API supports search, which for this repo's connected
accounts currently means Twitter/X once it's connected with your own
Developer App credentials — see the twitter section above.

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
