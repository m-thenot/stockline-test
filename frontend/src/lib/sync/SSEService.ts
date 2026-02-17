import { API_BASE } from "@/lib/api";
import { logger } from "@/lib/utils/logger";

export interface SSEEvent {
  event: string;
  entity_type: string;
  entity_id: string;
  sync_id: number;
}

export type SSEEventHandler = (event: SSEEvent) => void;

export class SSEService {
  private eventSource: EventSource | null = null;
  private onEvent: SSEEventHandler;

  constructor(onEvent: SSEEventHandler) {
    this.onEvent = onEvent;
  }

  connect(): void {
    if (this.eventSource) {
      logger.warn("SSE already connected");
      return;
    }

    const url = `${API_BASE}/sync/events`;
    this.eventSource = new EventSource(url);

    this.eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as SSEEvent;
        this.onEvent(data);
      } catch (error) {
        logger.error("Failed to parse SSE event:", error);
      }
    };

    this.eventSource.onerror = (error) => {
      logger.error("SSE connection error:", error);
      // EventSource handles reconnection automatically
    };

    logger.info("SSE connection established");
  }

  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      logger.info("SSE connection closed");
    }
  }

  isConnected(): boolean {
    return (
      this.eventSource !== null &&
      this.eventSource.readyState === EventSource.OPEN
    );
  }
}
