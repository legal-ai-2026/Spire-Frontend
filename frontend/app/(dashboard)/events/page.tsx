"use client";
import { useEffect, useState } from "react";
import { CalendarCheck, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { TrainingEvent } from "@/types";

const EVENT_TYPES = ["Field Exercise", "Live Fire", "JRTC", "NTC", "Rotation", "Evaluation", "Other"];

const EMPTY_FORM = {
  event_name: "",
  event_type: "Field Exercise",
  event_date: "",
  location: "",
  mission_type: "",
  notes: "",
};

export default function EventsPage() {
  const [events, setEvents]   = useState<TrainingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm]       = useState(EMPTY_FORM);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState("");
  const [deleting, setDeleting] = useState<number | null>(null);

  useEffect(() => {
    api.get<TrainingEvent[]>("/api/v1/events")
      .then(setEvents)
      .finally(() => setLoading(false));
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        event_date:   form.event_date   || undefined,
        location:     form.location     || undefined,
        mission_type: form.mission_type || undefined,
        notes:        form.notes        || undefined,
      };
      const created = await api.post<TrainingEvent>("/api/v1/events", payload);
      setEvents(prev => [created, ...prev]);
      setShowAdd(false);
      setForm(EMPTY_FORM);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    setDeleting(id);
    try {
      await api.delete(`/api/v1/events/${id}`);
      setEvents(prev => prev.filter(ev => ev.id !== id));
    } catch {
      // silently ignore
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-white">Training Events</h1>
          <p className="text-[#8b949e] text-xs mt-0.5">Phase 01 — Data Capture &amp; Training</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1.5 px-3 py-2 bg-[#3fb950] hover:bg-green-600 text-black text-sm font-semibold rounded-md transition-colors"
        >
          <Plus size={14} /> New Event
        </button>
      </div>

      {showAdd && (
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-white mb-4">New Training Event</h2>
          <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Event Name *</label>
              <input
                required
                value={form.event_name}
                onChange={e => setForm(p => ({ ...p, event_name: e.target.value }))}
                placeholder="e.g. JRTC Rotation 25-01"
                className="w-full px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none focus:border-[#3fb950]"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Event Type *</label>
              <select
                value={form.event_type}
                onChange={e => setForm(p => ({ ...p, event_type: e.target.value }))}
                className="w-full px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none focus:border-[#3fb950]"
              >
                {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Date</label>
              <input
                type="date"
                value={form.event_date}
                onChange={e => setForm(p => ({ ...p, event_date: e.target.value }))}
                className="w-full px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none focus:border-[#3fb950] [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Location</label>
              <input
                value={form.location}
                onChange={e => setForm(p => ({ ...p, location: e.target.value }))}
                placeholder="e.g. Fort Johnson, LA"
                className="w-full px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none focus:border-[#3fb950]"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Mission Type</label>
              <input
                value={form.mission_type}
                onChange={e => setForm(p => ({ ...p, mission_type: e.target.value }))}
                placeholder="e.g. Offense, Defense, Recon"
                className="w-full px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none focus:border-[#3fb950]"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Notes</label>
              <input
                value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                className="w-full px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none focus:border-[#3fb950]"
              />
            </div>
            {error && <p className="sm:col-span-2 text-xs text-[#f85149]">{error}</p>}
            <div className="sm:col-span-2 flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-1.5 bg-[#3fb950] hover:bg-green-600 disabled:opacity-50 text-black text-sm font-semibold rounded transition-colors"
              >
                {saving ? "Saving…" : "Create Event"}
              </button>
              <button
                type="button"
                onClick={() => { setShowAdd(false); setForm(EMPTY_FORM); setError(""); }}
                className="px-4 py-1.5 bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] text-sm rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <p className="text-[#8b949e] text-sm">Loading…</p>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <CalendarCheck size={32} className="text-[#30363d] mb-3" />
          <p className="text-[#8b949e] text-sm">No training events yet.</p>
          <p className="text-[#8b949e] text-xs mt-1">Create one above — it will appear in the Evaluate dropdown.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map(ev => (
            <div
              key={ev.id}
              className="flex items-start justify-between gap-4 bg-[#161b22] border border-[#30363d] rounded-lg px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-white">{ev.event_name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-[#21262d] text-[#8b949e] rounded">{ev.event_type}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5">
                  {ev.event_date && <span className="text-[11px] text-[#8b949e]">{ev.event_date}</span>}
                  {ev.location    && <span className="text-[11px] text-[#8b949e]">{ev.location}</span>}
                  {ev.mission_type && <span className="text-[11px] text-[#8b949e]">{ev.mission_type}</span>}
                </div>
                {ev.notes && <p className="mt-1 text-[11px] text-[#8b949e] truncate max-w-prose">{ev.notes}</p>}
              </div>
              <button
                onClick={() => handleDelete(ev.id)}
                disabled={deleting === ev.id}
                className="flex-shrink-0 p-1.5 text-[#8b949e] hover:text-[#f85149] disabled:opacity-40 transition-colors"
                title="Delete event"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
