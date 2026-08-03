# Topics

Researched briefs the post writer draws from. One `.json` file per topic. The
writer takes the oldest unused brief, writes a post from it, and attaches the
brief's sources to the draft for approval.

This exists because Gemini's live search grounding has a small free-tier quota
and is usually unavailable, so runtime research isn't reliable. Researching up
front and committing the result gives the writer real, current, sourced
material without needing search at the moment it writes.

## Format

```json
{
  "title": "Short name for the topic",
  "researchedAt": "2026-08-03",
  "angle": "Why this is worth a post, in one or two sentences.",
  "keyPoints": [
    "A specific, checkable fact.",
    "Another one."
  ],
  "sources": [
    { "title": "Article title", "url": "https://..." }
  ]
}
```

`keyPoints` is the ground truth. The writer is instructed to use only what's
in them and not to add numbers, dates, or claims of its own, so a vague brief
produces a vague post and a wrong fact here becomes a wrong post.

## Adding your own

Drop a `.json` file in this folder and commit it. It gets picked up on the
next run. Any topic in your field works: something you hit at work, a control
you keep seeing fail, a question that keeps coming up on the service desk.

You don't need sources. A brief with just `title`, `angle`, and `keyPoints`
works fine; the post simply won't cite anything.

## Keeping it stocked

`state/topics-used.json` records which briefs have been posted. Used briefs
stay in the folder as a record. When every brief has been used the writer
falls back to the generic rotating list in `config/content-topics.json`, which
is evergreen and uncited, so it's worth topping this folder up.

Facts go stale. A brief about a deadline or a "new" requirement is worth
deleting or rewriting once it stops being current.
