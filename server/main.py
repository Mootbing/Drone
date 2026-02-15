"""FastAPI entry point for the drone control server."""

import asyncio
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from config import WS_HOST, WS_PORT
from ws_handler import ConnectionManager
from models.sam_loader import SAMInference

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# SAM model and connection manager (initialized in lifespan)
sam = SAMInference()
manager = ConnectionManager(sam)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Drone Control Server starting on %s:%d", WS_HOST, WS_PORT)
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, sam.load)
    yield


app = FastAPI(title="Drone Control Server", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "state": manager.sm.state.value}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    connected = await manager.connect(websocket)
    if not connected:
        return
    try:
        while True:
            data = await websocket.receive_text()
            await manager.handle_message(data)
    except WebSocketDisconnect:
        await manager.disconnect()
    except Exception:
        logger.exception("WebSocket error")
        await manager.disconnect()


if __name__ == "__main__":
    uvicorn.run("main:app", host=WS_HOST, port=WS_PORT, reload=False)
