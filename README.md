# social-automation

Also doubles as a portfolio home for finished labs/work — see `portfolio/`.
Anything dropped there is a candidate for the auto-post pipeline above once
it's linked up from `config/lab-watch.json`.

Auto-post, schedule, cross-post drafts, reply to mentions, and post GitHub
"lab completed" commits to social accounts — built on
[Composio](https://composio.dev), which handles OAuth to each platform so
you don't need to register a developer app on X/LinkedIn/etc. yourself.

Runs on a GitHub Actions cron (`.github/workflows/social-cron.yml`) rather
than a server you have to keep alive — nothing here needs to run on your own
machine once it's set up.

The cron asks for every 15 minutes, but **that is a request, not a
guarantee**. GitHub throttles scheduled workflows, heavily on free-tier
repos, and the measured median gap between real runs here is closer to an
hour and a quarter (shortest seen: 38 minutes, longest: 6 hours). Every
script is written to be safe at any interval, so the only thing this affects
is latency: how long an `approve` reply sits before it publishes. Budget
around an hour, not 15 minutes. The status page reports the measured figure
rather than the configured one, so you can always check the real number.

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

That's it — on every tick the cron workflow runs `lab-watcher.mjs`,
`schedule-run.mjs`, `mentions.mjs`, `send-replies.mjs`,
`research-content.mjs`, `homelab-watcher.mjs`, `check-approvals.mjs`,
`send-content.mjs`, `request-approval.mjs`, `check-brief-stock.mjs`, and
`build-dashboard.mjs`, then commits state back to the repo so it stays
consistent across runs.

Steps run as separate workflow steps on purpose: one failing (a bad token, a
rate limit, an API hiccup) doesn't take the others down with it. Individual
runs do fail occasionally — GitHub sometimes can't allocate a runner at all,
which shows up as "The job was not acquired by Runner of type hosted". No
state is written in that case, so the next tick just picks up where the
failed one would have.

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

**Labs → drafted post:** edit `config/lab-watch.json` to list the repos and
branches to watch. A new commit drafts a post into `pending-posts/` for
approval, same as everything else.

The post is written from the commit rather than being the commit message.
Dumping `captionTemplate` straight onto a profile produced things like "fix:
typo in readme", and for a private repo the `{url}` was a link every reader
got a 404 on. The link is now only included when the repo is actually
public, and `captionTemplate` is just the fallback for when `GEMINI_API_KEY`
is missing or the call fails.

First run against a newly added repo records the current commit as a
baseline and drafts nothing, so adding a repo doesn't backfill whatever
happened to be at `HEAD`.

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

**Live status page:** `build-dashboard.mjs` regenerates `index.html` from the
repo's actual state at the end of every run, and it's served by GitHub Pages
at https://nomso3-og.github.io/social-automation/. Queue depths, what's
awaiting approval, and what's been published are read from disk at build time,
so the page is the live state of the pipeline rather than a picture of it.
Useful for explaining the setup to someone without walking them through a repo.

**Researched briefs → LinkedIn posts:** the main source of on-topic content.
`topics/` holds one `.json` per researched topic: an angle, a set of checkable
key points, and real source URLs. The writer takes the oldest unused brief and
writes a post from it, with the key points as the only facts in play and the
brief's sources attached to the draft.

This is where currency comes from, because live search grounding is
quota-limited on the free tier and usually unavailable. Researching up front
and committing the result sidesteps that entirely.

Add your own by dropping a `.json` in `topics/` and committing it. `title`,
`angle`, and `keyPoints` are enough; sources are optional. See
`topics/README.md`. Used briefs are tracked in `state/topics-used.json` and
stay in the folder as a record.

When every brief has been used, the writer falls back to live search, and then
to the generic rotating list in `config/content-topics.json`, which is
evergreen and uncited. So it's worth keeping `topics/` stocked.

You don't have to watch the folder yourself. `check-brief-stock.mjs` counts
the unused briefs every run, and when the count drops to `lowStockThreshold`
(default 3) it opens an issue assigned to you, so it arrives as an email and
a phone notification like every other prompt here. It reports how many days
of runway are left at the current cadence, not just a count, because four
briefs is a week at 48h and over a month at 240h. One issue at a time, and it
closes itself once you top the folder back up.

Check the wording without sending anything:

```bash
npm run check-brief-stock -- --dry-run --threshold=5
```

**Summary cards:** a post written from a brief gets a generated image, built
from the brief's own key points. `lib/summary-card.mjs` lays out an SVG and
rasterises it, so it costs nothing, needs no model call, and renders the same
way every time.

It's a typographic card, not a picture, and that's deliberate. An AI-generated
image on a compliance post is the visual equivalent of an em dash: it reads as
filler, it says nothing the text doesn't, and the tells are exactly what the
style rules exist to avoid. A card that names the framework and states two or
three checkable points is something a reader can use straight from the feed.

Points that don't fit whole are dropped rather than cut mid-clause, and the
card shrinks from three points to two before it will overflow. Preview them:

```bash
npm run preview-card                 # every brief, into card-previews/
npm run preview-card -- topics/007-nist-csf-govern.json
```

Turn it off with `"attachCard": false` in `config/content-topics.json`, or per
post by setting `imagePath` to `null` in the draft before approving. Only
briefs get cards: without key points there's nothing checkable to put on one,
and a card that restates the headline is decoration.

**Researched content → LinkedIn posts:** if `GEMINI_API_KEY` is set,
`research-content.mjs` picks the next topic from `config/content-topics.json`
(rotating, at most once per `cadenceHours`), **searches the web** for what's
currently being said about it via Gemini's Google Search grounding, and writes
a post from what it found into `pending-posts/linkedin-<timestamp>.json`.

The draft records `grounded`, `searchQueries`, and `sources`. **Sources are
taken only from the search tool's grounding metadata, never from the model's
own text** — a model asked to cite will invent plausible URLs, so the only
links that survive are pages it was actually shown. The post itself is told
not to contain URLs for the same reason.

If a run comes back with no sources, `grounded` is `false` and the approval
issue says so loudly. That means the model answered from memory rather than
search, and any factual claim in it needs checking before you approve.

Note the free tier has a **daily quota**. One post per 36 hours is well within
it, but heavy manual testing can exhaust it for the day; the script logs the
429 and retries on the next run rather than failing.

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

**Approving from email:** every new draft opens a GitHub issue assigned to
you, so GitHub emails you and the mobile app pushes a notification. **Reply
to that email with `approve`** and the post goes out on the next run.
`decline` throws it away. You don't have to open GitHub at all: replying to a
GitHub notification posts your reply as a comment, which is what this reads.

`yes` / `lgtm` / `ship it` also approve; `no` / `reject` also decline.

Only the first line is read, so a phone signature underneath (`Sent from my
iPhone`) is fine. The decision still has to stand on its own line, so "I'd
approve this if the hashtags were fixed" does **not** publish anything.

Only comments from the repo owner count. Anyone can comment on a public
repo's issues and a comment here publishes to your real account, so the
author check in `check-approvals.mjs` is the security boundary of the whole
flow. Don't loosen it. Email replies satisfy it because GitHub only accepts
them from an address attached to your account.

To reword before publishing, edit `text` in the draft file, then reply
`approve`. Setting `approved` in the JSON by hand still works too.

**House style:** `lib/style.mjs` holds the voice rules both writers share: a
banned-phrase list (`delve`, `testament`, `in today's digital age`, and the
rest), a hard ban on em dashes and hyphen bullets, and an instruction to vary
sentence length. Every draft carries a `styleFlags` array listing anything
that slipped through, so you can see it before approving. It's advisory, not
enforced. Edit the list in `lib/style.mjs` to taste.

Posts also have to end with a question, on its own line before the hashtags.
The rule is specific about what kind: it has to be answerable from the
reader's own working experience and about the thing the post actually
discussed. "How long does a user access review take your team?" invites an
answer. "What are your thoughts?" does not, because nobody has a thought to
offer, they have a Tuesday afternoon they lost to it. The stock prompts
(`Thoughts?`, `Agree?`, `Let me know in the comments`) are flagged as
`generic engagement bait`, and a post with no question at all is flagged too.

**Why LinkedIn only:** this pipeline can't do X/Twitter-style "find and
comment on other people's posts" — LinkedIn's API (even for a fully connected
member OAuth) has no topic/feed search action, only posting, commenting on a
*specific known* post, and account stats. Genuine cross-account engagement
needs a platform whose API supports search, which for this repo's connected
accounts currently means Twitter/X once it's connected with your own
Developer App credentials — see the twitter section above.

## What this depends on, and what happens if a subscription lapses

Worth being clear about, because it isn't obvious from the outside: **nothing
in this pipeline runs on an AI subscription.** No Claude plan, no ChatGPT
plan, no cloud console. If every one of those lapsed tomorrow, the posting
would carry on unchanged. Three services keep it alive, and all three are on
free tiers this repo stays well inside:

| What | Used for | Cost here |
| --- | --- | --- |
| GitHub Actions | running the cron, every step | Free, and **unlimited** because this repo is public. Minute limits only apply to private repos. |
| GitHub Pages | serving the status page | Free for public repos. |
| Composio | the LinkedIn connection and the posting call | Free tier is 20K tool calls/month. This uses a handful per run. |
| Google Gemini | writing the post text | Free tier. One post per 48h is far inside the daily quota. |

The card images cost nothing at all: they're drawn locally by
`lib/summary-card.mjs`, no API involved.

What a lapsed AI subscription actually costs you is **the ability to change
this repo by asking**. The pipeline keeps running; adding a feature to it goes
back to editing the files yourself. Two things worth knowing for that case:

- **Restocking `topics/` is hand-editable.** A brief is a small JSON file with
  a title, an angle, and a few key points. Writing one from an article you've
  read takes a few minutes and needs no tooling. That's the only recurring
  input the pipeline actually needs from you.
- **Nothing here is locked to a vendor you can't replace.** If the Gemini free
  tier changes, `research-content.mjs` is the only file that calls it. If
  Composio changes, `lib/composio.mjs` and `scripts/post.mjs` are the only
  files that touch it.

The one genuine single point of failure is the **LinkedIn OAuth connection**
held by Composio. If that's revoked or expires, posting stops until you
reconnect with `npm run connect -- linkedin`. Everything else keeps drafting
and queuing in the meantime, so nothing is lost, it just waits.

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
