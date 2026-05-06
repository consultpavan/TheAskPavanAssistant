from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

class TranscriptSegment(BaseModel):
    speaker: str
    text: str
    start_time: float
    end_time: float

class ActionItem(BaseModel):
    id: str
    task: str
    assignee: Optional[str] = None
    deadline: Optional[datetime] = None
    status: str = "pending" # pending, completed
    reminder_status: str = "active" # active, snoozed, dismissed
    snooze_until: Optional[datetime] = None

class Meeting(BaseModel):
    id: str
    title: str
    organizer: str = "Self" # Scheduled by me or others
    start_time: datetime = Field(default_factory=datetime.utcnow)
    end_time: Optional[datetime] = None
    participants: List[str] = []
    transcripts: List[TranscriptSegment] = []
    summary: Optional[str] = None
    action_items: List[ActionItem] = []
    status: str = "active" # active, completed

class MeetingCreate(BaseModel):
    title: str
    participants: List[str]

class ContextSuggestion(BaseModel):
    meeting_id: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    trigger_context: str
    suggested_response: str
