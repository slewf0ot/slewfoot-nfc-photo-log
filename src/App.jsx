import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

/* ======================= CONFIG ======================= */
const SUPABASE_URL = "https://diuknxnjrheuvzxzkteg.supabase.co"; // <-- set me
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpdWtueG5qcmhldXZ6eHprdGVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA2MTQ4MDQsImV4cCI6MjA3NjE5MDgwNH0.CxvfUSSBabLRTURqWXWXt3bNJoPOFX7j0Xbf-ZNEyj0";               // <-- set me

const TB_CODE = "D98MYP";         // do NOT display this publicly
const BUCKET = "tb-tbb2qbe";       // storage bucket name you created
const PAGE_TITLE = "Travel Bug Photo Log";
const TAG_NICKNAME = "TBB2QBE";    // safe to show (nickname/label)
/* ====================================================== */

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** Compress to JPEG and strip EXIF in-browser */
async function fileToCompressedJpeg(file, maxDim = 1600, quality = 0.8) {
  const img = document.createElement("img");
  img.src = URL.createObjectURL(file);
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
  });
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
  return new File([blob], `${Date.now()}.jpg`, { type: "image/jpeg" });
}

/** Local gate: remember unlock state in localStorage */
function useLocalGate() {
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    const v = localStorage.getItem("tb_gate_unlocked");
    if (v === TB_CODE) setUnlocked(true);
  }, []);
  const unlock = (code) => {
    if (code.trim().toUpperCase() === TB_CODE) {
      localStorage.setItem("tb_gate_unlocked", TB_CODE);
      setUnlocked(true);
      return true;
    }
    return false;
  };
  const lock = () => {
    localStorage.removeItem("tb_gate_unlocked");
    setUnlocked(false);
  };
  return { unlocked, unlock, lock };
}

function timeAgo(iso) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

export default function App() {
  const gate = useLocalGate();
  const [loading, setLoading] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState(null);
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState("");
  const [coords, setCoords] = useState(null);
  const [error, setError] = useState("");
  const [visits, setVisits] = useState([]);
  const fileRef = useRef(null);

  const canSubmit = useMemo(
    () => gate.unlocked && photo && !loading,
    [gate.unlocked, photo, loading]
  );

  useEffect(() => {
    document.title = PAGE_TITLE;
    fetchVisits();
  }, []);

  async function fetchVisits() {
    const { data, error } = await supabase
      .from("tb_visits")
      .select("id, created_at, nickname, message, lat, lon, photo_url")
      .eq("tracking_code", TB_CODE)
      .order("created_at", { ascending: false })
      .limit(60);
    if (!error) setVisits(data || []);
  }

  async function handlePickFile(e) {
    setError("");
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    const compressed = await fileToCompressedJpeg(f);
    setPhoto(compressed);
    setPreview(URL.createObjectURL(compressed));
  }

  function handleGetLocation() {
    setError("");
    if (!navigator.geolocation) {
      setError("Geolocation not supported by your browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      (err) => setError(err.message || "Couldn't get location"),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!photo) return;
    setLoading(true);
    setError("");
    try {
      const fname = `${TB_CODE}/${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}.jpg`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(fname, photo, {
          cacheControl: "3600",
          upsert: false,
          contentType: "image/jpeg",
        });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(fname);

      const payload = {
        tracking_code: TB_CODE,
        nickname: nickname?.trim() || null,
        message: message?.trim() || null,
        lat: coords?.lat ?? null,
        lon: coords?.lon ?? null,
        photo_url: pub.publicUrl,
      };

      const { error: insErr } = await supabase.from("tb_visits").insert(payload);
      if (insErr) throw insErr;

      setNickname("");
      setMessage("");
      setCoords(null);
      setPhoto(null);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      await fetchVisits();
    } catch (err) {
      console.error(err);
      setError(err.message || "Upload failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-gradient-to-b from-slate-50 to-slate-100 text-slate-900">
      <header className="max-w-3xl mx-auto px-4 pt-10 pb-4">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          {PAGE_TITLE}
        </h1>
        <p className="text-slate-600 mt-1">
          Thanks for moving my geocaching Travel Bug{" "}
          <span className="font-semibold">{TAG_NICKNAME}</span> along! Snap a
          quick photo and leave a note below. ✌️
        </p>
      </header>

      <main className="max-w-3xl mx-auto px-4 pb-24">
        {!gate.unlocked && (
          <section className="mb-6 rounded-2xl border border-emerald-200 bg-white shadow-sm">
            <div className="p-4 border-b border-emerald-100">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                Confirm you have the tag
              </h2>
            </div>
            <div className="p-4">
              <GateForm onUnlock={gate.unlock} />
              <p className="text-xs text-slate-500 mt-3">
                We never display the code. This helps prevent virtual logs.
              </p>
            </div>
          </section>
        )}

        <section
          className={[
            "mb-8 rounded-2xl bg-white border shadow-sm",
            gate.unlocked ? "opacity-100" : "opacity-40 pointer-events-none",
          ].join(" ")}
        >
          <div className="p-4 border-b">
            <h2 className="text-lg font-semibold">Add your photo</h2>
          </div>
          <div className="p-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Trail name / nickname (optional)
                </label>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:ring-4 focus:ring-emerald-200"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="e.g., CacheChaser42"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  A short note (optional)
                </label>
                <textarea
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:ring-4 focus:ring-emerald-200"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  placeholder="Where did you find it? Where is it headed?"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleGetLocation}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
                >
                  Add GPS
                </button>
                {coords && (
                  <span className="text-sm text-emerald-700">
                    {coords.lat.toFixed(5)}, {coords.lon.toFixed(5)}
                  </span>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Photo</label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePickFile}
                  className="block w-full rounded-xl border border-slate-200 bg-white file:mr-4 file:rounded-lg file:border-0 file:bg-emerald-600 file:px-3 file:py-2 file:text-white hover:file:bg-emerald-700"
                />
                {preview && (
                  <img
                    src={preview}
                    alt="preview"
                    className="mt-3 w-full rounded-2xl shadow border border-slate-200"
                  />
                )}
                <p className="text-xs text-slate-500 mt-1">
                  We strip EXIF data and compress images for faster uploads.
                </p>
              </div>

              {error && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-2">
                  {error}
                </div>
              )}

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {loading ? "Uploading…" : "Post photo"}
                </button>
                {gate.unlocked && (
                  <button
                    type="button"
                    onClick={gate.lock}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    Lock
                  </button>
                )}
              </div>
            </form>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Recent photos</h2>
            <button
              onClick={fetchVisits}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>

          {visits.length === 0 ? (
            <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-8 text-center text-slate-500">
              No photos yet. Be the first!
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {visits.map((v) => (
                <div
                  key={v.id}
                  className="overflow-hidden rounded-2xl bg-white border border-slate-200 shadow-sm"
                >
                  <img
                    src={v.photo_url}
                    alt="travel bug log"
                    className="w-full h-64 object-cover"
                    loading="lazy"
                  />
                  <div className="p-4">
                    <div className="flex items-center justify-between text-sm">
                      <div className="font-medium">
                        {v.nickname || "Anon cacher"}
                      </div>
                      <div className="text-slate-500">{timeAgo(v.created_at)}</div>
                    </div>
                    {v.message && (
                      <p className="mt-1 text-sm text-slate-700">{v.message}</p>
                    )}
                    {v.lat != null && v.lon != null && (
                      <a
                        className="inline-block text-sm text-emerald-700 underline mt-2"
                        href={`https://maps.google.com/?q=${v.lat},${v.lon}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View on map
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="mt-10 text-center text-sm text-slate-500">
          Travel Bug {TAG_NICKNAME} • Photo Log
        </footer>
      </main>
    </div>
  );
}

/* ---------- Unlock Gate Form ---------- */
function GateForm({ onUnlock }) {
  const [code, setCode] = useState("");
  const [bad, setBad] = useState(false);
  function submit(e) {
    e.preventDefault();
    const ok = onUnlock(code);
    setBad(!ok);
  }
  return (
    <form onSubmit={submit} className="grid gap-3">
      <label className="block text-sm font-medium">
        Enter the 6-character tracking code printed on the tag
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={6}
          placeholder="XXXXXX"
          className={[
            "mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-4",
            bad
              ? "border-red-300 focus:ring-red-200"
              : "border-slate-200 focus:ring-emerald-200",
          ].join(" ")}
        />
      </label>
      {bad && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-2">
          That code didn’t match. Please check the tag.
        </div>
      )}
      <button
        type="submit"
        className="rounded-xl bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700"
      >
        Unlock
      </button>
    </form>
  );
}
