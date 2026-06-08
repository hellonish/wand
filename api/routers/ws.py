"""
WebSocket Router - Real-time Updates
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..auth import verify_token
from ..websocket import manager

router = APIRouter(tags=["WebSocket"])


@router.websocket("/ws/{token}")
async def websocket_endpoint(websocket: WebSocket, token: str):
    """
    WebSocket endpoint for real-time job updates.
    Connect with JWT token to authenticate.
    """
    # Verify token
    payload = verify_token(token)
    if not payload:
        await websocket.close(code=4001)
        return
    
    user_id = payload.get("sub")
    await manager.connect(websocket, user_id)
    
    try:
        # Send initial confirmation
        await websocket.send_json({
            "type": "connected",
            "message": "Connected to job updates"
        })
        
        # Listen for client messages (ping/pong)
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
        
    except WebSocketDisconnect:
        manager.disconnect(websocket, user_id)
    except Exception:
        manager.disconnect(websocket, user_id)
        await websocket.close()
