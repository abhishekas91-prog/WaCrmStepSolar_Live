import os
import requests

class AIService:
    def __init__(self):
        # Priority: Meta > Gemini > Groq > OpenAI > Anthropic
        self.meta_key = os.getenv("META_AI_API_KEY")
        self.gemini_key = os.getenv("GEMINI_API_KEY")
        self.groq_key = os.getenv("GROQ_API_KEY")
        self.openai_key = os.getenv("OPENAI_API_KEY")
        self.anthropic_key = os.getenv("ANTHROPIC_API_KEY")

    def get_reply(self, user_message, knowledge_base=""):
        system_prompt = f"""
        Tum ek WhatsApp Business assistant ho. Jawab short, polite aur Hindi me do.
        Company info: {knowledge_base}
        Agar na pata ho to bolo: "Main team se confirm karke batata hun"
        """

        if self.meta_key:
            try: return self._call_meta(user_message, system_prompt)
            except Exception as e: print("Meta AI failed:", e)
        if self.gemini_key:
            try: return self._call_gemini(user_message, system_prompt)
            except Exception as e: print("Gemini failed:", e)
        if self.groq_key:
            try: return self._call_groq(user_message, system_prompt)
            except Exception as e: print("Groq failed:", e)
        if self.openai_key:
            try: return self._call_openai(user_message, system_prompt)
            except Exception as e: print("OpenAI failed:", e)
        if self.anthropic_key:
            try: return self._call_anthropic(user_message, system_prompt)
            except Exception as e: print("Anthropic failed:", e)

        return "Sorry, abhi AI service available nahi hai."

    def _call_meta(self, msg, system):
        url = "https://graph.facebook.com/v20.0/meta_ai_endpoint"
        headers = {"Authorization": f"Bearer {self.meta_key}"}
        payload = {"messages": [{"role":"system","content":system},{"role":"user","content":msg}]}
        res = requests.post(url, json=payload, headers=headers, timeout=30)
        return res.json()["choices"][0]["message"]["content"]

    def _call_gemini(self, msg, system):
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={self.gemini_key}"
        payload = {"contents": [{"parts":[{"text": f"{system}\n\nUser: {msg}"}]}]}
        res = requests.post(url, json=payload, timeout=30)
        return res.json()["candidates"][0]["content"]["parts"][0]["text"]

    def _call_groq(self, msg, system):
        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {"Authorization": f"Bearer {self.groq_key}"}
        payload = {"model": "llama-3.1-70b-versatile", "messages": [{"role":"system","content":system},{"role":"user","content":msg}]}
        res = requests.post(url, json=payload, headers=headers, timeout=30)
        return res.json()["choices"][0]["message"]["content"]

    def _call_openai(self, msg, system):
        url = "https://api.openai.com/v1/chat/completions"
        headers = {"Authorization": f"Bearer {self.openai_key}"}
        payload = {"model": "gpt-4o-mini", "messages": [{"role":"system","content":system},{"role":"user","content":msg}]}
        res = requests.post(url, json=payload, headers=headers, timeout=30)
        return res.json()["choices"][0]["message"]["content"]

    def _call_anthropic(self, msg, system):
        url = "https://api.anthropic.com/v1/messages"
        headers = {"x-api-key": self.anthropic_key, "anthropic-version": "2023-06-01"}
        payload = {"model": "claude-3-haiku-20240307", "max_tokens": 500, "system": system, "messages": [{"role":"user","content":msg}]}
        res = requests.post(url, json=payload, headers=headers, timeout=30)
        return res.json()["content"][0]["text"]
