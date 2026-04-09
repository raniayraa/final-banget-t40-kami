import asyncio
from fastapi import WebSocket
from typing import Dict, Set


class WSManager:
    def __init__(self):
        self._subscribers: Dict[str, Set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def subscribe(self, job_id: str, ws: WebSocket):
        async with self._lock:
            if job_id not in self._subscribers:
                self._subscribers[job_id] = set()
            self._subscribers[job_id].add(ws)

    async def unsubscribe(self, job_id: str, ws: WebSocket):
        async with self._lock:
            if job_id in self._subscribers:
                self._subscribers[job_id].discard(ws)
                if not self._subscribers[job_id]:
                    del self._subscribers[job_id]

    async def broadcast(self, job_id: str, message: dict):
        async with self._lock:
            sockets = set(self._subscribers.get(job_id, set()))
        dead = set()
        for ws in sockets:
            try:
                await ws.send_json(message)
            except Exception:
                dead.add(ws)
        if dead:
            async with self._lock:
                if job_id in self._subscribers:
                    self._subscribers[job_id] -= dead


manager = WSManager()
