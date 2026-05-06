import os
import re
from datetime import datetime, timedelta
from typing import List
from models import TranscriptSegment, ContextSuggestion

class AIContextAnalyzer:
    def __init__(self, user_name: str = "Pavan", role: str = "Business Unit Head"):
        self.user_name = user_name
        self.role = role
        # Assuming OpenAI key exists in environment
        self.api_key = os.getenv("OPENAI_API_KEY", "mock-key")
        
    async def analyze_context_window(self, recent_transcripts: List[TranscriptSegment]) -> ContextSuggestion | None:
        """
        Analyzes the last N transcripts to detect if the user was addressed or if
        their input is expected.
        """
        if not recent_transcripts:
            return None
            
        # 1. Prepare the context text
        conversation_block = "\n".join([f"{t.speaker}: {t.text}" for t in recent_transcripts])
        
        # 2. Build the Detection Prompt
        prompt = f"""
        You are an intelligent executive assistant for {self.user_name}, who is a {self.role}.
        Analyze the following recent meeting transcript.
        
        Transcript:
        {conversation_block}
        
        Rules:
        1. Determine if a question was directed at {self.user_name}, or if {self.user_name}'s input is needed.
        2. If YES: generate a concise, professional, business-oriented suggested response for {self.user_name} to say.
        3. If NO: return exactly the word "NONE".
        """
        
        # 3. Call LLM API (Mocked here since we don't have a real API key context)
        # In production:
        # response = await openai.ChatCompletion.acreate(...)
        
        detected = self._mock_llm_inference(conversation_block)
        
        if detected:
            return ContextSuggestion(
                meeting_id="ongoing",
                trigger_context=conversation_block[-100:], # Just saving the last part as trigger context
                suggested_response=detected
            )
            
        return None

    def _mock_llm_inference(self, conversation_block: str) -> str | None:
        """
        A heuristic mock to simulate LLM behavior.
        If the user's name is mentioned, or words like 'budget' or 'timeline', it triggers.
        """
        lower_block = conversation_block.lower()
        if self.user_name.lower() in lower_block:
            return f"Yes, I completely agree. Let's make sure we align on the next steps."
        if "budget" in lower_block:
            return f"Our Q3 budget allocation has already factored this in. I'll send over the figures after the call."
        if "timeline" in lower_block:
            return f"We are aiming to wrap this phase up by mid-next week if there are no blockers."
        return None

    def extract_action_item(self, text: str) -> dict | None:
        """
        Lightweight heuristic extractor until a real structured LLM extractor is integrated.
        Returns a task payload only when the statement appears to assign a task to the user.
        """
        normalized = text.strip()
        if not normalized:
            return None

        lower_text = normalized.lower()
        user_token = self.user_name.lower()
        assignment_markers = ["can you", "please", "you should", "you need to", "will you", "follow up", "send", "prepare", "share", "finalize"]
        has_user_reference = user_token in lower_text
        has_assignment_marker = any(marker in lower_text for marker in assignment_markers)

        if not (has_user_reference and has_assignment_marker):
            return None

        task_text = normalized
        for prefix in [f"{self.user_name},", f"{self.user_name}"]:
            if task_text.lower().startswith(prefix.lower()):
                task_text = task_text[len(prefix):].strip(" ,:-")
                break

        deadline = self._extract_deadline(normalized)

        return {
            "task": task_text,
            "assignee": self.user_name,
            "confidence": 0.65,
            "source_excerpt": normalized,
            "deadline": deadline,
        }

    def extract_requirement_item(self, text: str) -> dict | None:
        """
        Heuristic extractor for requirement statements discussed in meeting.
        Returns a requirement payload when requirement intent is detected.
        """
        normalized = text.strip()
        if not normalized:
            return None

        lower_text = normalized.lower()
        requirement_markers = [
            "requirement",
            "must have",
            "should have",
            "needs to",
            "need to support",
            "shall",
            "expected to",
            "acceptance criteria",
            "scope includes",
        ]

        if not any(marker in lower_text for marker in requirement_markers):
            return None

        requirement_text = normalized
        for prefix in [f"{self.user_name},", f"{self.user_name}"]:
            if requirement_text.lower().startswith(prefix.lower()):
                requirement_text = requirement_text[len(prefix):].strip(" ,:-")
                break

        return {
            "requirement": requirement_text,
            "confidence": 0.6,
            "source_excerpt": normalized,
        }

    def _extract_deadline(self, text: str) -> datetime | None:
        lower_text = text.lower()
        now = datetime.utcnow()
        weekday_map = {
            "monday": 0,
            "tuesday": 1,
            "wednesday": 2,
            "thursday": 3,
            "friday": 4,
            "saturday": 5,
            "sunday": 6,
        }
        time_match = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", lower_text)
        parsed_hour = None
        parsed_minute = 0
        if time_match:
            parsed_hour = int(time_match.group(1))
            parsed_minute = int(time_match.group(2) or "0")
            meridiem = time_match.group(3)
            if meridiem == "pm" and parsed_hour < 12:
                parsed_hour += 12
            if meridiem == "am" and parsed_hour == 12:
                parsed_hour = 0

        if "today" in lower_text:
            return now.replace(
                hour=parsed_hour if parsed_hour is not None else 18,
                minute=parsed_minute,
                second=0,
                microsecond=0,
            )
        if "tomorrow" in lower_text:
            tomorrow = now + timedelta(days=1)
            return tomorrow.replace(
                hour=parsed_hour if parsed_hour is not None else 18,
                minute=parsed_minute,
                second=0,
                microsecond=0,
            )
        if "next week" in lower_text:
            next_week = now + timedelta(days=7)
            return next_week.replace(
                hour=parsed_hour if parsed_hour is not None else 18,
                minute=parsed_minute,
                second=0,
                microsecond=0,
            )
        if "eod" in lower_text or "end of day" in lower_text:
            return now.replace(hour=18, minute=0, second=0, microsecond=0)

        weekday_match = re.search(r"\b(?:by|on|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", lower_text)
        if weekday_match:
            target_name = weekday_match.group(1)
            target_weekday = weekday_map[target_name]
            days_ahead = (target_weekday - now.weekday()) % 7
            is_explicit_next = "next " + target_name in lower_text
            if days_ahead == 0 or is_explicit_next:
                days_ahead += 7
            target_date = now + timedelta(days=days_ahead)
            return target_date.replace(
                hour=parsed_hour if parsed_hour is not None else 18,
                minute=parsed_minute,
                second=0,
                microsecond=0,
            )

        in_days_match = re.search(r"in\s+(\d+)\s+day", lower_text)
        if in_days_match:
            days = int(in_days_match.group(1))
            target = now + timedelta(days=days)
            return target.replace(
                hour=parsed_hour if parsed_hour is not None else 18,
                minute=parsed_minute,
                second=0,
                microsecond=0,
            )

        due_days_match = re.search(r"within\s+(\d+)\s+day", lower_text)
        if due_days_match:
            days = int(due_days_match.group(1))
            target = now + timedelta(days=days)
            return target.replace(
                hour=parsed_hour if parsed_hour is not None else 18,
                minute=parsed_minute,
                second=0,
                microsecond=0,
            )

        by_date_match = re.search(r"\bby\s+(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b", lower_text)
        if by_date_match:
            first = int(by_date_match.group(1))
            second = int(by_date_match.group(2))
            year_raw = by_date_match.group(3)
            year = now.year
            if year_raw:
                year = int(year_raw)
                if year < 100:
                    year += 2000
            # Interpret as day/month format (common in IST context), fallback to month/day.
            day = first
            month = second
            try:
                candidate = datetime(year, month, day)
            except ValueError:
                day = second
                month = first
                try:
                    candidate = datetime(year, month, day)
                except ValueError:
                    return None
            return candidate.replace(
                hour=parsed_hour if parsed_hour is not None else 18,
                minute=parsed_minute,
                second=0,
                microsecond=0,
            )

        return None
