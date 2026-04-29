/**
 * Welcome to Cloudflare Workers!
 *
 * This is a template for a Queue consumer: a Worker that can consume from a
 * Queue: https://developers.cloudflare.com/queues/get-started/
 *
 * - Run `npm run dev`
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker in Cloudflare.
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

/**
 * Cloudflare Telegram Notifier - Worker Consumer
 *
 * This Worker listens to a Cloudflare Queue (`builds-queue-notifications`) for
 * build failure events from other Cloudflare Workers. When a failure event is
 * received, it formats the error details and sends a notification message to a
 * Telegram chat using the Bot API.
 *
 * @see https://core.telegram.org/bots/api#sendmessage
 * @see https://developers.cloudflare.com/queues/
 */

export interface Env {
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_CHAT_ID: string;
}

/**
 * The expected structure of a build failure message from the Cloudflare Queue.
 * This matches the event subscription you configured for your Workers.
 */
interface BuildFailedEvent {
    type: string;
    source?: {
        type: string;
        workerName?: string;
    };
    payload: {
        buildUuid: string;
        status: string;
        buildOutcome: "success" | "failure" | "canceled" | "cancelled";
        buildTriggerMetadata?: {
            commitMessage: string;
            repoName: string;
        };
    };
    metadata?: {
        eventTimestamp: string;
    };
}

/**
 * Escapes special characters for Telegram's MarkdownV2 format.
 *
 * @see https://core.telegram.org/bots/api#markdownv2-style
 */
function escapeMarkdownV2(text: string): string {
    const specialChars = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
    const regex = new RegExp(`\\${specialChars.join('|\\')}`, 'g');
    return text.replace(regex, '\\$&');
}

/**
 * Helper function to send a message to a Telegram chat.
 * It encapsulates the API call and structured logging.
 *
 * @param botToken The bot's API token from @BotFather.
 * @param chatId The target chat ID (e.g., from @myidbot).
 * @param text The message content to send.
 * @returns A promise that resolves to `true` if the message was sent successfully, `false` otherwise.
 */
async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<boolean> {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'MarkdownV2',
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            // If the error is a "Conflict" (409), it likely means the message is a duplicate.
            // We can treat this as a non-critical error and log it.
            if (response.status === 409) {
                console.warn(`Telegram API conflict (likely duplicate message): ${await response.text()}`);
                return true; // Return true to acknowledge and not retry the queue message.
            }

            // For other errors (like 429 rate limiting, 400 bad request), log and return false.
            const errorText = await response.text();
            console.error(`Telegram API error (${response.status}): ${errorText}`);
            return false;
        }

        console.log('Telegram notification sent successfully.');
        return true;
    } catch (error) {
        console.error(`Network or fetch error while sending to Telegram: ${error}`);
        return false;
    }
}

export default {
    /**
     * An optional HTTP fetch handler.
     */
    async fetch(request: Request, env: Env): Promise<Response> {
        return new Response('Cloudflare Telegram Notifier Worker is running and listening to queue events.');
    },

    /**
     * The main queue consumer handler for Cloudflare Queues.
     *
     * @param batch - A batch of messages from the queue. Type is unknown because
     *                the actual message structure is determined at runtime.
     * @param env - The Worker's environment bindings, containing our secrets.
     */
	async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
		for (const message of batch.messages) {
			const eventData = message.body as BuildFailedEvent;

			const workerName = eventData.source?.workerName ?? 'Unknown Worker';
			const metadata = eventData.payload?.buildTriggerMetadata;
			const repoName = metadata?.repoName ?? 'Unknown Repository';
			const commitMessage = metadata?.commitMessage ?? 'No commit message';
			
			const notificationText = `🚨 *Cloudflare Worker Build Failed* 🚨\n\n` +
				`*Project:* ${escapeMarkdownV2(repoName)}\n` +
				`*Worker:* ${escapeMarkdownV2(workerName)}\n` +
				`*Message:*\n${escapeMarkdownV2(commitMessage)}\n\n`;

			const isSent = await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, notificationText);

			if (isSent) {
				message.ack();
			} else {
				message.retry();
			}
		}
	}
} satisfies ExportedHandler<Env>;