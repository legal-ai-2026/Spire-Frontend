"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search, User } from "lucide-react";
import { api } from "@/lib/api";
import type { Soldier } from "@/types";

const SKILL_LABELS: Record<string, string> = {
  leadership: "Lead", decision_making: "Dec", stress_tolerance: "Str",
  tactical: "Tac", communication: "Com",
};

function SkillBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? "bg-[#3fb950]" : pct >= 40 ? "bg-[#f59e0b]" : "bg-[#f85149]";
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 bg-[#30363d] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-[#8b949e] w-5 text-right">{pct}</span>
    </div>
  );
}

export default function SoldiersPage() {
  const [soldiers, setSoldiers] = useState<Soldier[]>([]);
  const [search, setSearch]     = useState("");
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);
  const [form, setForm]         = useState({
    service_number: "", rank: "SPC", name: "", unit: "", mos: "", leader_type: "rifleman",
    decision_style: "methodical",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");

  useEffect(() => {
    api.get<Soldier[]>("/api/v1/soldiers?active_only=false")
      .then(setSoldiers)
      .finally(() => setLoading(false));
  }, []);

  const filtered = soldiers.filter(s =>
    `${s.rank} ${s.name} ${s.unit} ${s.mos}`.toLowerCase().includes(search.toLowerCase())
  );

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const created = await api.post<Soldier>("/api/v1/soldiers", form);
      setSoldiers(prev => [created, ...prev]);
      setShowAdd(false);
      setForm({ service_number: "", rank: "SPC", name: "", unit: "", mos: "", leader_type: "rifleman", decision_style: "methodical" });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-white">Soldier Roster</h1>
          <p className="text-[#8b949e] text-xs mt-0.5">Phase 01 — Data Capture & Training</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1.5 px-3 py-2 bg-[#3fb950] hover:bg-green-600 text-black text-sm font-semibold rounded-md transition-colors"
        >
          <Plus size={14} /> Add Soldier
        </button>
      </div>

      {/* Add Form */}
      {showAdd && (
        <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-white mb-4">New Soldier</h2>
          <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { id: "service_number", label: "Service #", required: true },
              { id: "name", label: "Name", required: true },
              { id: "unit", label: "Unit" },
              { id: "mos", label: "MOS" },
            ].map(field => (
              <div key={field.id}>
                <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">{field.label}</label>
                <input
                  required={field.required}
                  value={(form as Record<string, string>)[field.id]}
                  onChange={e => setForm(p => ({ ...p, [field.id]: e.target.value }))}
                  className="w-full px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none focus:border-[#3fb950]"
                />
              </div>
            ))}
            <div>
              <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Rank</label>
              <select
                value={form.rank}
                onChange={e => setForm(p => ({ ...p, rank: e.target.value }))}
                className="w-full px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none"
              >
                {["PVT","PV2","PFC","SPC","CPL","SGT","SSG","SFC","MSG","1SG","SGM","CSM","WO1","CW2","CW3","CW4","CW5","2LT","1LT","CPT","MAJ","LTC","COL"].map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Decision Style</label>
              <select
                value={form.decision_style}
                onChange={e => setForm(p => ({ ...p, decision_style: e.target.value }))}
                className="w-full px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-sm text-white focus:outline-none"
              >
                {["methodical","aggressive","adaptive","defensive"].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            {error && <p className="col-span-2 text-[#f85149] text-xs">{error}</p>}
            <div className="col-span-2 flex gap-2">
              <button type="submit" disabled={saving}
                className="px-4 py-2 bg-[#3fb950] text-black text-sm font-semibold rounded-md disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={() => setShowAdd(false)}
                className="px-4 py-2 bg-[#21262d] text-[#8b949e] text-sm rounded-md hover:text-white">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8b949e]" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, rank, unit, MOS…"
          className="w-full pl-9 pr-4 py-2 bg-[#161b22] border border-[#30363d] rounded-md text-sm text-white placeholder-[#8b949e] focus:outline-none focus:border-[#f59e0b]"
        />
      </div>

      {/* Table */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#30363d]">
                {["Soldier", "Unit / MOS", "Decision Style", "Leadership", "Decision", "Stress", "Tactical", "Comm", ""].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] text-[#8b949e] uppercase tracking-wider font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#30363d]">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-[#8b949e]">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-[#8b949e]">No soldiers found</td></tr>
              ) : filtered.map(s => (
                <tr key={s.id} className="hover:bg-[#21262d] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${s.is_active ? "bg-[#3fb950]" : "bg-[#30363d]"}`} />
                      <div>
                        <div className="text-white font-medium">{s.rank} {s.name}</div>
                        <div className="text-[10px] text-[#8b949e]">{s.service_number}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#8b949e] text-xs">
                    {s.unit}<br />{s.mos}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] px-2 py-0.5 bg-[#21262d] rounded text-[#8b949e] capitalize">
                      {s.decision_style}
                    </span>
                  </td>
                  {(["leadership","decision_making","stress_tolerance","tactical","communication"] as const).map(dim => (
                    <td key={dim} className="px-4 py-3 w-20">
                      <SkillBar value={s.skill_vector[dim]} />
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <Link href={`/soldiers/${s.id}`}
                      className="text-xs text-[#f59e0b] hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
