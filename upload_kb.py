import requests
import os

API_KEY = "cVptCg-JnuEqCEfhTze5jpeJyMnplX2UYcf1Pt7sHc4"
URL = "http://127.0.0.1:8001/kb/upload"
FILE_PATH = "/tmp/pricing_kb.md"

if not os.path.exists(FILE_PATH):
    print(f"File not found: {FILE_PATH}")
    exit(1)

print(f"Uploading {FILE_PATH} to Knowledge Base...")

with open(FILE_PATH, "rb") as f:
    files = [("files", (os.path.basename(FILE_PATH), f, "text/markdown"))]
    headers = {"x-api-key": API_KEY}
    
    response = requests.post(URL, headers=headers, files=files)

print(f"Status: {response.status_code}")
print(f"Response: {response.text}")
