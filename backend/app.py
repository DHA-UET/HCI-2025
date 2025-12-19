import uvicorn
import os
import tempfile
import shutil
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
import assistant
import session_manager

app = FastAPI()

# CORS configuration for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allow all methods
    allow_headers=["*"],  # Allow all headers
)


@app.get("/")
def read_root():
    return {"message": "Hello, World!"}


@app.get("/api/health")
def health_check():
    return {"status": "ok"}

@app.get("/api/sessions")
async def get_all_sessions():
    return { "sessions": session_manager.get_all_session() }

@app.post("/api/voice-chat")
async def process_audio(file: UploadFile = File(...), session_id: str = Form(...)):
    print(session_id)
    suffix = ".webm" 
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        temp_file_path = tmp.name

    try:
        new_user_msg, new_bot_msg = await assistant.voice_chat(temp_file_path, session_id)
        return { "user": new_user_msg, "bot": new_bot_msg }
    except Exception as e:
        return {"error": str(e)}
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)

