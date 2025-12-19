import os
import json

class DB:
    def __init__(self, file_path, default=None):
        self.file_path = file_path
        self.default = default if default is not None else []

    def read(self):
        try:
            with open(self.file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return self.default

    def write(self, new_data):
        os.makedirs(os.path.dirname(self.file_path) or ".", exist_ok=True)
        tmp = self.file_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(new_data, f, indent=4, ensure_ascii=False)
        os.replace(tmp, self.file_path)
