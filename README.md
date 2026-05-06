# The Ask Pavan Assistant

AI-assisted meeting companion for capturing live transcripts, extracting action items, tracking requirements, and reviewing meeting history.

This project contains:
- A `FastAPI` backend for meeting APIs, task management, project intelligence, and live transcription websocket events.
- A `React + TypeScript + Vite` frontend for dashboard, live meeting view, AI query experience, and historical meeting analytics.

## High-Level Architecture

### Backend (`backend/`)
- `main.py`: API entrypoint and route definitions.
- `transcription_socket.py`: websocket endpoint for live transcript streaming and task/requirement detection.
- `state.py`: in-memory runtime state for meetings/tasks.
- `database.py`: MongoDB connection helpers.
- `ai_context.py`: context analysis and extraction helpers.
- `project_intelligence.py` and `automation_engine.py`: project and engine intelligence features.
- `engine.properties`: local LLM engine settings (Ollama endpoint/model/timeout).

### Frontend (`frontend/`)
- `src/App.tsx`: main app UI and client-side logic.
- Connects to backend APIs on `http://localhost:8000`.
- Includes views for:
  - Home dashboard (tasks/reminders and AI chat)
  - Live meeting capture
  - Meeting history calendar and detail drill-down

## Core Features

- Start and end meetings from UI.
- Live microphone transcription through websocket.
- Automatic extraction of:
  - Action items
  - Requirements
- Manual reminder/task creation.
- Task filtering by project, priority, and type.
- Meeting finalization with MOM (Minutes of Meeting) bullet generation.
- Historical meeting analytics and calendar-based review.
- AI intelligence query endpoint for project/business queries.

## Prerequisites

### System
- Windows 10/11 (voice transcription path currently uses Windows SAPI COM APIs).
- Python 3.10+ recommended.
- Node.js 18+ and npm.
- MongoDB running locally (default: `mongodb://localhost:27017`).
- Optional: Ollama running locally for LLM-backed features.

### Python Packages
Install backend dependencies from `backend/requirements.txt`, plus Windows COM helpers used by transcription:
- `pywin32` (required for `win32com.client` / `pythoncom`)

## Setup

### 1) Clone repository
```bash
git clone https://github.com/consultpavan/TheAskPavanAssistant.git
cd TheAskPavanAssistant
```

### 2) Backend setup
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pip install pywin32
```

Create a `.env` file in `backend/` (optional, defaults shown):
```env
MONGODB_URL=mongodb://localhost:27017
DATABASE_NAME=meeting_assistant
```

Review `backend/engine.properties` if using Ollama:
```properties
ollama.base_url=http://localhost:11434
ollama.model=llama3
ollama.timeout_seconds=20
```

### 3) Frontend setup
Open a second terminal:
```bash
cd frontend
npm install
```

## Run the Application

### Start backend
From `backend/`:
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Backend health check:
- `GET http://localhost:8000/`

### Start frontend
From `frontend/`:
```bash
npm run dev
```

Open the URL shown by Vite (typically `http://localhost:5173`).

## API Overview

Key routes exposed by backend:
- `GET /api/v1/dashboard`
- `GET /api/v1/reminders`
- `POST /api/v1/meetings/start`
- `POST /api/v1/meetings/{meeting_id}/end`
- `POST /api/v1/meetings/{meeting_id}/finalize`
- `GET /api/v1/meetings/historical`
- `POST /api/v1/tasks/manual`
- `POST /api/v1/tasks/{task_id}/resolve`
- `POST /api/v1/tasks/{task_id}/snooze`
- `GET /api/v1/projects`
- `GET /api/v1/projects/{project_id}/insights`
- `POST /api/v1/intelligence/query`
- `GET /api/v1/engine/health`

Websocket:
- `WS /api/v1/ws/transcribe?meeting_id=<id>&user_name=<name>`

## Typical Workflow

1. Start backend and frontend.
2. Open app and click **Manual Start Conversation**.
3. Speak in meeting; transcript/events stream live.
4. Review detected tasks and requirements.
5. Click **Save Transcript + Tasks** to finalize.
6. View output in Home and Meeting History screens.

## Troubleshooting

- **`win32com` import errors**
  - Ensure `pip install pywin32` was run in active backend environment.

- **Mongo connection errors**
  - Confirm MongoDB is running and `.env` values are valid.

- **No transcript data**
  - Verify microphone permissions in browser/Electron context.
  - Confirm websocket connection reaches `ws://localhost:8000/api/v1/ws/transcribe`.

- **AI/intelligence responses are weak or unavailable**
  - Verify Ollama is running and matches `engine.properties` settings.

## Current Limitations

- Live transcription implementation is Windows-specific due to SAPI COM integration.
- CORS is currently permissive (`allow_origins=["*"]`) for local development.
- Some capabilities are stateful in-memory and complemented by Mongo persistence.

## Future Improvements

- Cross-platform speech pipeline abstraction.
- Production-grade auth and CORS policies.
- Dedicated test suite (backend + frontend).
- Containerized local development (`docker-compose`).

# TheAskPavanAssistant
