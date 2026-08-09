# Here are your Instructions

# WaCrmStepSolar - Multi AI Integration

Priority: Meta AI > Gemini > Groq > OpenAI > Anthropic

## Setup
1. pip install requests python-dotenv
2. Copy.env.example to.env and add keys
3. Import AIService in your webhook

## Usage
from ai_service import AIService
ai = AIService()
reply = ai.get_reply(customer_msg, "Your FAQ here")
