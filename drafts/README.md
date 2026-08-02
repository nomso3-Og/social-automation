# Drafts

Each draft is a folder:

```
drafts/my-poster-launch/
  caption.txt   # the post text
  meta.json     # {"platforms": ["twitter", "linkedin"]}
  image.png     # any image
```

- `npm run post -- drafts/my-poster-launch` publishes it immediately.
- Move (or copy) the folder into `../scheduled/` instead, and add
  `"publishAt": "2026-08-10T15:00:00Z"` to `meta.json`, to schedule it —
  `schedule-run.mjs` (run on the GitHub Actions cron) publishes it once due
  and moves it here, into `drafts/posted/`.
