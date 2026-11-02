// Referee whistle sound embedded as a data URI (mp3, mono, ~0.3 s).
// Usage: import { playWhistle, unlockAudio, setMuted } from "./whistle";

export const WHISTLE_DATA_URI = "data:audio/mpeg;base64,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TaafC//Et6UyOQ6tBplipA8eWlS3p8Vf0/H9afwOnZVu7jxg8sWZMrd/E6xSFEp3h5eZdAA4ABDcJ2F2sOf53dU0BvNnHYAgmYlErl2NJT//44frtK/7CEbDRbLKAq0YtBJR9oIQvzT4d09Q9fXP19vY6O0tdjguUC68Vq+VrmYavmOeEnplGlOaVY4QiRFiKFyauciEfqLZK2tkUKmqb70///vyD//7cMQ7gA8tf1nsoFkBz6SrOPyeiFjxSvFxUPCAEAAjYXyWPkSeJ4n+ikizlhYmA2zmoxsrm3tXzif/9OtEEARhworBGoMtHTjzSb2Dtb15nf/o1L2HHiOYKAmEwBxYaljUcxiSt/z8xifY9TR5xoIw6NUcudv2T5tkrrRDxq5wkY2xuvVpSssBTwcqeZyblXcAAAFejoM4lkbeRx5ZLWXUku5B9NKpbUltibsXatqr/d3IBWWVHDODOuseJMZ8q9G/My1yf1ZnWf3/897v2/DtI5I9ICgGwf2ttyTXmVE7r/vNtOGlKe6czLlg8qa6ydmXbl1Lu2s/y/0+We8GBOHHuaI9WWvVjIgBnJiouGcwAsQAcKlNxDDrShcS+QkQp5FGxx3HJmiblqpF7LMjgd8EwQGQIAYFGO7/+3LEVoCP0R1XzKzYgfIma3qfQAEDBHANCkFKAwAXDczu+mr9a3Xb6zdMvHCyohpBVS8y1qZFVmU/s9VBNzyVBGxfTMj9Bmd/sm37/6k0Uk0Hc8oGVdMIBtP//Jd2l5jxFLu1hkRjdzUgAADECEABEjRFBtJ9S56S4KX69l0JxTr6s3hxTBSxehgyUWZ0hMUi3YuVCoEZEwdVhgZDbdp6TKQ41XNGjOMGMDxlrMRI6u4RQMOjbwunXlDkNNYPp35JKqd2ZmW/9EwFRZU78SqWNUZY0K5vUqmrUrqS19Ivyhd+VxqVSKGMZTuls1eSqhv32ay2Bpf8ppIzBsSf+rP1KTWW9bq7xyt6pefy1UlF/Gtzdi3fu3Z21SfrLXcfx5vnZvX/27YpZXevf/2KTdPjb1PVpjl63ep62v/7cMRrgB3Jj1PZrYAB6Z1gQ5KQAMt63jvlYsOf//hYEjgRC58cEAH5VEt7LQoWcqX/9oUKGBEGmVhUKhU1aEhFQaNFQCgBEqQWFKGNEQqJpWsiIhUTNKikMvIRSSs1KUvLbVZxZFiyJE1sUKHYsxqW3HxjGOUsiyTUt8f//KUvFkCgqdER4RToiUDR4qdEruCoaLHgaDvyp0SgrBpR7qPQVWGvxFDtTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU==";

let audio: HTMLAudioElement | null = null;
let muted = false;
let unlocked = false;
let unlocking: Promise<void> | null = null;

try {
  muted = localStorage.getItem("muted") === "1";
} catch {
  /* storage not available */
}

function getAudio(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  if (!audio) {
    audio = new Audio(WHISTLE_DATA_URI);
    audio.preload = "auto";
  }
  return audio;
}

/** Call once from the first user tap (for example the Play button) so mobile browsers allow audio. */
export function unlockAudio(): void {
  if (unlocked || unlocking) return;
  const a = getAudio();
  if (!a) return;
  try {
    a.muted = true;
    unlocking = a
      .play()
      .then(() => {
        a.pause();
        a.currentTime = 0;
        unlocked = true;
      })
      .catch(() => {
        /* blocked: the game carries on without the whistle */
      })
      .finally(() => {
        a.muted = false;
        unlocking = null;
      });
  } catch {
    a.muted = false;
    unlocking = null;
  }
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem("muted", value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function isMuted(): boolean {
  return muted;
}

/** Plays the whistle. Resolves when it ends (or right away if muted or unavailable). Never rejects. */
export async function playWhistle(): Promise<void> {
  // If the unlock tap is still settling, wait for it so it cannot pause this whistle.
  if (unlocking) await unlocking;
  return new Promise((resolve) => {
    const a = getAudio();
    if (!a || muted) return resolve();
    try {
      a.muted = false;
      a.currentTime = 0;
      a.onended = () => resolve();
      a.play().catch(() => resolve());
      setTimeout(resolve, 1500); // safety timeout so the round never gets stuck
    } catch {
      resolve();
    }
  });
}
