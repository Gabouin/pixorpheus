# Contributing to Pixorpheus

Thanks for wanting to help. Here's how things work.

## Getting Started

1. Fork the repo and clone it locally
2. Copy `.env.example` to `.env` and fill in your tokens (you'll need a test Slack workspace)
3. Run `npm install`
4. Start the bot with `node index.js` and the dashboard with `node dashboard.js`

You'll need:
- A Slack app with the right permissions (see the event subscriptions and slash commands listed in the README)
- A PostgreSQL database (Railway, Neon, or local)
- An OpenRouter API key for AI features
- Optionally: an Anthropic API key (DMs), a Brave Search key (web search)

## Project Structure

Everything bot-related lives in `index.js`. It's a single file - not ideal architecturally but intentional for simplicity. The dashboard is `dashboard.js`. Both share the same DB.

Before touching the ticket system or the AI prompt, read the relevant sections in the README so you understand the full flow.

## Making Changes

- Keep PRs focused — one thing at a time
- If you're changing the system prompt, test it against edge cases (chime mode, DMs, thread context)
- If you're touching the ticket system, test the full flow: new message, title modal, claim, resolve, reopen
- Don't change the AI model without checking costs and latency

## What's Welcome

- Bug fixes
- New slash commands (follow the existing pattern)
- Improvements to the ticket/dashboard system
- Performance or reliability fixes

## What to Avoid

- Restructuring the whole file without discussing it first
- Changing the bot's personality in the system prompt without a good reason
- Adding dependencies that aren't clearly necessary

## License

This project is licensed under **AGPL v3**. Any modifications you make and deploy as a hosted service must be published as open source under the same license.

## Opening a PR

Open against `main`. Describe what you changed and why. If it touches the AI behavior or ticket flow, say so explicitly.

If something is broken or confusing, open an issue first before working on a fix.
