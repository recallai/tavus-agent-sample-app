"use client";
import { useEffect, useRef, useState } from "react";
import type { DailyCall } from "@daily-co/daily-js";
import { avatarErrorMessage } from "../../lib/client";

export default function Avatar() {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState("Connecting avatar…");
  useEffect(() => {
    let disposed = false;
    let call: DailyCall | undefined;
    let stopped = false;
    let lastTracks: string | undefined;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const conversationId = fragment.get("conversation_id");
    const palId = fragment.get("temporary_pal_id");
    const roomUrl = fragment.get("conversation_url");
    function endRoom() {
      if (!conversationId || stopped) return;
      stopped = true;
      void fetch(`/api/conversations/${encodeURIComponent(conversationId)}${palId ? `?temporary_pal_id=${encodeURIComponent(palId)}` : ""}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
    }
    function stop() {
      if (call) { endRoom(); void call.destroy().catch(() => undefined); }
    }
    function attachTracks() {
      if (disposed || !call || !video.current) return;
      const remote = Object.values(call.participants()).filter(participant => !participant.local);
      const owner = remote.find(participant => participant.tracks.video.state === "playable");
      const videoTrack = owner?.tracks.video.persistentTrack || owner?.tracks.video.track;
      const audioOwner = owner?.tracks.audio.state === "playable" ? owner : remote.find(participant => participant.tracks.audio.state === "playable");
      const audioTrack = audioOwner?.tracks.audio.persistentTrack || audioOwner?.tracks.audio.track;
      const tracks = [videoTrack, audioTrack].filter((track): track is MediaStreamTrack => Boolean(track && track.readyState === "live"));
      const signature = tracks.map(track => track.id).join("|");
      if (signature === lastTracks) return;
      lastTracks = signature;
      video.current.srcObject = tracks.length ? new MediaStream(tracks) : null;
      if (!tracks.length) { setStatus("Waiting for avatar…"); return; }
      void video.current.play().then(() => { if (!disposed) setStatus(""); }).catch(() => { if (!disposed) setStatus("Audio playback was blocked."); });
    }
    async function start() {
      if (!roomUrl || !conversationId) {
        setStatus("No avatar session is attached to this page. Launch a bot from the local app.");
        return;
      }
      try {
        const url = new URL(roomUrl);
        if (url.protocol !== "https:" || !url.hostname.endsWith(".daily.co") || url.username || url.password) throw new Error("Invalid Tavus room URL.");
        const { default: Daily } = await import("@daily-co/daily-js");
        if (disposed) return;
        call = Daily.createCallObject({ videoSource: false, audioSource: true, startVideoOff: true, startAudioOff: false });
        for (const event of ["participant-joined", "participant-updated", "participant-left", "track-started", "track-stopped"] as const) call.on(event, attachTracks);
        call.on("error", event => {
          if (!disposed) {
            const message = avatarErrorMessage(event);
            setStatus(message);
          }
          stop();
        });
        call.on("left-meeting", () => { if (!disposed && !stopped) setStatus("Avatar session ended."); endRoom(); });
        setStatus("Joining avatar media room…");
        await call.join({ url: roomUrl, userName: "Recall avatar media" });
        if (disposed) { stop(); return; }
        attachTracks();
      } catch (error) {
        if (disposed) return;
        const message = avatarErrorMessage(error);
        endRoom(); stop();
        setStatus(message);
      }
    }
    void start();
    window.addEventListener("pagehide", stop);
    return () => { disposed = true; window.removeEventListener("pagehide", stop); stop(); };
  }, []);
  return <main className="avatar">
    <video ref={video} autoPlay playsInline aria-label="Live avatar" />
    {status && <div className="status" role="status">{status}</div>}
  </main>;
}
