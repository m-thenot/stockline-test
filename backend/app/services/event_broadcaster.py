import asyncio
from dataclasses import dataclass


@dataclass
class SSEEvent:
    """SSE event data structure."""

    event: str
    entity_type: str
    entity_id: str
    sync_id: int


class EventBroadcaster:
    """Manages SSE client connections and broadcasts sync events."""

    def __init__(self):
        self._clients: dict[str, asyncio.Queue[SSEEvent | None]] = {}

    async def connect(self, client_id: str) -> asyncio.Queue[SSEEvent | None]:
        """Register a new client and return its event queue."""
        queue: asyncio.Queue[SSEEvent | None] = asyncio.Queue()
        self._clients[client_id] = queue
        return queue

    def disconnect(self, client_id: str) -> None:
        """Unregister a client and clean up its queue."""
        self._clients.pop(client_id, None)

    async def broadcast(self, event: SSEEvent, exclude_client: str | None = None) -> None:
        """Broadcast an event to all connected clients except the excluded one."""
        for cid, queue in self._clients.items():
            if cid != exclude_client:
                await queue.put(event)


broadcaster = EventBroadcaster()
