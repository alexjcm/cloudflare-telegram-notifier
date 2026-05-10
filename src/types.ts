export interface Env {
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_CHAT_ID: string;
}

/**
 * The expected structure of a build failure message from the Cloudflare Queue.
 * This matches the event subscription you configured for your Workers.
 */
export interface BuildFailedEvent {
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

export interface TelegramApiResponse {
    ok: boolean;
    description?: string;
    error_code?: number;
    parameters?: {
        retry_after?: number;
        migrate_to_chat_id?: number | string;
    };
}

export interface TelegramSendResult {
    isSent: boolean;
    retryDelaySeconds?: number;
}
