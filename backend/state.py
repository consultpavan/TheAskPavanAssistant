from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4


class AppState:
    def __init__(self) -> None:
        self.meetings: dict[str, dict[str, Any]] = {}
        self.tasks: dict[str, dict[str, Any]] = {}

    def start_meeting(self, title: str, organizer: str, participants: list[str]) -> dict[str, Any]:
        meeting_id = str(uuid4())
        meeting = {
            "id": meeting_id,
            "title": title.strip() or "Untitled Meeting",
            "organizer": organizer.strip() or "Self",
            "participants": participants,
            "start_time": datetime.utcnow(),
            "end_time": None,
            "status": "active",
            "transcripts": [],
            "action_item_ids": [],
        }
        self.meetings[meeting_id] = meeting
        return meeting

    def end_meeting(self, meeting_id: str) -> dict[str, Any] | None:
        meeting = self.meetings.get(meeting_id)
        if not meeting:
            return None
        meeting["status"] = "completed"
        meeting["end_time"] = datetime.utcnow()
        return meeting

    def append_transcript(self, meeting_id: str, segment: dict[str, Any]) -> None:
        meeting = self.meetings.get(meeting_id)
        if not meeting:
            return
        meeting["transcripts"].append(segment)

    def create_task(
        self,
        meeting_id: str | None,
        task_text: str,
        assignee: str,
        source_excerpt: str,
        confidence: float = 0.5,
        deadline: datetime | None = None,
        priority: str = "medium",
        category: str = "general",
    ) -> dict[str, Any] | None:
        meeting = self.meetings.get(meeting_id) if meeting_id else None
        if meeting_id and not meeting:
            return None
        task_id = str(uuid4())
        task = {
            "id": task_id,
            "meeting_id": meeting_id,
            "task": task_text,
            "assignee": assignee,
            "status": "pending",
            "reminder_status": "active",
            "snooze_until": None,
            "deadline": deadline,
            "priority": priority,
            "category": category,
            "created_at": datetime.utcnow(),
            "source_excerpt": source_excerpt,
            "confidence": confidence,
            "source": "auto" if meeting_id else "manual",
        }
        self.tasks[task_id] = task
        if meeting:
            meeting["action_item_ids"].append(task_id)
        return task

    def resolve_task(self, task_id: str) -> dict[str, Any] | None:
        task = self.tasks.get(task_id)
        if not task:
            return None
        task["status"] = "completed"
        task["reminder_status"] = "dismissed"
        return task

    def snooze_task(self, task_id: str, hours: int = 24) -> dict[str, Any] | None:
        task = self.tasks.get(task_id)
        if not task:
            return None
        task["reminder_status"] = "snoozed"
        task["snooze_until"] = datetime.utcnow() + timedelta(hours=hours)
        return task

    def tasks_for_meeting(self, meeting_id: str) -> list[dict[str, Any]]:
        return [task for task in self.tasks.values() if task["meeting_id"] == meeting_id]

    def tasks_for_user(
        self,
        user_name: str,
        only_pending: bool = True,
        sorted_for_dashboard: bool = False,
    ) -> list[dict[str, Any]]:
        name = user_name.strip().lower()
        tasks = [task for task in self.tasks.values() if task["assignee"].strip().lower() == name]
        if only_pending:
            tasks = [task for task in tasks if task["status"] == "pending"]
        if not sorted_for_dashboard:
            return sorted(tasks, key=lambda t: t["created_at"], reverse=True)

        priority_weight = {"high": 0, "medium": 1, "low": 2}
        return sorted(
            tasks,
            key=lambda task: (
                priority_weight.get(str(task.get("priority", "medium")).lower(), 3),
                task.get("deadline") is None,
                task.get("deadline") or datetime.max,
                -task["created_at"].timestamp(),
            ),
        )

    def meetings_with_tasks_for_user(self, user_name: str, only_pending: bool = False) -> list[dict[str, Any]]:
        tasks = self.tasks_for_user(user_name, only_pending=only_pending)
        meeting_ids = {task["meeting_id"] for task in tasks if task.get("meeting_id")}
        meetings = [self.meetings[m_id] for m_id in meeting_ids if m_id in self.meetings]
        return sorted(meetings, key=lambda meeting: meeting["start_time"], reverse=True)

    def historical_meetings(self) -> list[dict[str, Any]]:
        return sorted(self.meetings.values(), key=lambda m: m["start_time"], reverse=True)


app_state = AppState()
