# Cloudflare Telegram Notifier

[![Deployed on Cloudflare](https://img.shields.io/badge/Deployed%20on-Cloudflare-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare Workers](https://img.shields.io/badge/Runtime-Cloudflare%20Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Telegram Bot](https://img.shields.io/badge/Notifications-Telegram%20Bot-26A5E4?style=flat-square&logo=telegram&logoColor=white)](https://core.telegram.org/bots/api)

A Cloudflare Worker that consumes build failure events from a queue and sends notifications to a Telegram chat.

## What it does

- Listens to the `builds-queue-notifications` queue.
- Receives messages when any Worker build fails ( `build.failed` event ).
- Formats the error details and sends them to a Telegram chat using a bot.

## Prerequisites

- A Telegram bot created with [@BotFather](https://t.me/botfather) (get the token).
- Your Telegram `chat_id` (you can get it from [@myidbot](https://t.me/myidbot)).
- A producer Worker already configured with an **Event Subscription** (`build.failed`) pointing to the `builds-queue-notifications` queue.

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Deploy the Worker for the first time**
   ```bash
   npm run deploy
   ```

3. **Add secrets to Cloudflare** (after first deploy)
   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_CHAT_ID
   ```

## Deployment

To redeploy after changes:
```bash
npm run deploy
```

## Testing

1. Run the TypeScript check:
   ```bash
   npm run typecheck
   ```
2. Start log monitoring:
   ```bash
   npx wrangler tail
   ```
3. Cause a build failure in a Worker that has the event subscription to your queue.
4. Within seconds, you should see logs and receive a notification in Telegram.

## License

MIT
