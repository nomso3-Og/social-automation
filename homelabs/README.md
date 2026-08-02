# Homelabs

Drop a Markdown write-up of a project or homelab build in this folder, commit
it, and the next cron run turns it into a LinkedIn portfolio post drafted into
`pending-posts/` for your approval. Nothing publishes on its own.

```
homelabs/
  pfsense-segmentation.md
  iso27001-asset-inventory.md
```

There's no required format. Headings and bullets are fine, so are rough notes.
The more concrete the notes, the better the post: the writer is instructed to
use only what's in the file and to write less rather than invent details, so
vague notes produce a vague post.

Worth including if you have them:

- what problem it solved and why you bothered
- the actual stack (tools, versions, hardware)
- how it's put together
- anything touching governance, risk, or compliance
- real numbers or outcomes (these get used verbatim, so keep them accurate)

## Editing and re-running

Files are tracked in `state/homelab-seen.json` by content hash. Re-running
changes nothing. **Edit a write-up and it gets drafted again** on the next
run, which is the way to retry a post you didn't like: change the notes, and
delete the old draft from `pending-posts/` if it's still sitting there.

To publish, open the draft in `pending-posts/`, edit `text` however you want,
set `"approved": true`, and commit. `send-content.mjs` picks it up on the next
run and archives it to `pending-posts/posted/` once sent.

Drafts carry a `styleFlags` array. Anything listed there is a phrase or
character the house style bans (see `lib/style.mjs`) that the model used
anyway. Worth a look before approving, though it's advisory, not a blocker.
