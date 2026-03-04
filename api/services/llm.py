from openai import OpenAI
import os

# Cả DeepSeek lẫn OpenAI đều dùng OpenAI-compatible SDK
def get_client(provider: str) -> tuple[OpenAI, str]:
    if provider == "deepseek":
        return OpenAI(
            api_key=os.getenv("DEEPSEEK_API_KEY"),
            base_url="https://api.deepseek.com"
        ), "deepseek-chat"
    else:
        return OpenAI(api_key=os.getenv("OPENAI_API_KEY")), "gpt-4o-mini"

def stream_chat(provider: str, model: str, messages: list, system: str):
    client, default_model = get_client(provider)
    full_messages = [{"role": "system", "content": system}, *messages]

    stream = client.chat.completions.create(
        model=model or default_model,
        messages=full_messages,
        stream=True,
        max_tokens=1000
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta