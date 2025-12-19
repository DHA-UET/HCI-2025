from google import genai
from google.genai import types
import os
from datetime import datetime
from database import DB
import whisper
import numpy as np

client = genai.Client(api_key="AIzaSyBWv4FiN-yv3n5wUQUK0vTfRl0KtCfkezg")
MODEL_ID = "gemini-2.5-flash" 
EMBEDDING_MODEL = "text-embedding-004"

stt_model = whisper.load_model("base")

db_path = os.path.join(os.getcwd(), "data/db.json")
db = DB(db_path, [])

HISTORY_WINDOW = 10

SYSTEM_INSTRUCTION = """
Bạn là "Voi Con Ham Học", một trợ lý ảo giọng nói như một người bạn dành cho trẻ em khiếm thị (6-12 tuổi).

QUY TẮC TRẢ LỜI (HCI GUIDELINES):
1.  **Auditory First:** Ưu tiên mô tả sự vật bằng âm thanh, mùi vị, xúc giác. Tránh dùng từ chỉ màu sắc hoặc hình ảnh trừu tượng trừ khi trẻ hỏi.
    * *Tệ:* "Quả bóng màu đỏ."
    * *Tốt:* "Quả bóng tròn vo, cầm mát tay, nảy xuống đất kêu boing boing."
2.  **Short & Sweet:** Trả lời ngắn gọn (dưới 3 câu). Trẻ nghe lâu sẽ mệt và quên.
3.  **Encouraging:** Luôn vui vẻ, khích lệ trẻ. Dùng từ ngữ đơn giản, gần gũi.
4.  **Error Handling:** Nếu không nghe rõ, hãy nói: "Voi con chưa nghe kịp, bạn nói lại nhé?" một cách nhẹ nhàng.
"""

def get_embedding(text):
    """Embed text sang vector"""
    if not text: return None
    try:
        res = client.models.embed_content(model=EMBEDDING_MODEL, contents=text)
        return res.embeddings[0].values
    except: return None

def retrieve_context_pairs(query_text, all_messages, session_id, top_k=3):
    """
    Use raw text.
    """
    if not query_text: return ""

    query_vec = get_embedding(query_text)
    if query_vec is None: return ""

    scored_results = []
    
    candidate_msgs = [
        (idx, m) for idx, m in enumerate(all_messages) 
        if m['from'] == 'user' and m.get('session') != session_id
    ]

    for idx, msg in candidate_msgs:
        msg_vec = get_embedding(msg['message'])
        if msg_vec:
            # Cosine Similarity
            score = np.dot(query_vec, msg_vec) / (np.linalg.norm(query_vec) * np.linalg.norm(msg_vec))
            
            if score > 0.5:
                user_content = msg['message']
                bot_content = "..."
                
                if idx + 1 < len(all_messages) and all_messages[idx+1]['from'] == 'bot':
                    bot_content = all_messages[idx+1]['message']
                
                scored_results.append((score, user_content, bot_content, msg['create_at']))

    # Top K
    scored_results.sort(key=lambda x: x[0], reverse=True)
    top_results = scored_results[:top_k]

    if not top_results: return ""

    # Format text
    context_str = "\n[KÝ ỨC LIÊN QUAN (Retrieval)]:\n"
    for _, u_text, b_text, time in top_results:
        context_str += f"- (Ngày cũ) Bạn nhỏ: {u_text} \n  -> Voi Con: {b_text}\n"
    
    return context_str


async def voice_chat(audio_file_path:str, session_id:int):
    user_message_create_at = datetime.now().isoformat()
    
    all_messages = db.read()
    all_sessesion_messages = [message for message in all_messages if message["session"] == session_id]
    recent_messages = all_sessesion_messages[:HISTORY_WINDOW]
    chronological_history = recent_messages[::-1]
    
    # other_messages = [message for message in all_messages if message["session"] != session_id]
    print(f"Đang Transcribe file: {audio_file_path}...")
    transcription = stt_model.transcribe(audio_file_path, language='vi')
    raw_text = transcription['text'].strip()
    print(f"Raw Text: {raw_text}")
    
    retrieved_context = retrieve_context_pairs(raw_text, all_messages, session_id)
    print(f"Retrieved Context:\n{retrieved_context}")
    
    retrieval_prompt = f"""
[KÝ ỨC DÀNH CHO VOI CON - KHÔNG ĐỌC RA CHO BẠN NHỎ]

Dưới đây là các đoạn hội thoại cũ có thể liên quan.
Voi Con chỉ dùng để hiểu rõ hơn về sở thích, kiến thức,
hoặc câu hỏi trước đây của bé.

- Không nhắc lại nguyên văn.
- Không nói "lần trước bé hỏi".
- Chỉ dùng nếu thật sự giúp trả lời tốt hơn.

{retrieved_context}
"""
    
    history_context_text = "LỊCH SỬ HỘI THOẠI:\n"
    for msg in chronological_history:
        role = "Bạn nhỏ" if msg['from'] == "user" else "Voi Con"
        content = msg['message']
        history_context_text += f"- {role}: {content}\n"
    
    print(f"--- Processing: {audio_file_path} | History Context Len: {len(chronological_history)} ---")

    try:
        with open(audio_file_path, "rb") as f:
            audio_data = f.read()

        output_schema = {
            "type": "OBJECT",
            "properties": {
                "transcribe": {
                    "type": "STRING", 
                    "description": "Nội dung chính xác người dùng nói (STT)"
                },
                "rep": {
                    "type": "STRING", 
                    "description": "Câu trả lời của Voi Con dành cho bé (TTS Script)"
                },
                "intent": {
                    "type": "STRING",
                    "description": "Phân loại ý định: 'question', 'command_stop', 'chitchat'"
                }
            },
            "required": ["transcribe", "rep"]
        }

        user_prompt = f"""
        {retrieval_prompt}
        
        {history_context_text}
        
        --- YÊU CẦU HIỆN TẠI ---
        (Người dùng vừa gửi đoạn ghi âm đính kèm).
        Hãy nghe, transcribe lại lời nói và trả lời bé dựa trên lịch sử hội thoại trên.
        """

        response = client.models.generate_content(
            model=MODEL_ID,
            contents=[
                user_prompt,
                types.Part.from_bytes(
                    data=audio_data,
                    mime_type="audio/webm"
                )
            ],
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
                response_schema=output_schema,
                temperature=0.7
            )
        )

        result = response.parsed
        print(f"Kết quả AI: {result}")
        
        new_user_msg = {
            "create_at": user_message_create_at,
            "message": result["transcribe"],
            "from": "user",
            "session": session_id
        }
        
        new_bot_msg = {
            "create_at": datetime.now().isoformat(),
            "message": result["rep"],
            "from": "bot",
            "session": session_id
        }
        
        db.write([new_bot_msg, new_user_msg] + all_messages)
        
        return new_user_msg, new_bot_msg

    except Exception as e:
        print(f"Lỗi xử lý AI: {e}")
        return None, {"message": "Voi con đang bị ốm, bạn đợi xíu nhé.", "from": "bot"}
    
