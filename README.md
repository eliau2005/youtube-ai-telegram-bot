# youtube-ai-telegram-bot

A Telegram bot port of [youtube-ai-processor](../youtube-ai-processor). Same pipeline (YouTube playlist → Gemini categorization → Strapi import), driven by Telegram chat instead of an Electron GUI.

## Highlights

- Multi-step Wizard for `/new` (URL → category → sub-categories → groups → rabbis → optional pre-chat with Gemini → run).
- **Pre-chat with AI**: describe the series in free Hebrew (e.g. "פרשת שבוע, אין סימנים, סדר לפי חומשים"). Gemini asks clarifying questions and emits structured `customInstructions` that augment the categorization prompt.
- Inline-button dialogs for `OUT_OF_SCOPE` and `NEW_SUBCATEGORY_NEEDED` items.
- Post-AI corrections: general (re-run AI on cached videos) or per-item edit.
- JSON Import (compare to Strapi → per-row decisions → push) and JSON Export (filtered Strapi pull → file).
- History per user, `/cancel` for in-flight jobs, restart-safe state on disk.
- Whitelist auth via `ALLOWED_USER_IDS`.

## Setup

1. Create a Telegram bot via [@BotFather](https://t.me/BotFather) → copy token.
2. Get your Telegram user id from [@userinfobot](https://t.me/userinfobot).
3. `cp .env.example .env` and fill in:
   - `TELEGRAM_BOT_TOKEN`, `ALLOWED_USER_IDS=123,456`
   - `YOUTUBE_API_KEY`, `GEMINI_API_KEY`
   - `STRAPI_URL`, `STRAPI_TOKEN`
4. `docker-compose up --build`

For local dev without Docker:

```
npm install
npm run dev
```

## Commands

| Command | Description |
|---|---|
| `/start` | Welcome + main menu |
| `/new` | Begin a new playlist analysis Wizard |
| `/import` | Upload a JSON file → compare-then-push to Strapi |
| `/export` | Pull lessons from Strapi by filters → JSON file |
| `/history` | List past processed playlists |
| `/cancel` | Abort the running job |
| `/help` | Command reference |

## Storage

State persists under `DATA_DIR` (default `./data`):
- `data/users/{telegramId}/active.json` — current scene state
- `data/users/{telegramId}/history.json` — completed playlists
- `data/users/{telegramId}/jobs/{jobId}.json` — processed lesson output
- `data/users/{telegramId}/uploads/` — temp files from `/import`

No database. The container only needs the `./data` volume mount.
