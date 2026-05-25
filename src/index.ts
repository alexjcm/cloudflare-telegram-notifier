/**
 * Consumes `builds-queue-notifications`, receives Cloudflare Worker build
 * failure events, and sends formatted alerts to Telegram via the Bot API.
 *
 * @see https://developers.cloudflare.com/workers/
 * @see https://developers.cloudflare.com/queues/get-started/
 * @see https://core.telegram.org/bots/api#sendmessage
 */

import type { BuildFailedEvent, Env, TelegramApiResponse, TelegramSendResult } from './types';

/**
 * Escapes special characters for Telegram's MarkdownV2 format.
 *
 * @see https://core.telegram.org/bots/api#markdownv2-style
 */
function escapeMarkdownV2(text: string): string {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
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
async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<TelegramSendResult> {
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

        const responseText = await response.text();
        let responseData: TelegramApiResponse | null = null;

        if (responseText) {
            try {
                responseData = JSON.parse(responseText) as TelegramApiResponse;
            } catch {
                responseData = null;
            }
        }

        if (!response.ok || responseData?.ok === false) {
            const retryAfter = responseData?.parameters?.retry_after;
            const retryDelaySeconds = typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0
                ? Math.ceil(retryAfter)
                : undefined;
            const description = responseData?.description ?? (responseText || 'Unknown Telegram API error');
            const migrateToChatId = responseData?.parameters?.migrate_to_chat_id;
            const errorCode = responseData?.error_code ?? response.status;

            console.error(`Telegram API error (${errorCode}): ${description}`);

            if (migrateToChatId !== undefined) {
                console.error(`Telegram API suggested migrate_to_chat_id=${migrateToChatId}.`);
            }
            if (retryDelaySeconds !== undefined) {
                console.warn(`Telegram API requested retry_after=${retryDelaySeconds} seconds.`);
            }

            return {
                isSent: false,
                retryDelaySeconds,
            };
        }

        console.log('Telegram notification sent successfully.');
        return { isSent: true };
    } catch (error) {
        console.error(`Network or fetch error while sending to Telegram: ${error}`);
        return { isSent: false };
    }
}

export default {
    /**
     * The main queue consumer handler for Cloudflare Queues.
     *
     * @param batch - A batch of messages from the queue.
     * @param env - The Worker's environment bindings.
     */
    async queue(batch: MessageBatch<BuildFailedEvent>, env: Env): Promise<void> {
        for (const message of batch.messages) {
            const eventData = message.body;

            const workerName = eventData.source?.workerName ?? 'Unknown Worker';
            const metadata = eventData.payload?.buildTriggerMetadata;
            const repoName = metadata?.repoName ?? 'Unknown Repository';
            const commitMessage = metadata?.commitMessage ?? 'No commit message';

            const notificationText = `🚨 *Cloudflare Worker Build Failed* 🚨\n\n` +
                `*Project:* ${escapeMarkdownV2(repoName)}\n` +
                `*Worker:* ${escapeMarkdownV2(workerName)}\n` +
                `*Message:*\n${escapeMarkdownV2(commitMessage)}\n\n`;

            const sendResult = await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, notificationText);

            if (sendResult.isSent) {
                message.ack();
            } else if (sendResult.retryDelaySeconds !== undefined) {
                message.retry({ delaySeconds: sendResult.retryDelaySeconds });
            } else {
                message.retry();
            }
        }
    }
} satisfies ExportedHandler<Env, BuildFailedEvent>;
