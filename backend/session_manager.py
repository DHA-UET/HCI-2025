import os
from database import DB

db_path = os.path.join(os.getcwd(), "data/db.json")
db = DB(db_path, [])

def get_all_session():
    sessions = list(set([m["session"] for m in db.read()]))
    print(sessions)
    return sessions


def get_session_by_id(session_id:int):
    all_messages = db.read()
    session_message = [m for m in all_messages if m["session"] == session_id]
    print(session_message)
    return session_message
