import os
import json
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from interview_session import InterviewSession, transcribe_audio, text_to_speech

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()

app = FastAPI(title="AI Mock Interviewer Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all for development & easy deployment
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    has_openai = os.environ.get("OPENAI_API_KEY") is not None
    return {
        "status": "online",
        "api_keys": {
            "openai": has_openai
        },
        "message": "AI Mock Interviewer WebSocket backend running."
    }

@app.websocket("/ws/interview")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket connection established.")
    
    session = None
    audio_buffer = bytearray()
    has_openai = os.environ.get("OPENAI_API_KEY") is not None
    
    # Send initial handshake configuration
    await websocket.send_json({
        "type": "handshake",
        "has_openai": has_openai
    })
    
    try:
        while True:
            # Determine if incoming message is text or binary
            message = await websocket.receive()
            
            if "bytes" in message:
                # Binary audio chunk
                chunk = message["bytes"]
                audio_buffer.extend(chunk)
                continue
                
            if "text" in message:
                data = json.loads(message["text"])
                msg_type = data.get("type")
                
                if msg_type == "start":
                    interview_type = data.get("interview_type", "React Developer")
                    session = InterviewSession(interview_type)
                    first_q = session.get_first_question()
                    
                    # Convert first question to audio if OpenAI keys are active
                    audio_base64 = text_to_speech(first_q) if has_openai else ""
                    
                    await websocket.send_json({
                        "type": "question",
                        "text": first_q,
                        "audio": audio_base64,
                        "question_count": session.question_count,
                        "max_questions": session.max_questions
                    })
                    
                elif msg_type == "text_answer":
                    answer_text = data.get("text", "").strip()
                    if not session:
                        await websocket.send_json({"type": "error", "message": "Session not started"})
                        continue
                        
                    session.add_user_answer(answer_text)
                    await websocket.send_json({"type": "processing"})
                    
                    next_q = session.generate_next_question()
                    
                    if session.question_count > session.max_questions:
                        # Interview finished! Send report
                        report = session.generate_feedback_report()
                        await websocket.send_json({
                            "type": "report",
                            "report": report
                        })
                    else:
                        audio_base64 = text_to_speech(next_q) if has_openai else ""
                        await websocket.send_json({
                            "type": "question",
                            "text": next_q,
                            "audio": audio_base64,
                            "question_count": session.question_count,
                            "max_questions": session.max_questions
                        })
                        
                elif msg_type == "process_audio":
                    if not session:
                        await websocket.send_json({"type": "error", "message": "Session not started"})
                        continue
                        
                    if len(audio_buffer) == 0:
                        await websocket.send_json({"type": "error", "message": "No audio received"})
                        continue
                        
                    await websocket.send_json({"type": "processing"})
                    
                    # Transcribe audio using Whisper
                    transcribed_text = transcribe_audio(bytes(audio_buffer))
                    # Reset audio buffer for next turn
                    audio_buffer = bytearray()
                    
                    if not transcribed_text:
                        await websocket.send_json({
                            "type": "transcription_error",
                            "message": "Failed to transcribe audio or silent answer. Please try again or type your answer."
                        })
                        continue
                        
                    logger.info(f"Transcribed: {transcribed_text}")
                    
                    session.add_user_answer(transcribed_text)
                    next_q = session.generate_next_question()
                    
                    if session.question_count > session.max_questions:
                        report = session.generate_feedback_report()
                        await websocket.send_json({
                            "type": "report",
                            "report": report,
                            "user_transcript": transcribed_text
                        })
                    else:
                        audio_base64 = text_to_speech(next_q) if has_openai else ""
                        await websocket.send_json({
                            "type": "question",
                            "text": next_q,
                            "audio": audio_base64,
                            "question_count": session.question_count,
                            "max_questions": session.max_questions,
                            "user_transcript": transcribed_text
                        })
                        
                elif msg_type == "cancel":
                    logger.info("Session cancelled by client.")
                    break
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected.")
    except Exception as e:
        logger.error(f"Error in WebSocket handler: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except:
            pass
