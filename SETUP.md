# Setup guide

This isn't part of your profile — it's just for you, to get everything live.

## 1. Create the special repo
GitHub only renders a profile README if it lives in a repo named **exactly** like
your username. Create `KanwalAi/KanwalAi` (public), then copy these files into it:

```
README.md
.github/workflows/update-readme.yml
scripts/update-readme.mjs
scripts/package.json
assets/banner.png   ← replace with your own artwork
```

## 2. Replace the placeholders
Search `README.md` for `REPLACE_ME` and swap in your real LinkedIn, email, and
portfolio URL. Drop your banner image at `assets/banner.png`.

## 3. Enable Actions
- Repo → **Settings → Actions → General → Workflow permissions** → set to
  **"Read and write permissions"**. This lets the workflow commit the updated
  README and push the contribution-snake SVG.
- No extra secrets needed — `GITHUB_TOKEN` is provided automatically by Actions.

## 4. Run it once manually
Go to **Actions → Update Profile README → Run workflow** to populate the tech
stack and featured-projects sections immediately instead of waiting for the
nightly cron.

## 5. What updates itself vs. what you own
| Fully automatic (no setup beyond step 3) | Needs the workflow to run once |
|---|---|
| GitHub Stats, Top Languages, Streak, Activity Graph, Profile Views, Followers, Contribution Snake, Daily Quote | Tech Stack icons, Featured Project cards, Recent Activity feed |
| These re-render live every time someone views your profile | These are committed as static markdown by the scheduled Action |

Anything under **About Me**, **Current Focus**, and the social badges is yours
to edit by hand — that's your voice, not GitHub's data.
