from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from datetime import datetime
from pydantic import BaseModel, Field
from database import connect_to_mongo, close_mongo_connection, get_database
from transcription_socket import router as transcription_router
from state import app_state
from automation_engine import engine, run_to_dict
from project_intelligence import project_intelligence_service

app = FastAPI(title="Meeting Assistant API")


class StartMeetingRequest(BaseModel):
    title: str = "Live Meeting"
    organizer: str = "Self"
    participants: list[str] = Field(default_factory=list)


class DashboardResponse(BaseModel):
    meetings: list[dict]
    reminders: list[dict]


class ManualTaskCreateRequest(BaseModel):
    task: str | None = None
    description: str | None = None
    assignee: str = "Pavan"
    requested_by: str | None = None
    deadline: str | None = None
    priority: str = "medium"
    category: str = "general"  # task type
    project_id: str | None = None
    tags: list[str] = Field(default_factory=list)
    meeting_id: str | None = None


class EngineRunCreateRequest(BaseModel):
    goal: str
    target_paths: list[str] = Field(default_factory=list)


class EngineChatRequest(BaseModel):
    message: str


class QueryIntelligenceRequest(BaseModel):
    query: str
    project_id: str | None = None


class FinalizeMeetingRequest(BaseModel):
    tasks: list[dict] = Field(default_factory=list)
    requirements: list[dict] = Field(default_factory=list)


def _serialize_document(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, list):
        return [_serialize_document(item) for item in value]
    if isinstance(value, dict):
        return {key: _serialize_document(item) for key, item in value.items()}
    return value


def _generate_mom_bullets(meeting: dict, tasks: list[dict], requirements: list[dict]) -> list[str]:
    bullets: list[str] = []
    title = str(meeting.get("title", "Meeting")).strip() or "Meeting"
    participants = meeting.get("participants") or []

    bullets.append(f"Meeting '{title}' concluded with {len(participants)} participant(s).")

    if requirements:
        top_requirements = [str(item.get("requirement", "")).strip() for item in requirements if str(item.get("requirement", "")).strip()]
        for req in top_requirements[:3]:
            bullets.append(f"Requirement discussed: {req}")

    if tasks:
        for task in tasks[:4]:
            task_text = str(task.get("task", "")).strip()
            assignee = str(task.get("assignee", "Pavan")).strip() or "Pavan"
            if task_text:
                bullets.append(f"Action item: {task_text} (Owner: {assignee})")
    else:
        bullets.append("No explicit action items were captured.")

    transcripts = meeting.get("transcripts") or []
    if transcripts:
        last_speaker = str(transcripts[-1].get("speaker", "Participant")).strip() or "Participant"
        bullets.append(f"Discussion closed after final inputs from {last_speaker}.")

    return bullets

# Configure CORS for the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict to electron frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_db_client():
    await connect_to_mongo()

@app.on_event("shutdown")
async def shutdown_db_client():
    await close_mongo_connection()

@app.get("/")
def read_root():
    return {"message": "Meeting Assistant API is running"}

# --- Executive Features APIs ---

@app.get("/api/v1/reminders")
async def get_reminders(user_name: str = "Pavan"):
    reminders = app_state.tasks_for_user(user_name=user_name, only_pending=True)
    return {"reminders": reminders}

@app.get("/api/v1/meetings/historical")
async def get_historical_meetings():
    return {"meetings": app_state.historical_meetings()}


@app.post("/api/v1/meetings/start")
async def start_meeting(payload: StartMeetingRequest):
    meeting = app_state.start_meeting(
        title=payload.title,
        organizer=payload.organizer,
        participants=payload.participants,
    )
    return {"meeting": meeting}


@app.post("/api/v1/meetings/{meeting_id}/end")
async def end_meeting(meeting_id: str):
    meeting = app_state.end_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return {"meeting": meeting}


@app.get("/api/v1/meetings/{meeting_id}")
async def get_meeting(meeting_id: str):
    meeting = app_state.meetings.get(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    tasks = app_state.tasks_for_meeting(meeting_id)
    return {"meeting": meeting, "tasks": tasks}


@app.get("/api/v1/dashboard", response_model=DashboardResponse)
async def get_dashboard(user_name: str = "Pavan"):
    meetings = app_state.meetings_with_tasks_for_user(user_name, only_pending=False)
    reminders = app_state.tasks_for_user(user_name=user_name, only_pending=True, sorted_for_dashboard=True)
    return {"meetings": meetings, "reminders": reminders}


@app.post("/api/v1/tasks/{task_id}/resolve")
async def resolve_task(task_id: str):
    task = app_state.resolve_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"task": task}


@app.post("/api/v1/tasks/{task_id}/snooze")
async def snooze_task(task_id: str, hours: int = 24):
    task = app_state.snooze_task(task_id=task_id, hours=hours)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"task": task}


@app.post("/api/v1/tasks/manual")
async def create_manual_task(payload: ManualTaskCreateRequest):
    deadline_value = None
    if payload.deadline:
        try:
            deadline_value = datetime.fromisoformat(payload.deadline.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid deadline format")

    task_text = (payload.description or payload.task or "").strip()
    if not task_text:
        raise HTTPException(status_code=400, detail="Task description is required")

    task = app_state.create_task(
        meeting_id=payload.meeting_id,
        task_text=task_text,
        assignee=payload.assignee,
        source_excerpt=f"Manual reminder created by {payload.assignee}",
        confidence=1.0,
        deadline=deadline_value,
        priority=payload.priority.lower(),
        category=payload.category.strip().lower() or "general",
    )
    if not task:
        raise HTTPException(status_code=404, detail="Meeting not found for provided meeting_id")
    if task:
        task["project_id"] = (payload.project_id or "").strip().lower() or "all"
        task["tags"] = [tag.strip().lower() for tag in payload.tags if str(tag).strip()]
        task["requested_by"] = (payload.requested_by or payload.assignee).strip()

        db = get_database()
        await db.tasks.insert_one(_serialize_document(task))
    return {"task": task}

@app.post("/api/v1/meetings/{meeting_id}/catch-up")
async def request_catch_up(meeting_id: str):
    # This route would call the AIContextAnalyzer on the last 5 minutes of transcripts
    return {"summary": "Mock summary of the last 5 minutes: Discussed Q2 budget and HR policies."}


@app.post("/api/v1/meetings/{meeting_id}/finalize")
async def finalize_meeting(meeting_id: str, payload: FinalizeMeetingRequest):
    if meeting_id not in app_state.meetings:
        raise HTTPException(status_code=404, detail="Meeting not found")

    created = []
    db = get_database()
    for task in payload.tasks:
        text = str(task.get("task", "")).strip()
        if not text:
            continue
        created_task = app_state.create_task(
            meeting_id=meeting_id,
            task_text=text,
            assignee=str(task.get("assignee", "Pavan")).strip() or "Pavan",
            source_excerpt=str(task.get("source_excerpt", text)),
            confidence=float(task.get("confidence", 0.7)),
            priority=str(task.get("priority", "medium")).lower(),
            category=str(task.get("category", "meeting")).lower(),
        )
        if created_task:
            created_task["project_id"] = str(task.get("project_id", "all")).strip().lower() or "all"
            created_task["task_type"] = str(task.get("task_type", created_task.get("category", "meeting"))).strip().lower()
            created_task["requested_by"] = str(task.get("requested_by", "meeting")).strip()
            created_task["tags"] = [str(tag).strip().lower() for tag in task.get("tags", []) if str(tag).strip()]
            created.append(created_task)
            await db.tasks.insert_one(_serialize_document(created_task))

    meeting = app_state.meetings.get(meeting_id)
    if meeting:
        sanitized_requirements: list[dict] = []
        for requirement in payload.requirements:
            req_text = str(requirement.get("requirement", "")).strip()
            if not req_text:
                continue
            sanitized_requirements.append({
                "requirement": req_text,
                "source_excerpt": str(requirement.get("source_excerpt", req_text)),
                "confidence": float(requirement.get("confidence", 0.6)),
            })

        meeting["requirements"] = sanitized_requirements
        meeting["mom_points"] = _generate_mom_bullets(meeting, created, sanitized_requirements)

        await db.meetings.update_one(
            {"id": meeting_id},
            {"$set": _serialize_document(meeting)},
            upsert=True,
        )

    return {
        "created_tasks": created,
        "count": len(created),
        "requirements": meeting.get("requirements", []) if meeting else [],
        "mom_points": meeting.get("mom_points", []) if meeting else [],
    }


@app.get("/api/v1/projects")
async def get_projects():
    return {"projects": project_intelligence_service.list_projects()}


@app.get("/api/v1/projects/{project_id}/insights")
async def get_project_insights(project_id: str):
    data = project_intelligence_service.project_insights(project_id)
    if data.get("error"):
        raise HTTPException(status_code=404, detail=data["error"])
    return data


@app.post("/api/v1/intelligence/query")
async def query_intelligence(payload: QueryIntelligenceRequest):
    if not payload.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    return project_intelligence_service.answer_query(
        query=payload.query.strip(),
        project_id=payload.project_id,
    )


@app.post("/api/v1/engine/runs")
async def create_engine_run(payload: EngineRunCreateRequest):
    run = engine.start_run(goal=payload.goal.strip(), target_paths=payload.target_paths)
    return {"run": run_to_dict(run)}


@app.post("/api/v1/engine/runs/{run_id}/execute")
async def execute_engine_run(run_id: str):
    run = engine.execute_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return {"run": run_to_dict(run)}


@app.post("/api/v1/engine/runs/{run_id}/chat")
async def chat_refine_engine_run(run_id: str, payload: EngineChatRequest):
    run = engine.chat_refine(run_id=run_id, user_message=payload.message)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return {"run": run_to_dict(run)}


@app.get("/api/v1/engine/runs")
async def list_engine_runs():
    return {"runs": [run_to_dict(run) for run in engine.list_runs()]}


@app.get("/api/v1/engine/runs/{run_id}")
async def get_engine_run(run_id: str):
    run = engine.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return {"run": run_to_dict(run)}


@app.get("/api/v1/engine/health")
async def get_engine_health():
    return {"health": engine.health()}

# -------------------------------

app.include_router(transcription_router, prefix="/api/v1")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
