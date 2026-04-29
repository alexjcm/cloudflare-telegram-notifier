/**
 * Welcome to Cloudflare Workers!
 *
 * This is a template for a Queue consumer: a Worker that can consume from a
 * Queue: https://developers.cloudflare.com/queues/get-started/
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
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
    name?: string;           // Name of the Worker where the build failed.
    worker_name?: string;   // Alternative field for the Worker's name.
    error?: {
        message: string;    // Detailed error message from the build process.
    };
    message?: string;       // A simple error message string.
    status?: string;        // e.g., 'failed', 'succeeded'.
    type?: string;          // e.g., 'build.failed'.
    timestamp?: number;     // Unix timestamp of the event (milliseconds).
}

/**
 * Escapes special characters for Telegram's MarkdownV2 format.
 *
 * The MarkdownV2 mode requires many characters (e.g., '_', '*', '[', '(', '~')
 * to be escaped with a backslash if they appear as regular text. This function
 * ensures the message text is formatted correctly and avoids parsing errors.
 *
 * @see https://core.telegram.org/bots/api#markdownv2-style
 */
function escapeMarkdownV2(text: string): string {
    // List of special characters that need to be escaped for MarkdownV2.
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

    // Prepare the payload for the Telegram Bot API.
    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'MarkdownV2', // Use the recommended and more powerful MarkdownV2 mode.
        // Uncomment the line below to enable content protection (prevents forwarding).
        // protect_content: true,
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
        // This block catches network errors, timeouts, or other fetch-related issues.
        console.error(`Network or fetch error while sending to Telegram: ${error}`);
        return false;
    }
}

export default {
    /**
     * An optional HTTP fetch handler.
     * This can be used for health checks or manual testing. For instance, you can
     * visit your Worker's URL in a browser to see a simple status message.
     */
    async fetch(request: Request, env: Env): Promise<Response> {
        return new Response('Cloudflare Telegram Notifier Worker is running and listening to queue events.');
    },

    /**
     * The main queue consumer handler for Cloudflare Queues.
     *
     * This function is invoked by Cloudflare when a batch of messages is available
     * in the queue this Worker is configured to consume from.
     *
     * @param batch - A batch of messages from the queue. Type is unknown because
     *                the actual message structure is determined at runtime.
     * @param env - The Worker's environment bindings, containing our secrets.
     */
    async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
        // Process each message in the batch individually.
        for (const message of batch.messages) {
            // Type assertion: we assume that the message body conforms to BuildFailedEvent.
            // In a production environment, you might add runtime validation here.
            const eventData = message.body as BuildFailedEvent;

            // Extract the worker's name from the event data, handling different field possibilities.
            const workerName = eventData.worker_name ?? eventData.name ?? 'Unknown Worker';
            // Extract the error message from the event data.
            const rawErrorMessage = eventData.error?.message ?? eventData.message ?? 'No error details provided.';
            // Truncate and cap the error message to ensure it does not exceed the 4096-character limit.
            const maxMessageLength = 4000; // Leave some room for the rest of the message template.
            const truncatedErrorMessage = rawErrorMessage.length > maxMessageLength
                ? rawErrorMessage.substring(0, maxMessageLength) + '... [truncated]'
                : rawErrorMessage;

            // Escape special characters for MarkdownV2 in the dynamic parts of the message.
            const safeWorkerName = escapeMarkdownV2(workerName);
            const safeErrorMessage = escapeMarkdownV2(truncatedErrorMessage);

            // Create the final notification message with MarkdownV2 formatting.
            const notificationText = `🚨 *ALERTA: Build Fallido en Cloudflare* 🚨\n\n` +
                `*Worker:* \`${safeWorkerName}\`\n` +
                `*Error:*\n\`\`\`\n${safeErrorMessage}\n\`\`\`` +
                `\n*Timestamp:* \`${new Date(eventData.timestamp ?? Date.now()).toISOString()}\``;

            // Attempt to send the notification to Telegram.
            const isSent = await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, notificationText);

            if (isSent) {
                // Only acknowledge the message if it was sent to Telegram successfully.
                message.ack();
                console.log(`Message for Worker "${workerName}" processed successfully.`);
            } else {
                // If sending failed, call `.retry()`. This will re-queue the message
                // to be processed again later.
                message.retry();
                console.error(`Failed to send notification for Worker "${workerName}". Message will be retried.`);
            }
        }
    },
} satisfies ExportedHandler<Env>;