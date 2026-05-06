import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

interface Transcript {
  text: string;
  speaker: string;
}

interface ActionItem {
  id?: string;
  task: string;
  assignee: string;
  priority?: string;
  category?: string;
  project_id?: string;
  task_type?: string;
  requested_by?: string;
  tags?: string[];
  deadline?: string | null;
  status?: string;
}

interface RequirementItem {
  requirement: string;
  source_excerpt?: string;
  confidence?: number;
}

interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  available: boolean;
}

interface MeetingSummary {
  id: string;
  title: string;
  start_time?: string;
  end_time?: string | null;
  status?: string;
  participants?: string[];
}

interface MeetingDetailsResponse {
  meeting: {
    id: string;
    title: string;
    start_time?: string;
    end_time?: string | null;
    status?: string;
    participants?: string[];
    mom_points?: string[];
    requirements?: RequirementItem[];
  };
  tasks: ActionItem[];
}

function App() {
  const userName = "Pavan";
  const [view, setView] = useState<"home" | "meeting" | "history">("home");
  const [homeMode, setHomeMode] = useState<"placeholder" | "tasks" | "chat">("placeholder");
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("all");
  const [items, setItems] = useState<ActionItem[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [taskTypeFilter, setTaskTypeFilter] = useState("all");
  const [queryInput, setQueryInput] = useState("");
  const [responses, setResponses] = useState<string[]>([]);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskForm, setTaskForm] = useState({
    project_id: "all",
    priority: "medium",
    tagsText: "",
    description: "",
    dueDate: "",
    requested_by: userName,
    task_type: "general",
  });
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [meetingDraftTasks, setMeetingDraftTasks] = useState<ActionItem[]>([]);
  const [meetingDraftRequirements, setMeetingDraftRequirements] = useState<RequirementItem[]>([]);
  const [lastMomPoints, setLastMomPoints] = useState<string[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [meetingConnectionStatus, setMeetingConnectionStatus] = useState<"idle" | "connecting" | "listening" | "error">("idle");
  const [meetingError, setMeetingError] = useState<string>("");
  const [isMeetingDetected, setIsMeetingDetected] = useState(false);
  const [isRefreshingMeetingStatus, setIsRefreshingMeetingStatus] = useState(false);
  const [historicalMeetings, setHistoricalMeetings] = useState<MeetingSummary[]>([]);
  const [historyDetailsMap, setHistoryDetailsMap] = useState<Record<string, MeetingDetailsResponse>>({});
  const [selectedHistoryMeetingId, setSelectedHistoryMeetingId] = useState<string | null>(null);
  const [selectedHistoryMeeting, setSelectedHistoryMeeting] = useState<MeetingDetailsResponse | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyParticipantFilter, setHistoryParticipantFilter] = useState("all");
  const [historyProjectFilter, setHistoryProjectFilter] = useState("all");
  const [historyDateFilter, setHistoryDateFilter] = useState("");
  const [historyDensity, setHistoryDensity] = useState<"comfortable" | "compact">("comfortable");
  const [displayMonth, setDisplayMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const wsRef = useRef<WebSocket | null>(null);

  const ensureMicrophonePermission = useCallback(async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new Error("Microphone API is not available in this environment.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach((track) => track.stop());
  }, []);

  const fetchDashboard = useCallback(async () => {
    const response = await fetch(`http://localhost:8000/api/v1/dashboard?user_name=${encodeURIComponent(userName)}`);
    const data = await response.json();
    setItems(data.reminders || []);
  }, [userName]);

  const fetchProjects = useCallback(async () => {
    const response = await fetch("http://localhost:8000/api/v1/projects");
    const data = await response.json();
    setProjects(data.projects || []);
  }, []);

  const fetchMeetingHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const response = await fetch("http://localhost:8000/api/v1/meetings/historical");
      const data = await response.json();
      const meetings = (data.meetings || []) as MeetingSummary[];
      setHistoricalMeetings(meetings);
      if (!selectedHistoryMeetingId && meetings.length > 0) {
        setSelectedHistoryMeetingId(meetings[0].id);
      }
      const detailEntries = await Promise.all(
        meetings.map(async (meeting) => {
          try {
            const detailResponse = await fetch(`http://localhost:8000/api/v1/meetings/${meeting.id}`);
            const detailData = (await detailResponse.json()) as MeetingDetailsResponse;
            return [meeting.id, detailData] as const;
          } catch {
            return [meeting.id, null] as const;
          }
        }),
      );
      const detailMap: Record<string, MeetingDetailsResponse> = {};
      detailEntries.forEach(([meetingId, details]) => {
        if (details) detailMap[meetingId] = details;
      });
      setHistoryDetailsMap(detailMap);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [selectedHistoryMeetingId]);

  const fetchMeetingDetails = useCallback(async (meetingId: string) => {
    const response = await fetch(`http://localhost:8000/api/v1/meetings/${meetingId}`);
    const data = (await response.json()) as MeetingDetailsResponse;
    setSelectedHistoryMeeting(data);
  }, []);

  useEffect(() => {
    fetchDashboard();
    fetchProjects();
  }, [fetchDashboard, fetchProjects]);

  useEffect(() => {
    if (!window.electronAPI?.onMeetingStatusChanged) return;

    window.electronAPI.onMeetingStatusChanged((isActive: boolean) => {
      setIsMeetingDetected(isActive);
    });

    if (window.electronAPI?.refreshMeetingStatus) {
      void window.electronAPI.refreshMeetingStatus().then((status: { active?: boolean }) => {
        setIsMeetingDetected(Boolean(status?.active));
      });
    }
  }, []);

  useEffect(() => {
    if (view !== "history") return;
    void fetchMeetingHistory();
  }, [fetchMeetingHistory, view]);

  useEffect(() => {
    if (!selectedHistoryMeetingId || view !== "history") return;
    void fetchMeetingDetails(selectedHistoryMeetingId);
  }, [fetchMeetingDetails, selectedHistoryMeetingId, view]);

  const refreshMeetingStatus = useCallback(async () => {
    if (!window.electronAPI?.refreshMeetingStatus) return;
    setIsRefreshingMeetingStatus(true);
    try {
      const status = await window.electronAPI.refreshMeetingStatus();
      setIsMeetingDetected(Boolean(status?.active));
    } finally {
      setIsRefreshingMeetingStatus(false);
    }
  }, []);

  const taskTypes = useMemo(
    () => Array.from(new Set(items.map((item) => (item.category || "general").toLowerCase()))).sort(),
    [items],
  );

  const sortedTasks = useMemo(() => {
    const filtered = items.filter((item) => {
      const priority = (item.priority || "medium").toLowerCase();
      const taskType = (item.category || "general").toLowerCase();
      const project = (item.project_id || "all").toLowerCase();
      const matchesProject = selectedProjectId === "all" || project === selectedProjectId;
      return matchesProject && (priorityFilter === "all" || priority === priorityFilter) && (taskTypeFilter === "all" || taskType === taskTypeFilter);
    });

    const weight = { high: 0, medium: 1, low: 2 };
    return filtered.sort((a, b) => {
      const pA = weight[(a.priority || "medium").toLowerCase() as keyof typeof weight] ?? 3;
      const pB = weight[(b.priority || "medium").toLowerCase() as keyof typeof weight] ?? 3;
      if (pA !== pB) return pA - pB;
      const dA = a.deadline ? new Date(a.deadline).getTime() : Number.MAX_SAFE_INTEGER;
      const dB = b.deadline ? new Date(b.deadline).getTime() : Number.MAX_SAFE_INTEGER;
      return dA - dB;
    });
  }, [items, priorityFilter, selectedProjectId, taskTypeFilter]);

  const runAiQuery = useCallback(async () => {
    if (!queryInput.trim()) return;
    const payload: { query: string; project_id?: string } = { query: queryInput.trim() };
    if (selectedProjectId !== "all") payload.project_id = selectedProjectId;

    const response = await fetch("http://localhost:8000/api/v1/intelligence/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    setResponses((prev) => [...prev, data.answer || "No response generated."]);
    setHomeMode("chat");
  }, [queryInput, selectedProjectId]);

  const openProjectTasks = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setHomeMode("tasks");
  }, []);

  const formatMeetingDate = useCallback((value?: string | null) => {
    if (!value) return "N/A";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "N/A";
    return parsed.toLocaleString();
  }, []);

  const historyParticipants = useMemo(() => {
    const unique = new Set<string>();
    historicalMeetings.forEach((meeting) => {
      const details = historyDetailsMap[meeting.id];
      const participants = details?.meeting?.participants || meeting.participants || [];
      participants.forEach((person) => {
        const normalized = String(person || "").trim();
        if (normalized) unique.add(normalized);
      });
    });
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [historicalMeetings, historyDetailsMap]);

  const historyProjects = useMemo(() => {
    const unique = new Set<string>();
    Object.values(historyDetailsMap).forEach((details) => {
      (details.tasks || []).forEach((task) => {
        const project = (task.project_id || "").trim().toLowerCase();
        if (project && project !== "all") unique.add(project);
      });
    });
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [historyDetailsMap]);

  const filteredHistoricalMeetings = useMemo(() => {
    const normalizedSearch = historySearch.trim().toLowerCase();
    return historicalMeetings.filter((meeting) => {
      const details = historyDetailsMap[meeting.id];
      const participants = details?.meeting?.participants || meeting.participants || [];
      const participantMatch = historyParticipantFilter === "all"
        || participants.some((person) => String(person || "").trim().toLowerCase() === historyParticipantFilter);

      const tasks = details?.tasks || [];
      const projectMatch = historyProjectFilter === "all"
        || tasks.some((task) => (task.project_id || "").trim().toLowerCase() === historyProjectFilter);

      const meetingDateKey = meeting.start_time ? new Date(meeting.start_time).toISOString().slice(0, 10) : "";
      const dateMatch = !historyDateFilter || meetingDateKey === historyDateFilter;

      const searchMatch = !normalizedSearch
        || meeting.title.toLowerCase().includes(normalizedSearch)
        || participants.some((person) => String(person || "").toLowerCase().includes(normalizedSearch));

      return participantMatch && projectMatch && dateMatch && searchMatch;
    });
  }, [historicalMeetings, historyDateFilter, historyDetailsMap, historyParticipantFilter, historyProjectFilter, historySearch]);

  const filteredMeetingsByDay = useMemo(() => {
    const grouped = new Map<string, MeetingSummary[]>();
    filteredHistoricalMeetings.forEach((meeting) => {
      const rawDate = meeting.start_time ? new Date(meeting.start_time) : null;
      const dayKey = rawDate && !Number.isNaN(rawDate.getTime())
        ? rawDate.toISOString().slice(0, 10)
        : "unscheduled";
      const existing = grouped.get(dayKey) || [];
      existing.push(meeting);
      grouped.set(dayKey, existing);
    });
    return grouped;
  }, [filteredHistoricalMeetings]);

  const monthGridCells = useMemo(() => {
    const year = displayMonth.getFullYear();
    const month = displayMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{
      dateKey: string;
      dayNumber: number;
      inMonth: boolean;
      meetings: MeetingSummary[];
      pendingCount: number;
      completedCount: number;
      pendingRatio: number;
    }> = [];

    for (let i = 0; i < 42; i += 1) {
      const dayOffset = i - startWeekday + 1;
      const date = new Date(year, month, dayOffset);
      const dateKey = date.toISOString().slice(0, 10);
      const inMonth = dayOffset >= 1 && dayOffset <= daysInMonth;
      const meetings = filteredMeetingsByDay.get(dateKey) || [];
      let pendingCount = 0;
      let completedCount = 0;
      meetings.forEach((meeting) => {
        const details = historyDetailsMap[meeting.id];
        (details?.tasks || []).forEach((task) => {
          if (String(task.status || "pending").toLowerCase() === "completed") completedCount += 1;
          else pendingCount += 1;
        });
      });
      const pendingRatio = pendingCount + completedCount > 0 ? pendingCount / (pendingCount + completedCount) : 0;

      cells.push({
        dateKey,
        dayNumber: date.getDate(),
        inMonth,
        meetings,
        pendingCount,
        completedCount,
        pendingRatio,
      });
    }
    return cells;
  }, [displayMonth, filteredMeetingsByDay, historyDetailsMap]);

  const historyTrends = useMemo(() => {
    let totalTasks = 0;
    let completedTasks = 0;
    let pendingTasks = 0;
    const projectCounter = new Map<string, number>();

    filteredHistoricalMeetings.forEach((meeting) => {
      const details = historyDetailsMap[meeting.id];
      (details?.tasks || []).forEach((task) => {
        totalTasks += 1;
        const isCompleted = String(task.status || "pending").toLowerCase() === "completed";
        if (isCompleted) completedTasks += 1;
        else pendingTasks += 1;

        const projectId = String(task.project_id || "").trim().toLowerCase();
        if (projectId && projectId !== "all") {
          projectCounter.set(projectId, (projectCounter.get(projectId) || 0) + 1);
        }
      });
    });

    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    const dominantProject = Array.from(projectCounter.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "n/a";
    const pendingHeavyDays = monthGridCells.filter((cell) => cell.inMonth && cell.pendingRatio >= 0.6 && cell.meetings.length > 0).length;

    return {
      meetingCount: filteredHistoricalMeetings.length,
      totalTasks,
      pendingTasks,
      completionRate,
      dominantProject,
      pendingHeavyDays,
    };
  }, [filteredHistoricalMeetings, historyDetailsMap, monthGridCells]);

  const selectedDayMeetings = useMemo(() => {
    if (!historyDateFilter) return [];
    return filteredMeetingsByDay.get(historyDateFilter) || [];
  }, [filteredMeetingsByDay, historyDateFilter]);

  const saveModalTask = useCallback(async () => {
    if (!taskForm.description.trim()) return;
    const tags = taskForm.tagsText.split(/\s+/).map((tag) => tag.trim().toLowerCase()).filter(Boolean);
    await fetch("http://localhost:8000/api/v1/tasks/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: taskForm.description.trim(),
        assignee: userName,
        requested_by: taskForm.requested_by.trim() || userName,
        deadline: taskForm.dueDate ? new Date(taskForm.dueDate).toISOString() : null,
        priority: taskForm.priority,
        category: taskForm.task_type,
        project_id: taskForm.project_id,
        tags,
      }),
    });
    setShowTaskModal(false);
    setTaskForm({
      project_id: taskForm.project_id,
      priority: "medium",
      tagsText: "",
      description: "",
      dueDate: "",
      requested_by: userName,
      task_type: "general",
    });
    setHomeMode("tasks");
    await fetchDashboard();
  }, [fetchDashboard, taskForm, userName]);

  const connectMeetingSocket = useCallback((meetingId: string) => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const query = `meeting_id=${encodeURIComponent(meetingId)}&user_name=${encodeURIComponent(userName)}`;
    setMeetingConnectionStatus("connecting");
    setMeetingError("");
    wsRef.current = new WebSocket(`ws://localhost:8000/api/v1/ws/transcribe?${query}`);
    wsRef.current.onopen = () => {
      setMeetingConnectionStatus("listening");
      setIsRecording(true);
    };
    wsRef.current.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === "transcript") {
        setTranscripts((prev) => [...prev, payload.data]);
      } else if (payload.type === "task_detected") {
        setMeetingDraftTasks((prev) => [...prev, { ...payload.data, project_id: selectedProjectId, task_type: "meeting" }]);
      } else if (payload.type === "requirement_detected") {
        setMeetingDraftRequirements((prev) => [...prev, payload.data]);
      }
    };
    wsRef.current.onerror = () => {
      setMeetingConnectionStatus("error");
      setMeetingError("Unable to start live transcription. Please retry.");
      setIsRecording(false);
    };
    wsRef.current.onclose = () => {
      setMeetingConnectionStatus((prev) => (prev === "error" ? prev : "idle"));
      setIsRecording(false);
    };
  }, [selectedProjectId, userName]);

  const startMeeting = useCallback(async () => {
    try {
      await ensureMicrophonePermission();
    } catch (_error) {
      setMeetingError("Microphone permission is required. Please allow microphone access and try again.");
      return;
    }

    const response = await fetch("http://localhost:8000/api/v1/meetings/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Live Meeting", organizer: "Self", participants: [userName] }),
    });
    const data = await response.json();
    setActiveMeetingId(data.meeting.id);
    setTranscripts([]);
    setMeetingDraftTasks([]);
    setMeetingDraftRequirements([]);
    setLastMomPoints([]);
    setMeetingConnectionStatus("connecting");
    setMeetingError("");
    connectMeetingSocket(data.meeting.id);
    setView("meeting");
  }, [connectMeetingSocket, ensureMicrophonePermission, userName]);

  const saveMeetingAndStop = useCallback(async () => {
    if (!activeMeetingId) return;
    wsRef.current?.close();
    wsRef.current = null;
    await fetch(`http://localhost:8000/api/v1/meetings/${activeMeetingId}/end`, { method: "POST" });
    const finalizeResponse = await fetch(`http://localhost:8000/api/v1/meetings/${activeMeetingId}/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: meetingDraftTasks, requirements: meetingDraftRequirements }),
    });
    const finalizeData = await finalizeResponse.json();
    setLastMomPoints(Array.isArray(finalizeData?.mom_points) ? finalizeData.mom_points : []);
    setHomeMode("chat");
    setIsRecording(false);
    setMeetingConnectionStatus("idle");
    setMeetingError("");
    setActiveMeetingId(null);
    setView("home");
    await fetchDashboard();
  }, [activeMeetingId, fetchDashboard, meetingDraftRequirements, meetingDraftTasks]);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  if (view === "meeting") {
    return (
      <div className="app-container">
        <header className="premium-header">
          <h1>Meeting Assistant</h1>
          <div className="header-actions">
            <span className="meeting-status-chip">
              Listening: {meetingConnectionStatus === "listening" ? "Active" : meetingConnectionStatus === "connecting" ? "Connecting..." : "Stopped"}
            </span>
          </div>
          <button className="record-btn recording" onClick={saveMeetingAndStop}>
            Save Transcript + Tasks
          </button>
        </header>
        {meetingError && <p className="placeholder">{meetingError}</p>}
        <div className="main-content split-40-60">
          <section className="panel">
            <h3>Task List</h3>
            <div className="suggestion-box">
              {meetingDraftTasks.map((task, index) => (
                <div key={`${task.task}-${index}`} className="suggestion-item active-suggestion">
                  <input
                    value={task.task}
                    onChange={(e) => setMeetingDraftTasks((prev) => prev.map((x, i) => (i === index ? { ...x, task: e.target.value } : x)))}
                  />
                  <select
                    value={task.project_id || "all"}
                    onChange={(e) => setMeetingDraftTasks((prev) => prev.map((x, i) => (i === index ? { ...x, project_id: e.target.value } : x)))}
                  >
                    <option value="all">All</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                  </select>
                  <select
                    value={task.priority || "medium"}
                    onChange={(e) => setMeetingDraftTasks((prev) => prev.map((x, i) => (i === index ? { ...x, priority: e.target.value } : x)))}
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                  <input
                    value={task.task_type || task.category || "meeting"}
                    onChange={(e) => setMeetingDraftTasks((prev) => prev.map((x, i) => (i === index ? { ...x, task_type: e.target.value, category: e.target.value } : x)))}
                    placeholder="Task Type"
                  />
                  <button className="snooze-btn" onClick={() => setMeetingDraftTasks((prev) => prev.filter((_, i) => i !== index))}>Delete</button>
                </div>
              ))}
              {meetingDraftTasks.length === 0 && <p className="placeholder">Detected tasks will appear here.</p>}
            </div>
          </section>
          <section className="panel">
            <h3>Requirements</h3>
            <div className="suggestion-box">
              {meetingDraftRequirements.map((item, index) => (
                <div key={`${item.requirement}-${index}`} className="suggestion-item active-suggestion">
                  <input
                    value={item.requirement}
                    onChange={(e) => setMeetingDraftRequirements((prev) => prev.map((x, i) => (i === index ? { ...x, requirement: e.target.value } : x)))}
                  />
                  <button className="snooze-btn" onClick={() => setMeetingDraftRequirements((prev) => prev.filter((_, i) => i !== index))}>Delete</button>
                </div>
              ))}
              {meetingDraftRequirements.length === 0 && <p className="placeholder">Discussed requirements will appear here.</p>}
            </div>
          </section>
          <section className="panel">
            <h3>Live Transcript</h3>
            <div className="transcript-box">
              {transcripts.map((segment, index) => (
                <div key={`${segment.text}-${index}`} className="transcript-item">
                  <strong>{segment.speaker}: </strong>
                  {segment.text}
                </div>
              ))}
              {transcripts.length === 0 && <p className="placeholder">{isRecording ? "Listening..." : "Idle"}</p>}
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (view === "history") {
    const requirements = selectedHistoryMeeting?.meeting?.requirements || [];
    const momPoints = selectedHistoryMeeting?.meeting?.mom_points || [];
    const meetingTasks = selectedHistoryMeeting?.tasks || [];

    return (
      <div className="app-container">
        <header className="premium-header">
          <h1>Meeting History Calendar</h1>
          <div className="header-actions">
            <button className="record-btn" onClick={() => setView("home")}>Back to Home</button>
            <button className="record-btn" onClick={fetchMeetingHistory} disabled={isLoadingHistory}>
              {isLoadingHistory ? "Refreshing..." : "Refresh History"}
            </button>
          </div>
        </header>
        <div className={`history-layout ${historyDensity === "compact" ? "density-compact" : "density-comfortable"}`}>
          <section className="panel">
            <h3>Calendar & Filters</h3>
            <div className="history-filter-grid">
              <input value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} placeholder="Search by title / participant" />
              <select value={historyParticipantFilter} onChange={(e) => setHistoryParticipantFilter(e.target.value)}>
                <option value="all">Participant: All</option>
                {historyParticipants.map((participant) => (
                  <option key={participant} value={participant.toLowerCase()}>{participant}</option>
                ))}
              </select>
              <select value={historyProjectFilter} onChange={(e) => setHistoryProjectFilter(e.target.value)}>
                <option value="all">Project: All</option>
                {historyProjects.map((projectId) => (
                  <option key={projectId} value={projectId}>{projectId}</option>
                ))}
              </select>
              <input type="date" value={historyDateFilter} onChange={(e) => setHistoryDateFilter(e.target.value)} />
            </div>
            <div className="month-nav">
              <button className="snooze-btn" onClick={() => setDisplayMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}>Prev</button>
              <strong>{displayMonth.toLocaleString(undefined, { month: "long", year: "numeric" })}</strong>
              <div className="month-nav-actions">
                <button
                  className={`snooze-btn ${historyDensity === "compact" ? "density-btn-active" : ""}`}
                  onClick={() => setHistoryDensity((prev) => (prev === "compact" ? "comfortable" : "compact"))}
                >
                  {historyDensity === "compact" ? "Compact" : "Comfortable"}
                </button>
                <button
                  className="snooze-btn"
                  onClick={() => {
                    const now = new Date();
                    const todayKey = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0, 10);
                    setDisplayMonth(new Date(now.getFullYear(), now.getMonth(), 1));
                    setHistoryDateFilter(todayKey);
                  }}
                >
                  Today
                </button>
                <button className="snooze-btn" onClick={() => setDisplayMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}>Next</button>
              </div>
            </div>
            <div className="history-trend-strip">
              <div className="history-trend-card"><span className="muted">Meetings</span><strong>{historyTrends.meetingCount}</strong></div>
              <div className="history-trend-card"><span className="muted">Completion</span><strong>{historyTrends.completionRate}%</strong></div>
              <div className="history-trend-card"><span className="muted">Pending Tasks</span><strong>{historyTrends.pendingTasks}</strong></div>
              <div className="history-trend-card"><span className="muted">Hot Project</span><strong>{historyTrends.dominantProject}</strong></div>
              <div className="history-trend-card"><span className="muted">Risky Days</span><strong>{historyTrends.pendingHeavyDays}</strong></div>
            </div>
            <div className="month-grid">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name) => (
                <div key={name} className="month-grid-header">{name}</div>
              ))}
              {monthGridCells.map((cell) => (
                <button
                  key={cell.dateKey}
                  className={`month-cell ${cell.inMonth ? "" : "out-month"} ${historyDateFilter === cell.dateKey ? "selected" : ""}`}
                  onClick={() => {
                    setHistoryDateFilter(cell.dateKey);
                    const dayMeetings = filteredMeetingsByDay.get(cell.dateKey) || [];
                    if (dayMeetings.length > 0) {
                      setSelectedHistoryMeetingId(dayMeetings[0].id);
                    }
                  }}
                >
                  <span className="month-day-number">{cell.dayNumber}</span>
                  <span className="month-meeting-count">{cell.meetings.length}</span>
                  <span className="month-status-dots">
                    <span className={`status-dot ${cell.pendingRatio >= 0.6 ? "status-dot-danger" : cell.pendingRatio > 0.3 ? "status-dot-warn" : "status-dot-good"}`} />
                    <span className="muted">{cell.pendingCount}/{cell.completedCount}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="history-calendar-list">
              {!historyDateFilter && <p className="placeholder">Select a date in the calendar to expand that day’s meetings.</p>}
              {historyDateFilter && selectedDayMeetings.length === 0 && <p className="placeholder">No meetings on selected date.</p>}
              {selectedDayMeetings.map((meeting) => (
                <button
                  key={meeting.id}
                  className={`history-meeting-item ${selectedHistoryMeetingId === meeting.id ? "selected" : ""}`}
                  onClick={() => setSelectedHistoryMeetingId(meeting.id)}
                >
                  <strong>{meeting.title || "Meeting"}</strong>
                  <span className="muted">{formatMeetingDate(meeting.start_time)}</span>
                  <span className="muted">Status: {meeting.status || "unknown"}</span>
                  <div className="history-chip-row">
                    {(historyDetailsMap[meeting.id]?.meeting?.participants || []).slice(0, 3).map((participant) => (
                      <span key={`${meeting.id}-${participant}`} className="history-chip">{participant}</span>
                    ))}
                    {Array.from(new Set((historyDetailsMap[meeting.id]?.tasks || []).map((task) => (task.project_id || "").trim().toLowerCase()).filter((project) => project && project !== "all"))).slice(0, 2).map((project) => (
                      <span key={`${meeting.id}-${project}`} className="history-chip project-chip">{project}</span>
                    ))}
                  </div>
                </button>
              ))}
              {!historyDateFilter && filteredHistoricalMeetings.length === 0 && <p className="placeholder">No meetings match the selected filters.</p>}
            </div>
          </section>

          <section className="panel">
            <h3>Meeting Details</h3>
            {!selectedHistoryMeeting && <p className="placeholder">Select a meeting to view MOM, Tasks, and Requirements.</p>}
            {selectedHistoryMeeting && (
              <div className="history-details">
                <div className="history-meta">
                  <h2>{selectedHistoryMeeting.meeting.title}</h2>
                  <span className="muted">Start: {formatMeetingDate(selectedHistoryMeeting.meeting.start_time)}</span>
                  <span className="muted">End: {formatMeetingDate(selectedHistoryMeeting.meeting.end_time)}</span>
                </div>

                <div className="history-section">
                  <h4>MOM (Minutes of Meeting)</h4>
                  <ul className="history-bullet-list">
                    {momPoints.map((point, index) => (
                      <li key={`${point}-${index}`}>{point}</li>
                    ))}
                  </ul>
                  {momPoints.length === 0 && <p className="placeholder">No MOM points available.</p>}
                </div>

                <div className="history-section">
                  <h4>Tasks</h4>
                  <div className="reminders-list">
                    {meetingTasks.map((task, index) => (
                      <div key={`${task.task}-${index}`} className="reminder-card">
                        <div className="reminder-info">
                          <strong>{task.task}</strong>
                          <span className="deadline">Owner: {task.assignee || "Unassigned"}</span>
                          <span className="deadline">Priority: {task.priority || "medium"} | Type: {task.category || "meeting"}</span>
                          <span className={`status-chip ${String(task.status || "pending").toLowerCase() === "completed" ? "status-completed" : "status-pending"}`}>
                            {String(task.status || "pending").toLowerCase() === "completed" ? "Completed" : "Pending"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {meetingTasks.length === 0 && <p className="placeholder">No tasks captured for this meeting.</p>}
                </div>

                <div className="history-section">
                  <h4>Requirements</h4>
                  <div className="reminders-list">
                    {requirements.map((item, index) => (
                      <div key={`${item.requirement}-${index}`} className="ai-response">
                        <strong>{item.requirement}</strong>
                        <div className="muted">Confidence: {Math.round((item.confidence || 0) * 100)}%</div>
                      </div>
                    ))}
                  </div>
                  {requirements.length === 0 && <p className="placeholder">No requirements captured for this meeting.</p>}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container home-layout">
      <header className="premium-header">
        <h1>IoT BU AI Assistant</h1>
        <div className="header-actions">
          <button className="record-btn" onClick={startMeeting}>Manual Start Conversation</button>
          <button className="record-btn" onClick={() => setView("history")}>Meeting History</button>
          <button className="record-btn" onClick={refreshMeetingStatus} disabled={isRefreshingMeetingStatus}>
            {isRefreshingMeetingStatus ? "Refreshing..." : "Refresh Meeting Status"}
          </button>
        </div>
      </header>
      {meetingError && view === "home" && <p className="placeholder">{meetingError}</p>}

      <div className="split-layout">
        <aside className="left-panel">
          <button className="add-task-btn" onClick={() => setShowTaskModal(true)}>Add Task / Reminder</button>
          <div className="panel-block">
            <h3>Projects</h3>
            <div className="project-list">
              <button className={`project-item ${selectedProjectId === "all" ? "selected" : ""}`} onClick={() => openProjectTasks("all")}>
                <span>All</span>
              </button>
              {projects.map((project) => (
                <button
                  key={project.id}
                  className={`project-item ${selectedProjectId === project.id ? "selected" : ""}`}
                  onClick={() => openProjectTasks(project.id)}
                >
                  <span>{project.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="panel-block">
            <h3>Filters</h3>
            <select value={taskTypeFilter} onChange={(e) => setTaskTypeFilter(e.target.value)}>
              <option value="all">Task Type: All</option>
              {taskTypes.map((taskType) => (
                <option key={taskType} value={taskType}>{taskType}</option>
              ))}
            </select>
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as "all" | "high" | "medium" | "low")}>
              <option value="all">Priority: All</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </aside>

        <main className="right-panel">
          <section className="workspace-top panel">
            <div className="meeting-status-chip">
              Meeting Status: {isMeetingDetected ? "Detected" : "Not detected"}
            </div>
            {homeMode === "placeholder" && (
              <div className="empty-bu-placeholder">
                <h2>BU Summary</h2>
              </div>
            )}
            {homeMode === "tasks" && (
              <>
                <h2>Pending Tasks + Meeting Reminders</h2>
                <div className="reminders-list">
                  {sortedTasks.map((item, index) => (
                    <div key={`${item.task}-${index}`} className="reminder-card">
                      <div className="reminder-info">
                        <strong>{item.task}</strong>
                        <span className="deadline">{item.priority || "medium"} | {item.category || "general"}</span>
                        <span className="deadline">{item.deadline || "No due date"}</span>
                        <span className="deadline">Tags: {(item.tags || []).join(", ") || "-"}</span>
                      </div>
                    </div>
                  ))}
                  {sortedTasks.length === 0 && <p className="placeholder">No matching tasks.</p>}
                </div>
              </>
            )}
            {homeMode === "chat" && (
              <>
                <h2>AI Responses</h2>
                <div className="reminders-list">
                  {lastMomPoints.length > 0 && (
                    <div className="ai-response">
                      <strong>MOM</strong>
                      <ul>
                        {lastMomPoints.map((point, index) => (
                          <li key={`${point}-${index}`}>{point}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {responses.map((response, index) => (
                    <div key={`${response}-${index}`} className="ai-response">{response}</div>
                  ))}
                </div>
              </>
            )}
          </section>
          <section className="chat-full-width panel">
            <h3>AI Chat</h3>
            <textarea rows={3} value={queryInput} onChange={(e) => setQueryInput(e.target.value)} placeholder="Ask your project or BU query..." />
            <button className="record-btn" onClick={runAiQuery}>Ask AI</button>
          </section>
        </main>
      </div>

      {showTaskModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Add Task / Reminder</h3>
            <label>Project</label>
            <select value={taskForm.project_id} onChange={(e) => setTaskForm((prev) => ({ ...prev, project_id: e.target.value }))}>
              <option value="all">All</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
            <label>Priority</label>
            <select value={taskForm.priority} onChange={(e) => setTaskForm((prev) => ({ ...prev, priority: e.target.value }))}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <label>Tags</label>
            <input value={taskForm.tagsText} onChange={(e) => setTaskForm((prev) => ({ ...prev, tagsText: e.target.value }))} placeholder="space separated tags" />
            <label>Description</label>
            <textarea rows={3} value={taskForm.description} onChange={(e) => setTaskForm((prev) => ({ ...prev, description: e.target.value }))} />
            <label>Task Type</label>
            <input value={taskForm.task_type} onChange={(e) => setTaskForm((prev) => ({ ...prev, task_type: e.target.value }))} />
            <label>Due Date</label>
            <input type="date" value={taskForm.dueDate} onChange={(e) => setTaskForm((prev) => ({ ...prev, dueDate: e.target.value }))} />
            <label>Task Requested By</label>
            <input value={taskForm.requested_by} onChange={(e) => setTaskForm((prev) => ({ ...prev, requested_by: e.target.value }))} />
            <div className="modal-actions">
              <button className="snooze-btn" onClick={() => setShowTaskModal(false)}>Cancel</button>
              <button className="record-btn" onClick={saveModalTask}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
