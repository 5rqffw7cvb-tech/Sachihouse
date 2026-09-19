# Sitemap — deploy checklist

`frontend/public/sitemap.xml` is a committed file, not something the build
container can regenerate on its own: the Docker build has no backend to fetch
properties or blog posts from (see the `SITEMAP_STRICT` comment in
`frontend/Dockerfile`), so `npm run build`'s `prebuild` step always falls back
to whatever is already committed there. If nobody regenerates it, new
properties and blog posts never show up in `sitemap.xml`, and Google never
learns about them.

## Regenerating before a deploy

Run this from `frontend/` against the **production** API, not localhost —
the script writes whatever `VITE_API_BASE_URL` resolves to straight into the
`<loc>` URLs:

```bash
cd frontend
VITE_API_BASE_URL=https://api.sachi-house.net/api npm run sitemap
```

Then:

1. Check `git diff public/sitemap.xml` — it should have picked up any
   property or blog post added or removed since the last run.
2. Commit `public/sitemap.xml`.
3. Build the image as usual (`docker build ...` / whatever the pipeline
   does). `prebuild` will run again inside the container, find the backend
   unreachable there, and keep the file just committed.

## For a pipeline that does have API access at build time

If the build environment can actually reach the production API (unlike the
plain `docker build` above), pass `--build-arg SITEMAP_STRICT=1`. That fails
the build if the properties/blog-posts fetch fails, instead of silently
shipping the possibly-stale committed fallback:

```bash
docker build \
  --build-arg VITE_API_BASE_URL=https://api.sachi-house.net/api \
  --build-arg SITEMAP_STRICT=1 \
  -t sachihouse-frontend .
```

Without API access at build time (the common case), leave `SITEMAP_STRICT`
at its default of `0` and rely on the "regenerate and commit" steps above
instead.
