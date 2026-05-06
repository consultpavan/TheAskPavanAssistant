import asyncio
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from datetime import datetime
from ai_context import AIContextAnalyzer
from models import TranscriptSegment
from state import app_state
import threading
import time
import win32com.client
import pythoncom

router = APIRouter()

# In a real scenario, you'd use a python SDK for your ASR provider (like Deepgram)
# e.g., deepgram = Deepgram(API_KEY)

def sapi_listener_thread(queue, loop, stop_event):
    pythoncom.CoInitialize()
    recognizer = win32com.client.Dispatch("SAPI.SpSharedRecognizer")
    context = recognizer.CreateRecoContext()
    grammar = context.CreateGrammar(1)
    grammar.DictationLoad()
    grammar.DictationSetState(1)
    
    class SapiEvents:
        def OnRecognition(self, StreamNumber, StreamPosition, RecognitionType, Result):
            text = Result.PhraseInfo.GetText()
            if text:
                loop.call_soon_threadsafe(queue.put_nowait, text)

    win32com.client.WithEvents(context, SapiEvents)
    
    print("SAPI Engine initialized and listening natively.")
    while not stop_event.is_set():
        pythoncom.PumpWaitingMessages()
        time.sleep(0.1)

@router.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    await websocket.accept()
    print("Client connected to transcription websocket")
    meeting_id = websocket.query_params.get("meeting_id")
    user_name = websocket.query_params.get("user_name", "Pavan")
    session_analyzer = AIContextAnalyzer(user_name=user_name, role="Business Unit Head")
    
    queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    stop_event = threading.Event()
    
    thread = threading.Thread(target=sapi_listener_thread, args=(queue, loop, stop_event))
    thread.start()
    
    try:
        recent_transcripts = []
        while True:
            get_task = asyncio.create_task(queue.get())
            recv_task = asyncio.create_task(websocket.receive())
            
            done, pending = await asyncio.wait(
                [get_task, recv_task],
                return_when=asyncio.FIRST_COMPLETED
            )
            
            if recv_task in done:
                get_task.cancel()
                msg = recv_task.result()
                if msg["type"] == "websocket.disconnect":
                    break
                continue
                
            if get_task in done:
                recv_task.cancel()
                text = get_task.result()
                
                segment = TranscriptSegment(
                    speaker="You",
                    text=text,
                    start_time=timestamp_now() - 2.0,
                    end_time=timestamp_now()
                )
                recent_transcripts.append(segment)
                
                if len(recent_transcripts) > 10:
                    recent_transcripts.pop(0)
                    
                await websocket.send_text(json.dumps({
                    "type": "transcript",
                    "data": segment.dict()
                }))

                if meeting_id:
                    app_state.append_transcript(meeting_id, segment.dict())
                
                # Run Context Evaluator on the window
                suggestion = await session_analyzer.analyze_context_window(recent_transcripts)
                if suggestion:
                    await websocket.send_text(json.dumps({
                        "type": "suggestion",
                        "data": suggestion.dict()
                    }))

                # Extract and persist task assignments for the current user.
                extracted_item = session_analyzer.extract_action_item(text)
                if extracted_item:
                    await websocket.send_text(json.dumps({
                        "type": "task_detected",
                        "data": {
                            "task": extracted_item["task"],
                            "assignee": extracted_item["assignee"],
                            "priority": "medium",
                            "category": "meeting",
                            "source_excerpt": extracted_item["source_excerpt"],
                            "deadline": extracted_item.get("deadline").isoformat() if extracted_item.get("deadline") else None,
                        },
                    }))

                extracted_requirement = session_analyzer.extract_requirement_item(text)
                if extracted_requirement:
                    await websocket.send_text(json.dumps({
                        "type": "requirement_detected",
                        "data": {
                            "requirement": extracted_requirement["requirement"],
                            "source_excerpt": extracted_requirement["source_excerpt"],
                            "confidence": extracted_requirement.get("confidence", 0.6),
                        },
                    }))
                    
    except WebSocketDisconnect:
        print("Client disconnected from transcription websocket")
    except Exception as e:
        print(f"Websocket error: {e}")
    finally:
        stop_event.set()
        thread.join(timeout=1.0)

def timestamp_now():
    return datetime.utcnow().timestamp()
