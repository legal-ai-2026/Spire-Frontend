"use client";
import { useEffect, useState } from "react";
import {
  CalendarDays, CheckCircle2, ChevronLeft, ChevronRight,
  Download, Plus, RotateCcw, Trash2, Users,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Soldier } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
const MISSIONS   = ["planning", "attack", "defense"] as const;
const ROLES      = ["PL", "PSG", "SL1", "SL2", "SL3", "WSL"] as const;
const ROLE_LABEL: Record<string, string> = {
  PL: "PL", PSG: "PSG", SL1: "SL1", SL2: "SL2", SL3: "SL3", WSL: "WSL",
};
const MISSION_LABEL: Record<string, string> = {
  planning: "Planning", attack: "Attack", defense: "Defense",
};
const GRADER_LABEL: Record<string, string> = {
  PL: "PL Grader", PSG: "PSG Grader",
  SL1: "SL Grader", SL2: "SL Grader", SL3: "SL Grader", WSL: "WSL Grader",
};

type MissionKey = typeof MISSIONS[number];
type RoleKey    = typeof ROLES[number];

interface Slot {
  id: number;
  day_number: number;
  mission_type: MissionKey;
  role: RoleKey;
  soldier_id: number | null;
  soldier_name: string | null;
}

interface Schedule {
  id: number;
  name: string;
  platoon_name?: string;
  num_days: number;
  start_date?: string;
  slot_count: number;
  created_at?: string;
  slots?: Slot[];
}

interface SoldierProgress {
  soldier_id: number;
  name: string;
  lead_count: number;
  command_count: number;
  roles_played: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function shortName(full: string | null): string {
  if (!full) return "—";
  const parts = full.trim().split(" ");
  if (parts.length < 2) return full;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

function dayLabel(schedule: Schedule, day: number): string {
  if (!schedule.start_date) return `Day ${day}`;
  const date = new Date(schedule.start_date);
  date.setDate(date.getDate() + day - 1);
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

const COMMAND_TARGET = 2; // each soldier should hold PL or PSG at least twice

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function TrainingPage() {
  const [schedules,    setSchedules]   = useState<Schedule[]>([]);
  const [active,       setActive]      = useState<Schedule | null>(null);
  const [slots,        setSlots]       = useState<Slot[]>([]);
  const [progress,     setProgress]    = useState<SoldierProgress[]>([]);
  const [soldiers,     setSoldiers]    = useState<Soldier[]>([]);
  const [currentDay,   setCurrentDay]  = useState(1);
  const [loading,      setLoading]     = useState(true);
  const [generating,   setGenerating]  = useState(false);
  const [showNew,      setShowNew]     = useState(false);
  const [error,        setError]       = useState("");

  // Swap state
  const [swapping,     setSwapping]    = useState<Slot | null>(null);
  const [swapLoading,  setSwapLoading] = useState(false);

  // New schedule form
  const [form, setForm] = useState({
    name: "", platoon_name: "", num_days: "10", start_date: "",
  });
  const [selectedIds, setSelectedIds]  = useState<Set<number>>(new Set());

  // -------------------------------------------------------------------------
  // Load
  // -------------------------------------------------------------------------
  useEffect(() => {
    Promise.all([
      api.get<Schedule[]>("/api/v1/training-schedules"),
      api.get<Soldier[]>("/api/v1/soldiers"),
    ]).then(([sc, sol]) => {
      setSchedules(sc);
      setSoldiers(sol);
    }).finally(() => setLoading(false));
  }, []);

  async function openSchedule(sched: Schedule) {
    const full = await api.get<Schedule>(`/api/v1/training-schedules/${sched.id}`);
    setActive(full);
    setSlots(full.slots ?? []);
    setCurrentDay(1);
    loadProgress(sched.id);
  }

  async function loadProgress(id: number) {
    const prog = await api.get<{ soldiers: SoldierProgress[] }>(
      `/api/v1/training-schedules/${id}/progress`
    ).catch(() => null);
    if (prog) setProgress(prog.soldiers);
  }

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------
  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(""); setGenerating(true);
    try {
      const sched = await api.post<Schedule>("/api/v1/training-schedules", {
        name:         form.name,
        platoon_name: form.platoon_name || null,
        num_days:     parseInt(form.num_days) || 10,
        start_date:   form.start_date || null,
        soldier_ids:  Array.from(selectedIds),
      });
      setSchedules(prev => [sched, ...prev]);
      setShowNew(false);
      setSelectedIds(new Set());
      setForm({ name: "", platoon_name: "", num_days: "10", start_date: "" });
      await openSchedule(sched);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to generate schedule");
    } finally {
      setGenerating(false);
    }
  }

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------
  async function handleDelete(id: number) {
    await api.delete(`/api/v1/training-schedules/${id}`).catch(() => {});
    setSchedules(prev => prev.filter(s => s.id !== id));
    if (active?.id === id) { setActive(null); setSlots([]); setProgress([]); }
  }

  // -------------------------------------------------------------------------
  // Save / export
  // -------------------------------------------------------------------------
  function saveSchedule() {
    if (!active) return;

    const header = [
      `Schedule: ${active.name}${active.platoon_name ? ` — ${active.platoon_name}` : ""}`,
      `Days: ${active.num_days}${active.start_date ? `  |  Start: ${active.start_date}` : ""}`,
      "",
    ];

    const rows: string[] = ["Day,Date,Role,Planning,Attack,Defense"];
    for (let d = 1; d <= active.num_days; d++) {
      const dateStr = active.start_date
        ? dayLabel(active, d)
        : `Day ${d}`;
      for (const role of ROLES) {
        const cells = MISSIONS.map(m => {
          const sl = slots.find(s => s.day_number === d && s.mission_type === m && s.role === role);
          return sl?.soldier_name ? `"${sl.soldier_name}"` : "";
        });
        rows.push([d, dateStr, role, ...cells].join(","));
      }
    }

    const csv = [...header.map(l => `# ${l}`), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${active.name.replace(/\s+/g, "_")}_schedule.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // -------------------------------------------------------------------------
  // Swap soldier in a slot
  // -------------------------------------------------------------------------
  async function confirmSwap(soldierId: number | null) {
    if (!swapping || !active) return;
    setSwapLoading(true);
    try {
      const updated = await api.patch<Slot>(
        `/api/v1/training-schedules/${active.id}/slots/${swapping.id}`,
        { soldier_id: soldierId }
      );
      setSlots(prev => prev.map(s => s.id === updated.id ? updated : s));
      await loadProgress(active.id);
    } finally {
      setSwapLoading(false);
      setSwapping(null);
    }
  }

  // -------------------------------------------------------------------------
  // Derived: day grid
  // -------------------------------------------------------------------------
  function daySlots(day: number): Record<MissionKey, Record<RoleKey, Slot | undefined>> {
    const grid: Record<string, Record<string, Slot | undefined>> = {};
    for (const m of MISSIONS)  { grid[m] = {}; }
    for (const sl of slots) {
      if (sl.day_number === day) grid[sl.mission_type][sl.role] = sl;
    }
    return grid as Record<MissionKey, Record<RoleKey, Slot | undefined>>;
  }

  // -------------------------------------------------------------------------
  // Soldier selector (all-check)
  // -------------------------------------------------------------------------
  function toggleAll() {
    if (selectedIds.size === soldiers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(soldiers.map(s => s.id)));
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (loading) {
    return <div className="p-6 text-[#8b949e] text-sm">Loading…</div>;
  }

  const grid = active ? daySlots(currentDay) : null;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-white">Training Schedule</h1>
          <p className="text-[#8b949e] text-xs mt-0.5">
            Phase 02 — Platoon rotation · 10-day leadership cycle
          </p>
        </div>
        <button
          onClick={() => setShowNew(!showNew)}
          className="flex items-center gap-1.5 px-3 py-2 bg-[#f59e0b] hover:bg-amber-600 text-black text-sm font-semibold rounded-md transition-colors"
        >
          <Plus size={14} /> New Schedule
        </button>
      </div>

      {error && (
        <div className="p-3 bg-[#f85149]/10 border border-[#f85149]/30 text-[#f85149] text-sm rounded-md">
          {error}
        </div>
      )}

      {/* ── Create form ── */}
      {showNew && (
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">Generate Rotation Schedule</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">
                  Schedule Name *
                </label>
                <input required value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. 1st PLT — Week 1"
                  className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none focus:border-[#f59e0b]" />
              </div>
              <div>
                <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">
                  Platoon Name
                </label>
                <input value={form.platoon_name}
                  onChange={e => setForm(p => ({ ...p, platoon_name: e.target.value }))}
                  placeholder="e.g. 1st PLT"
                  className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none focus:border-[#f59e0b]" />
              </div>
              <div>
                <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">
                  Start Date
                </label>
                <input type="date" value={form.start_date}
                  onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))}
                  className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none focus:border-[#f59e0b]" />
              </div>
              <div>
                <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">
                  Training Days
                </label>
                <input type="number" min={1} max={30} value={form.num_days}
                  onChange={e => setForm(p => ({ ...p, num_days: e.target.value }))}
                  className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none focus:border-[#f59e0b]" />
              </div>
            </div>

            {/* Soldier selector */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">
                  Soldiers ({selectedIds.size} / {soldiers.length} selected)
                </label>
                <button type="button" onClick={toggleAll}
                  className="text-[10px] text-[#f59e0b] hover:underline">
                  {selectedIds.size === soldiers.length ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto bg-[#0d1117] border border-[#30363d] rounded-md p-2 grid grid-cols-2 sm:grid-cols-3 gap-1">
                {soldiers.map(s => (
                  <label key={s.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#161b22] cursor-pointer">
                    <input type="checkbox"
                      checked={selectedIds.has(s.id)}
                      onChange={e => setSelectedIds(prev => {
                        const next = new Set(prev);
                        e.target.checked ? next.add(s.id) : next.delete(s.id);
                        return next;
                      })}
                      className="accent-[#f59e0b]" />
                    <span className="text-xs text-[#c9d1d9] truncate">{s.rank} {s.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button type="submit" disabled={generating || selectedIds.size === 0}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#f59e0b] text-black text-sm font-semibold rounded-md hover:bg-amber-600 disabled:opacity-50 transition-colors">
                <RotateCcw size={13} className={generating ? "animate-spin" : ""} />
                {generating ? "Generating…" : "Generate Schedule"}
              </button>
              <button type="button" onClick={() => setShowNew(false)}
                className="px-4 py-2 bg-[#21262d] text-[#8b949e] text-sm rounded-md hover:text-white">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* ── Schedule list ── */}
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-[#8b949e] uppercase tracking-wider">Schedules</h2>
          {schedules.length === 0 ? (
            <p className="text-[#6e7681] text-sm">No schedules yet</p>
          ) : schedules.map(s => (
            <div key={s.id}
              className={`group rounded-lg border transition-colors cursor-pointer ${
                active?.id === s.id
                  ? "border-[#f59e0b] bg-[#f59e0b]/5"
                  : "border-[#30363d] bg-[#161b22] hover:border-[#8b949e]"
              }`}>
              <button
                className="w-full text-left px-4 py-3"
                onClick={() => openSchedule(s)}
              >
                <p className="text-sm text-white font-medium truncate">{s.name}</p>
                {s.platoon_name && (
                  <p className="text-[10px] text-[#8b949e]">{s.platoon_name}</p>
                )}
                <p className="text-[10px] text-[#6e7681] mt-0.5">
                  {s.num_days} days · {s.slot_count} slots
                </p>
              </button>
              <div className="px-4 pb-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(s.id); }}
                  className="text-[10px] text-[#6e7681] hover:text-[#f85149] flex items-center gap-1 transition-colors"
                >
                  <Trash2 size={10} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* ── Active schedule ── */}
        {active && grid && (
          <div className="lg:col-span-3 space-y-4">
            {/* Day navigator */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCurrentDay(d => Math.max(1, d - 1))}
                disabled={currentDay === 1}
                className="p-1.5 rounded bg-[#21262d] text-[#8b949e] hover:text-white disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>

              <div className="flex gap-1 overflow-x-auto flex-1">
                {Array.from({ length: active.num_days }, (_, i) => i + 1).map(d => (
                  <button
                    key={d}
                    onClick={() => setCurrentDay(d)}
                    className={`shrink-0 min-w-[44px] py-1.5 rounded text-xs font-semibold transition-colors ${
                      d === currentDay
                        ? "bg-[#f59e0b] text-black"
                        : "bg-[#21262d] text-[#8b949e] hover:text-white"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setCurrentDay(d => Math.min(active.num_days, d + 1))}
                disabled={currentDay === active.num_days}
                className="p-1.5 rounded bg-[#21262d] text-[#8b949e] hover:text-white disabled:opacity-30 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Day label + Save */}
            <div className="flex items-center gap-2">
              <CalendarDays size={14} className="text-[#f59e0b]" />
              <span className="text-sm font-bold text-white">
                Day {currentDay}
              </span>
              {active.start_date && (
                <span className="text-xs text-[#8b949e]">— {dayLabel(active, currentDay)}</span>
              )}
              <button
                onClick={saveSchedule}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] hover:text-white text-xs font-semibold rounded-md transition-colors border border-[#30363d]"
              >
                <Download size={12} /> Save
              </button>
            </div>

            {/* ── Schedule grid (matches spreadsheet layout) ── */}
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#30363d]">
                    <th className="text-left px-3 py-2.5 text-[10px] text-[#8b949e] uppercase tracking-wider w-14">
                      Role
                    </th>
                    {MISSIONS.map(m => (
                      <th key={m} className="px-3 py-2.5 text-center">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${
                          m === "planning" ? "text-[#58a6ff]" :
                          m === "attack"   ? "text-[#f85149]" : "text-[#3fb950]"
                        }`}>
                          {MISSION_LABEL[m]}
                        </span>
                        <div className="text-[9px] text-[#6e7681] font-normal mt-0.5 capitalize">
                          Mission {MISSIONS.indexOf(m) + 1}
                        </div>
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-center text-[10px] text-[#6e7681] uppercase tracking-wider">
                      Grader
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ROLES.map((role, ri) => (
                    <tr key={role} className={ri % 2 === 0 ? "bg-[#0d1117]" : ""}>
                      <td className="px-3 py-2.5">
                        <span className="font-bold text-[#f59e0b]">{ROLE_LABEL[role]}</span>
                      </td>
                      {MISSIONS.map(mission => {
                        const slot = grid[mission][role];
                        return (
                          <td key={mission} className="px-3 py-2.5 text-center">
                            {slot ? (
                              <button
                                onClick={() => setSwapping(slot)}
                                className="px-2 py-1 rounded hover:bg-[#21262d] transition-colors text-white font-medium group"
                                title="Click to swap soldier"
                              >
                                {shortName(slot.soldier_name)}
                                <span className="hidden group-hover:inline text-[#6e7681] ml-1">↕</span>
                              </button>
                            ) : (
                              <span className="text-[#4a5568]">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2.5 text-center text-[10px] text-[#6e7681]">
                        {GRADER_LABEL[role]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Progress tracker ── */}
            {progress.length > 0 && (
              <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Users size={14} className="text-[#f59e0b]" />
                  <h3 className="text-sm font-semibold text-white">Leadership Progress</h3>
                  <span className="ml-auto text-[10px] text-[#6e7681]">
                    Target: {COMMAND_TARGET} command roles (PL/PSG) per soldier
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                  {progress.map(p => {
                    const commandMet = p.command_count >= COMMAND_TARGET;
                    const rolesPlayed = Object.keys(p.roles_played).length;
                    return (
                      <div key={p.soldier_id}
                        className="bg-[#0d1117] rounded-md px-3 py-2 flex items-start gap-2.5">
                        {/* Command target indicator */}
                        <div className={`mt-0.5 shrink-0 ${commandMet ? "text-[#3fb950]" : "text-[#30363d]"}`}>
                          <CheckCircle2 size={13} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs text-white truncate">{p.name}</span>
                            <span className={`text-[10px] shrink-0 font-bold ${
                              p.lead_count >= 5 ? "text-[#3fb950]" :
                              p.lead_count >= 3 ? "text-[#f59e0b]" : "text-[#8b949e]"
                            }`}>
                              ×{p.lead_count}
                            </span>
                          </div>

                          {/* Role pills */}
                          <div className="flex flex-wrap gap-1 mt-1">
                            {ROLES.filter(r => (p.roles_played[r] ?? 0) > 0).map(r => (
                              <span key={r}
                                className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                                  r === "PL" || r === "PSG"
                                    ? "bg-[#f59e0b]/20 text-[#f59e0b]"
                                    : "bg-[#21262d] text-[#8b949e]"
                                }`}>
                                {r}×{p.roles_played[r]}
                              </span>
                            ))}
                            {rolesPlayed === 0 && (
                              <span className="text-[9px] text-[#4a5568]">No leads yet</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Swap modal ── */}
      {swapping && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-5 w-80 space-y-4 shadow-2xl">
            <div>
              <h3 className="text-sm font-semibold text-white">Swap Soldier</h3>
              <p className="text-[10px] text-[#8b949e] mt-1">
                Day {swapping.day_number} · {MISSION_LABEL[swapping.mission_type]} · {swapping.role}
              </p>
              <p className="text-[10px] text-[#f59e0b] mt-0.5">
                Current: {swapping.soldier_name ?? "—"}
              </p>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-1">
              {soldiers.map(s => (
                <button
                  key={s.id}
                  onClick={() => confirmSwap(s.id)}
                  disabled={swapLoading}
                  className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                    s.id === swapping.soldier_id
                      ? "bg-[#f59e0b]/20 text-[#f59e0b]"
                      : "text-[#c9d1d9] hover:bg-[#21262d]"
                  }`}
                >
                  {s.rank} {s.name}
                  {s.id === swapping.soldier_id && (
                    <span className="ml-1 text-[9px]">(current)</span>
                  )}
                </button>
              ))}
            </div>
            <div className="flex justify-between">
              <button
                onClick={() => confirmSwap(null)}
                disabled={swapLoading}
                className="text-[11px] text-[#6e7681] hover:text-[#f85149] transition-colors"
              >
                Clear slot
              </button>
              <button
                onClick={() => setSwapping(null)}
                className="px-3 py-1.5 bg-[#21262d] text-[#8b949e] text-xs rounded-md hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
