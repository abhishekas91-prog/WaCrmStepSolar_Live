"""
AI Service Module - Multi-provider AI integration for WhatsApp CRM
Priority: Meta AI > Gemini > Groq > OpenAI > Anthropic
"""

import os
import json
import logging
from typing import Optional, Dict, Any
from datetime import datetime
import anthropic
import google.generativeai as genai
from openai import OpenAI
import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

class AIService:
    """Multi-provider AI service with fallback mechanism"""
    
    def __init__(self):
        """Initialize AI service with all available providers"""
        self.meta_ai_key = os.getenv("META_AI_API_KEY")
        self.gemini_key = os.getenv("GEMINI_API_KEY")
        self.groq_key = os.getenv("GROQ_API_KEY")
        self.openai_key = os.getenv("OPENAI_API_KEY")
        self.anthropic_key = os.getenv("ANTHROPIC_API_KEY")
        
        # Initialize API clients
        if self.openai_key:
            self.openai_client = OpenAI(api_key=self.openai_key)
        
        if self.anthropic_key:
            self.anthropic_client = anthropic.Anthropic(api_key=self.anthropic_key)
        
        if self.gemini_key:
            genai.configure(api_key=self.gemini_key)
        
        self.request_timeout = int(os.getenv("AI_REQUEST_TIMEOUT_MS", 30000)) / 1000
        self.model_name = None
        self.provider_used = None
    
    def get_reply(self, customer_message: str, faq_context: str = "", conversation_history: list = None) -> Optional[str]:
        """
        Get AI reply using provider priority: Meta AI > Gemini > Groq > OpenAI > Anthropic
        
        Args:
            customer_message: The customer's message
            faq_context: FAQ/knowledge base context
            conversation_history: Previous messages in conversation
        
        Returns:
            AI-generated reply or None if all providers fail
        """
        
        # Build system prompt with FAQ context
        system_prompt = self._build_system_prompt(faq_context)
        
        # Build messages with conversation history
        messages = self._build_messages(customer_message, conversation_history)
        
        # Try providers in priority order
        providers = [
            ("Meta AI", self._try_meta_ai),
            ("Gemini", self._try_gemini),
            ("Groq", self._try_groq),
            ("OpenAI", self._try_openai),
            ("Anthropic", self._try_anthropic),
        ]
        
        for provider_name, provider_func in providers:
            try:
                logger.info(f"Attempting to get reply from {provider_name}")
                reply = provider_func(system_prompt, messages)
                if reply:
                    self.provider_used = provider_name
                    logger.info(f"Successfully got reply from {provider_name}")
                    return reply
            except Exception as e:
                logger.warning(f"{provider_name} failed: {str(e)}")
                continue
        
        logger.error("All AI providers failed")
        return None
    
    def _build_system_prompt(self, faq_context: str) -> str:
        """Build system prompt with FAQ context"""
        base_prompt = """You are a helpful customer service AI assistant for a solar company called StepSolar.
Your role is to:
1. Answer customer questions about solar energy, products, and services
2. Be professional, friendly, and concise
3. Keep responses under 150 words
4. Provide accurate information based on FAQ/knowledge base
5. Escalate complex issues by suggesting human agent contact
6. If you don't know something, admit it and suggest they contact support"""
        
        if faq_context:
            return f"""{base_prompt}

KNOWLEDGE BASE:
{faq_context}

Always prefer answering from the knowledge base above."""
        
        return base_prompt
    
    def _build_messages(self, customer_message: str, conversation_history: list = None) -> list:
        """Build message array with conversation history"""
        messages = []
        
        if conversation_history:
            for msg in conversation_history[-10:]:  # Last 10 messages for context
                messages.append({
                    "role": "user" if msg.get("sender") == "customer" else "assistant",
                    "content": msg.get("text", "")
                })
        
        messages.append({
            "role": "user",
            "content": customer_message
        })
        
        return messages
    
    def _try_meta_ai(self, system_prompt: str, messages: list) -> Optional[str]:
        """Try Meta AI (Llama) via Meta's API"""
        if not self.meta_ai_key:
            return None
        
        try:
            # Meta AI endpoint - using conversational API
            url = "https://api.meta.ai/v1/messages"
            headers = {
                "Authorization": f"Bearer {self.meta_ai_key}",
                "Content-Type": "application/json"
            }
            
            payload = {
                "model": "llama-2-70b-chat",
                "messages": messages,
                "system": system_prompt,
                "max_tokens": 256,
                "temperature": 0.7
            }
            
            response = requests.post(
                url,
                json=payload,
                headers=headers,
                timeout=self.request_timeout
            )
            response.raise_for_status()
            
            data = response.json()
            return data.get("choices", [{}])[0].get("message", {}).get("content")
        
        except Exception as e:
            logger.error(f"Meta AI error: {str(e)}")
            return None
    
    def _try_gemini(self, system_prompt: str, messages: list) -> Optional[str]:
        """Try Google Gemini"""
        if not self.gemini_key:
            return None
        
        try:
            model = genai.GenerativeModel('gemini-pro')
            
            # Format messages for Gemini
            formatted_messages = [
                f"{system_prompt}\n\n---\n\n"
            ]
            
            for msg in messages:
                role = "User" if msg["role"] == "user" else "Assistant"
                formatted_messages.append(f"{role}: {msg['content']}")
            
            response = model.generate_content(
                "\n".join(formatted_messages),
                generation_config=genai.types.GenerationConfig(
                    max_output_tokens=256,
                    temperature=0.7
                )
            )
            
            return response.text if response else None
        
        except Exception as e:
            logger.error(f"Gemini error: {str(e)}")
            return None
    
    def _try_groq(self, system_prompt: str, messages: list) -> Optional[str]:
        """Try Groq API"""
        if not self.groq_key:
            return None
        
        try:
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {self.groq_key}",
                "Content-Type": "application/json"
            }
            
            payload = {
                "model": "mixtral-8x7b-32768",
                "messages": [{"role": "system", "content": system_prompt}] + messages,
                "max_tokens": 256,
                "temperature": 0.7
            }
            
            response = requests.post(
                url,
                json=payload,
                headers=headers,
                timeout=self.request_timeout
            )
            response.raise_for_status()
            
            data = response.json()
            return data.get("choices", [{}])[0].get("message", {}).get("content")
        
        except Exception as e:
            logger.error(f"Groq error: {str(e)}")
            return None
    
    def _try_openai(self, system_prompt: str, messages: list) -> Optional[str]:
        """Try OpenAI GPT"""
        if not self.openai_key:
            return None
        
        try:
            response = self.openai_client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[{"role": "system", "content": system_prompt}] + messages,
                max_tokens=256,
                temperature=0.7,
                timeout=self.request_timeout
            )
            
            return response.choices[0].message.content if response.choices else None
        
        except Exception as e:
            logger.error(f"OpenAI error: {str(e)}")
            return None
    
    def _try_anthropic(self, system_prompt: str, messages: list) -> Optional[str]:
        """Try Anthropic Claude"""
        if not self.anthropic_key:
            return None
        
        try:
            response = self.anthropic_client.messages.create(
                model="claude-3-sonnet-20240229",
                max_tokens=256,
                system=system_prompt,
                messages=messages,
                timeout=self.request_timeout
            )
            
            return response.content[0].text if response.content else None
        
        except Exception as e:
            logger.error(f"Anthropic error: {str(e)}")
            return None
    
    def get_provider_info(self) -> Dict[str, Any]:
        """Get information about available providers"""
        return {
            "provider_used": self.provider_used,
            "available_providers": {
                "meta_ai": bool(self.meta_ai_key),
                "gemini": bool(self.gemini_key),
                "groq": bool(self.groq_key),
                "openai": bool(self.openai_key),
                "anthropic": bool(self.anthropic_key),
            }
        }
