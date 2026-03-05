import urllib.request
import json
import ssl

url = "http://localhost:8000/auth/register"
data = {
    "id": "test-tenant",
    "name": "Test Tenant",
    "email": "test@example.com",
    "password": "password"
}

req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'))
req.add_header('Content-Type', 'application/json')

try:
    with urllib.request.urlopen(req) as response:
        result = response.read()
        print(result.decode('utf-8'))
except urllib.error.HTTPError as e:
    error_message = e.read()
    print(f"HTTPError: {e.code} - {error_message.decode('utf-8')}")
except Exception as e:
    print(str(e))
