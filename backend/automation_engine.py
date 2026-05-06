from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4
import httpx


@dataclass
class EngineRun:
    id: str
    goal: str
    target_paths: list[str]
    status: str
    created_at: datetime
    updated_at: datetime
    plan: list[str] = field(default_factory=list)
    execution_notes: list[str] = field(default_factory=list)
    chat_history: list[dict[str, str]] = field(default_factory=list)
    learned_patterns: list[str] = field(default_factory=list)


class LLMWorker:
    """
    Ollama-backed worker with deterministic fallback behavior.
    """
    def __init__(self) -> None:
        config = self._load_properties()
        self.ollama_base_url = config.get("ollama.base_url", "http://localhost:11434").rstrip("/")
        self.ollama_model = config.get("ollama.model", "llama3")
        timeout_raw = config.get("ollama.timeout_seconds", "20")
        try:
            self.timeout_seconds = float(timeout_raw)
        except ValueError:
            self.timeout_seconds = 20.0

    def _load_properties(self) -> dict[str, str]:
        config_path = Path(__file__).parent / "engine.properties"
        if not config_path.exists():
            return {}
        values: dict[str, str] = {}
        for line in config_path.read_text(encoding="utf-8").splitlines():
            clean = line.strip()
            if not clean or clean.startswith("#") or "=" not in clean:
                continue
            key, value = clean.split("=", 1)
            values[key.strip()] = value.strip()
        return values

    def _ask_ollama(self, prompt: str) -> str | None:
        payload = {
            "model": self.ollama_model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.2,
            },
        }
        try:
            with httpx.Client(timeout=self.timeout_seconds) as client:
                response = client.post(f"{self.ollama_base_url}/api/generate", json=payload)
                response.raise_for_status()
                body = response.json()
                text = str(body.get("response", "")).strip()
                return text or None
        except Exception:
            return None

    def health(self) -> dict[str, Any]:
        try:
            with httpx.Client(timeout=self.timeout_seconds) as client:
                tags_response = client.get(f"{self.ollama_base_url}/api/tags")
                tags_response.raise_for_status()
                tags_body = tags_response.json()
                models = tags_body.get("models", [])
                model_names = [model.get("name", "") for model in models]
                selected_available = any(name.startswith(self.ollama_model) for name in model_names)
                return {
                    "ok": True,
                    "base_url": self.ollama_base_url,
                    "selected_model": self.ollama_model,
                    "selected_model_available": selected_available,
                    "available_models": model_names,
                }
        except Exception as exc:
            return {
                "ok": False,
                "base_url": self.ollama_base_url,
                "selected_model": self.ollama_model,
                "error": str(exc),
            }

    def _lines_from_response(self, raw: str, max_lines: int = 8) -> list[str]:
        lines: list[str] = []
        for line in raw.splitlines():
            cleaned = line.strip().lstrip("-*0123456789. ").strip()
            if cleaned:
                lines.append(cleaned)
            if len(lines) >= max_lines:
                break
        return lines

    def build_plan(self, goal: str, target_paths: list[str], prior_patterns: list[str]) -> list[str]:
        prompt = (
            "You are a software task planner. "
            "Create a concise execution plan as 4-7 bullet points, one action per line.\n"
            f"Goal: {goal}\n"
            f"Target paths: {', '.join(target_paths) if target_paths else 'none'}\n"
            f"Prior patterns: {', '.join(prior_patterns) if prior_patterns else 'none'}\n"
            "Return only bullet lines."
        )
        llm_response = self._ask_ollama(prompt)
        llm_plan = self._lines_from_response(llm_response) if llm_response else []
        if llm_plan:
            return llm_plan

        plan = [
            f"Analyze {len(target_paths)} path(s) for task context",
            "Generate concrete implementation changes",
            "Apply and verify with tests/lint/build",
            "Summarize output and pending risks",
        ]
        if prior_patterns:
            plan.insert(1, f"Reuse {len(prior_patterns)} prior successful pattern(s)")
        if "test" in goal.lower():
            plan.append("Add or update automated tests")
        return plan

    def refine_plan(self, run: EngineRun, user_message: str) -> list[str]:
        prompt = (
            "You are refining an implementation plan. "
            "Return only additional/updated steps as bullets.\n"
            f"Original goal: {run.goal}\n"
            f"Current plan: {' | '.join(run.plan)}\n"
            f"User refinement: {user_message}\n"
        )
        llm_response = self._ask_ollama(prompt)
        refinement_steps = self._lines_from_response(llm_response, max_lines=5) if llm_response else []
        if refinement_steps:
            return [*run.plan, *refinement_steps]
        update = f"Incorporate user refinement: {user_message.strip()}"
        return [*run.plan, update]

    def summarize_execution(self, run: EngineRun) -> tuple[list[str], list[str]]:
        prompt = (
            "You are summarizing an automation run.\n"
            f"Goal: {run.goal}\n"
            f"Plan: {' | '.join(run.plan)}\n"
            "Return exactly two sections as plain bullets:\n"
            "Execution notes:\n"
            "Learned patterns:\n"
        )
        llm_response = self._ask_ollama(prompt)
        if llm_response:
            lines = [line.strip() for line in llm_response.splitlines() if line.strip()]
            notes: list[str] = []
            patterns: list[str] = []
            target = notes
            for line in lines:
                lower = line.lower()
                if "learned patterns" in lower:
                    target = patterns
                    continue
                if "execution notes" in lower:
                    target = notes
                    continue
                cleaned = line.lstrip("-*0123456789. ").strip()
                if cleaned:
                    target.append(cleaned)
            if notes or patterns:
                return notes[:5] or ["Execution summary generated by model"], patterns[:5] or ["Capture reusable run patterns"]

        return (
            [
                "Execution pipeline initialized",
                "Planner output prepared for worker execution",
                "Verification step placeholder completed",
            ],
            [
                f"Prefer phased rollout for goal: {run.goal[:80]}",
                "Run lint/build checks after each patch batch",
            ],
        )


class AutomationEngine:
    def __init__(self) -> None:
        self.runs: dict[str, EngineRun] = {}
        self.worker = LLMWorker()

    def _validate_paths(self, raw_paths: list[str]) -> list[str]:
        cleaned: list[str] = []
        for raw in raw_paths:
            p = raw.strip()
            if not p:
                continue
            cleaned.append(str(Path(p)))
        return cleaned

    def _retrieve_learning(self, goal: str) -> list[str]:
        goal_tokens = set(goal.lower().split())
        patterns: list[str] = []
        for run in self.runs.values():
            if run.status != "completed":
                continue
            overlap = goal_tokens.intersection(set(run.goal.lower().split()))
            if overlap:
                patterns.extend(run.learned_patterns[:2])
        return patterns[:5]

    def start_run(self, goal: str, target_paths: list[str]) -> EngineRun:
        run_id = str(uuid4())
        now = datetime.utcnow()
        normalized_paths = self._validate_paths(target_paths)
        prior_patterns = self._retrieve_learning(goal)
        plan = self.worker.build_plan(goal=goal, target_paths=normalized_paths, prior_patterns=prior_patterns)
        run = EngineRun(
            id=run_id,
            goal=goal,
            target_paths=normalized_paths,
            status="planned",
            created_at=now,
            updated_at=now,
            plan=plan,
            learned_patterns=prior_patterns,
        )
        self.runs[run_id] = run
        return run

    def execute_run(self, run_id: str) -> EngineRun | None:
        run = self.runs.get(run_id)
        if not run:
            return None
        run.status = "completed"
        run.execution_notes, run.learned_patterns = self.worker.summarize_execution(run)
        run.updated_at = datetime.utcnow()
        return run

    def chat_refine(self, run_id: str, user_message: str) -> EngineRun | None:
        run = self.runs.get(run_id)
        if not run:
            return None
        run.chat_history.append({"role": "user", "message": user_message})
        run.plan = self.worker.refine_plan(run=run, user_message=user_message)
        run.status = "refined"
        run.updated_at = datetime.utcnow()
        return run

    def get_run(self, run_id: str) -> EngineRun | None:
        return self.runs.get(run_id)

    def list_runs(self) -> list[EngineRun]:
        return sorted(self.runs.values(), key=lambda run: run.created_at, reverse=True)

    def health(self) -> dict[str, Any]:
        return self.worker.health()


engine = AutomationEngine()


def run_to_dict(run: EngineRun) -> dict[str, Any]:
    return {
        "id": run.id,
        "goal": run.goal,
        "target_paths": run.target_paths,
        "status": run.status,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
        "plan": run.plan,
        "execution_notes": run.execution_notes,
        "chat_history": run.chat_history,
        "learned_patterns": run.learned_patterns,
    }
