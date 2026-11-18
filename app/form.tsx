"use client";

import { useRef, useState, type FormEvent } from "react";
import { readApiJson } from "../lib/client";
import { wakePhrases } from "../lib/wake-words";

export default function AgentForm({ existingPal }: { existingPal: boolean }) {
  const [prompt, setPrompt] = useState("you are a meeting assistant");
  const [botName, setBotName] = useState("Alex");
  const [wakeWords, setWakeWords] = useState(true);
  const phrases = wakePhrases(botName);
  const [meetingUrl, setMeetingUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  async function launch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/bots", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meeting_url: meetingUrl.trim(), bot_name: botName.trim(), ...(existingPal ? {} : { system_prompt: prompt.trim(), wake_words_enabled: wakeWords }) }),
      });
      await readApiJson(response, "POST /api/bots");
      setMessage(`${botName.trim()} is joining. Admit the bot if your meeting has a waiting room.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not launch the bot. Check the provider dashboard before retrying.");
    } finally { inFlight.current = false; setBusy(false); }
  }

  return <main className="sample">
    <section className="panel" aria-labelledby="app-title">
      <header><h1 id="app-title">Live Agent Sample App</h1></header>
      <p className="pal-note">{existingPal ? "Using the existing PAL set in TAVUS_PAL_ID. Its saved prompt, face, and wake words are used. This app will not modify or delete it." : <>Each launch creates a new temporary Tavus PAL. Set <code>TAVUS_PAL_ID</code> in <code>.env</code> to use an existing PAL instead.</>}</p>
      <form onSubmit={launch}>
        <fieldset disabled={busy}>
          {!existingPal && <>
          <label htmlFor="system-prompt">System prompt</label>
          <textarea id="system-prompt" required maxLength={16000} value={prompt} onChange={event => setPrompt(event.target.value)} />
          </>}
          <label htmlFor="bot-name">Bot name</label>
          <input id="bot-name" required maxLength={100} value={botName} onChange={event => setBotName(event.target.value)} />
          {!existingPal && <div className="wake-control">
            <div><label htmlFor="wake-words">Wake words</label><p id="wake-help">{wakeWords ? `“${phrases.wake_phrase}” to wake · “${phrases.sleep_phrase}” to sleep` : "No wake phrase required"}</p></div>
            <button id="wake-words" className="wake-switch" type="button" role="switch" aria-checked={wakeWords} aria-describedby="wake-help" onClick={() => setWakeWords(value => !value)}><span /></button>
          </div>}
          <label htmlFor="meeting-url">Meeting URL</label>
          <input id="meeting-url" type="url" required pattern="https://.*" placeholder="https://meet.google.com/…" value={meetingUrl} onChange={event => setMeetingUrl(event.target.value)} />
          <button className="primary" type="submit" disabled={busy || (!existingPal && !prompt.trim()) || !botName.trim() || !meetingUrl.trim()}>{busy ? "Joining…" : "Send bot to call"}</button>
        </fieldset>
      </form>
      {error && <p className="feedback error" role="alert">{error}</p>}
      {message && <p className="feedback success" role="status">{message}</p>}
    </section>
  </main>;
}
