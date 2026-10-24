// Rest Timer Manager with Web Audio chime, background keepalive audio, Wake Lock, and Notification support
class RestTimerManager {
  constructor(app) {
    this.app = app;
    this.duration = 90;
    this.remaining = 0;
    this.interval = null;
    this.endTime = null;
    this.pausedRemainingMs = null;
    this.isPaused = false;
    this.isRunning = false;
    this.currentExerciseName = "";
    this.audioCtx = null;
    this.wakeLock = null;
    this.worker = null;
    this.initAudioUnlock();
    this.initWorker();
    this.initVisibilityListener();
  }

  initAudioUnlock() {
    const unlock = () => {
      try {
        const AudioClass = window.AudioContext || window.webkitAudioContext;
        if (!this.audioCtx && AudioClass) {
          this.audioCtx = new AudioClass();
        }
        if (this.audioCtx && this.audioCtx.state === "suspended") {
          this.audioCtx.resume();
        }
      } catch (e) {
        console.warn("Audio context unlock:", e);
      }
      window.removeEventListener("click", unlock);
      window.removeEventListener("touchstart", unlock);
    };
    window.addEventListener("click", unlock, { passive: true });
    window.addEventListener("touchstart", unlock, { passive: true });
  }

  initWorker() {
    try {
      const code = `
        let t = null;
        self.onmessage = function(e) {
          if (e.data === 'start') {
            if (t) clearInterval(t);
            t = setInterval(() => self.postMessage('tick'), 250);
          } else if (e.data === 'stop') {
            if (t) clearInterval(t);
            t = null;
          }
        };
      `;
      const blob = new Blob([code], { type: "application/javascript" });
      this.worker = new Worker(URL.createObjectURL(blob));
      this.worker.onmessage = () => {
        this.onTick();
      };
    } catch (err) {
      this.worker = null;
    }
  }

  initVisibilityListener() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        if (this.isRunning && !this.isPaused) {
          this.requestWakeLock();
          this.onTick();
        }
      }
    });
  }

  async requestWakeLock() {
    if ("wakeLock" in navigator && !this.wakeLock) {
      try {
        this.wakeLock = await navigator.wakeLock.request("screen");
        this.wakeLock.addEventListener("release", () => {
          this.wakeLock = null;
        });
      } catch (err) {
        // May fail if low power mode or battery saver is active
      }
    }
  }

  async releaseWakeLock() {
    if (this.wakeLock) {
      try {
        await this.wakeLock.release();
      } catch (err) {}
      this.wakeLock = null;
    }
  }

  playChime() {
    // 1. Play HTML5 Audio element for audio chime
    try {
      const chimeAudio = document.getElementById("rest-chime-audio");
      if (chimeAudio) {
        chimeAudio.currentTime = 0;
        chimeAudio.play().catch(() => {});
      }
    } catch (err) {}

    // 2. Play Web Audio API synthesized chime
    try {
      const AudioClass = window.AudioContext || window.webkitAudioContext;
      if (!this.audioCtx && AudioClass) {
        this.audioCtx = new AudioClass();
      }
      if (this.audioCtx) {
        if (this.audioCtx.state === "suspended") {
          this.audioCtx.resume();
        }
        const now = this.audioCtx.currentTime;
        const playTone = (freq, offset, duration) => {
          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now + offset);
          gain.gain.setValueAtTime(0.3, now + offset);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
          osc.connect(gain);
          gain.connect(this.audioCtx.destination);
          osc.start(now + offset);
          osc.stop(now + offset + duration);
        };

        // Ascending 3-tone chime: D5 (587Hz) -> A5 (880Hz) -> D6 (1174Hz)
        playTone(587.33, 0.0, 0.18);
        playTone(880.00, 0.22, 0.22);
        playTone(1174.66, 0.48, 0.55);
      }
    } catch (err) {
      console.warn("Audio playback not supported:", err);
    }

    // 3. Trigger haptic vibration on mobile
    if ("vibrate" in navigator) {
      try {
        navigator.vibrate([250, 100, 250, 100, 450]);
      } catch (err) {
        // Ignore vibration errors
      }
    }

    // 4. Send background notification to Service Worker
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: "REST_FINISHED_NOTIFICATION",
            title: "Rest Complete",
            body: `Time for your next set of ${this.currentExerciseName || "Exercise"}`
          });
        }
      }
    } catch (err) {}
  }

  start(seconds, exerciseName = "Exercise") {
    this.stop();
    this.duration = Math.max(5, seconds);
    this.remaining = this.duration;
    this.endTime = Date.now() + this.duration * 1000;
    this.pausedRemainingMs = null;
    this.isPaused = false;
    this.isRunning = true;
    this.currentExerciseName = exerciseName;

    // Start background audio keepalive to retain audio session on mobile screen off
    try {
      const keepaliveAudio = document.getElementById("rest-keepalive-audio");
      if (keepaliveAudio) {
        keepaliveAudio.currentTime = 0;
        keepaliveAudio.play().catch(() => {});
      }
    } catch (err) {}

    // Request wake lock to prevent screen sleep while resting
    this.requestWakeLock();

    // Request notification permission if not yet decided
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    const card = document.getElementById("active-rest-card");
    if (card) {
      card.classList.remove("hidden", "rest-finished");
    }

    const title = document.getElementById("rest-card-title");
    if (title) {
      title.textContent = `Resting (${exerciseName})`;
    }

    const pauseBtn = document.getElementById("btn-rest-pause");
    if (pauseBtn) {
      pauseBtn.textContent = "Pause";
    }

    this.updateUI();

    // Start worker ticker and fallback interval
    if (this.worker) {
      this.worker.postMessage("start");
    }
    this.interval = setInterval(() => {
      this.onTick();
    }, 500);
  }

  onTick() {
    if (!this.isRunning || this.isPaused || !this.endTime) return;

    const remainingMs = this.endTime - Date.now();
    this.remaining = Math.max(0, Math.ceil(remainingMs / 1000));
    this.updateUI();

    if (remainingMs <= 0) {
      this.stop();
      this.onFinish();
    }
  }

  addSeconds(secs) {
    this.duration = Math.max(this.duration + secs, 5);
    if (this.isPaused) {
      this.pausedRemainingMs = Math.max(0, (this.pausedRemainingMs || 0) + secs * 1000);
      this.remaining = Math.ceil(this.pausedRemainingMs / 1000);
    } else {
      this.endTime = (this.endTime || Date.now()) + secs * 1000;
      this.remaining = Math.max(0, Math.ceil((this.endTime - Date.now()) / 1000));
    }
    this.updateUI();
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      this.pausedRemainingMs = Math.max(0, (this.endTime || Date.now()) - Date.now());
      this.releaseWakeLock();
      const keepaliveAudio = document.getElementById("rest-keepalive-audio");
      if (keepaliveAudio) keepaliveAudio.pause();
    } else {
      this.endTime = Date.now() + (this.pausedRemainingMs || this.remaining * 1000);
      this.pausedRemainingMs = null;
      this.requestWakeLock();
      const keepaliveAudio = document.getElementById("rest-keepalive-audio");
      if (keepaliveAudio) keepaliveAudio.play().catch(() => {});
    }

    const pauseBtn = document.getElementById("btn-rest-pause");
    if (pauseBtn) {
      pauseBtn.textContent = this.isPaused ? "Resume" : "Pause";
    }
    const card = document.getElementById("active-rest-card");
    if (card) {
      card.style.opacity = this.isPaused ? "0.75" : "1";
    }
  }

  skip() {
    this.stop();
    this.isRunning = false;
    const card = document.getElementById("active-rest-card");
    if (card) {
      card.classList.add("hidden");
    }
    const globalPill = document.getElementById("global-rest-pill");
    if (globalPill) {
      globalPill.classList.add("hidden");
    }
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.worker) {
      this.worker.postMessage("stop");
    }
    this.releaseWakeLock();
    const keepaliveAudio = document.getElementById("rest-keepalive-audio");
    if (keepaliveAudio) {
      keepaliveAudio.pause();
      keepaliveAudio.currentTime = 0;
    }
    this.isRunning = false;
    this.endTime = null;
    this.pausedRemainingMs = null;
  }

  updateUI() {
    const mins = Math.floor(Math.max(0, this.remaining) / 60);
    const secs = Math.max(0, this.remaining) % 60;
    const formatted = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

    const digits = document.getElementById("rest-countdown-display");
    if (digits) {
      digits.textContent = formatted;
    }

    const globalPill = document.getElementById("global-rest-pill");
    const globalTime = document.getElementById("global-rest-time");
    if (globalPill && globalTime) {
      if (this.app.currentView !== "view-logger") {
        globalPill.classList.remove("hidden");
      } else {
        globalPill.classList.add("hidden");
      }
      globalTime.textContent = formatted;
    }

    const progressBar = document.getElementById("rest-progress-bar");
    if (progressBar && this.duration > 0) {
      const pct = Math.max(0, Math.min(100, (this.remaining / this.duration) * 100));
      progressBar.style.width = `${pct}%`;
    }
  }

  onFinish() {
    this.playChime();
    this.isRunning = false;

    const digits = document.getElementById("rest-countdown-display");
    if (digits) digits.textContent = "00:00";

    const progressBar = document.getElementById("rest-progress-bar");
    if (progressBar) progressBar.style.width = "0%";

    const card = document.getElementById("active-rest-card");
    if (card) {
      card.classList.add("rest-finished");
      const title = document.getElementById("rest-card-title");
      if (title) title.textContent = "Rest Complete! Ready for next set";
      setTimeout(() => {
        card.classList.remove("rest-finished");
        card.classList.add("hidden");
      }, 4500);
    }

    const globalPill = document.getElementById("global-rest-pill");
    if (globalPill) {
      globalPill.classList.add("hidden");
    }

    if (this.app && this.app.showToast) {
      this.app.showToast(`Rest Finished! Time for your next set of ${this.currentExerciseName}`);
    }
  }
}

class WorkoutApp {
  constructor() {
    this.currentView = "view-workout";
    this.activeSession = null;
    this.activeLog = null;
    this.timerInterval = null;
    this.startTime = null;
    this.currentFilterMuscle = "all";
    this.currentExerciseRestSeconds = 90;
    this.restTimer = new RestTimerManager(this);
    this.isSavingSet = false;
    this.editingSetId = null;
    this.lastSaveTime = 0;
  }

  async init() {
    await localDB.init();
    syncManager.init();

    // Clean up duplicates and re-link local logs to canonical IDs
    await this.deduplicateExercises();

    // Pull catalog from server if connected
    await syncManager.pullExercises();
    await syncManager.pullHistory();
    await syncManager.syncNow();

    // Deduplicate once more after sync and seed defaults if empty
    await this.deduplicateExercises();
    await this.seedDefaultExercisesIfEmpty();
    await this.backfillLogMuscleGroups();

    // Restore active workout or create a fresh draft
    await this.restoreOrCreateActiveSession();

    // Bind event listeners
    this.bindEvents();

    // Initial render
    this.populateMuscleGroupDropdowns();
    this.renderWorkoutOverview();
    this.renderHistory();
    this.renderCatalog();
    this.updateDiagnostics();

    // Restore previous active tab or route from URL hash or localStorage
    const currentHash = window.location.hash;
    const HASH_TO_VIEW = {
      "#workout": "view-workout",
      "#history": "view-history",
      "#exercises": "view-exercises",
      "#insights": "view-insights",
      "#logger": "view-logger"
    };
    const savedView = localStorage.getItem("active_view");
    const initialView = HASH_TO_VIEW[currentHash] || savedView || "view-workout";

    if (initialView === "view-logger") {
      const logId = localStorage.getItem("active_log_id");
      if (logId) {
        localDB.get("exercise_logs", logId).then((log) => {
          if (log) {
            this.openExerciseLogger(log, false);
          } else {
            this.switchView("view-workout", false);
          }
        }).catch(() => {
          this.switchView("view-workout", false);
        });
      } else {
        this.switchView("view-workout", false);
      }
    } else {
      this.switchView(initialView, false);
    }

    // Listen for sync completion events to update UI
    window.addEventListener("workout-sync-complete", async () => {
      await this.deduplicateExercises();
      this.renderHistory();
      this.renderWorkoutOverview();
      this.renderCatalog();
      this.updateDiagnostics();
    });
  }

  // Scans local IndexedDB exercises and removes duplicates with identical normalized names,
  // while safely re-linking existing exercise_logs to the canonical exercise record.
  async deduplicateExercises() {
    try {
      const exercises = await localDB.getAll("exercises");
      if (!exercises || exercises.length === 0) return;

      const logs = await localDB.getAll("exercise_logs");

      // Canonical UUID lookup map for standard seed exercises
      const canonicalIds = new Set([
        "fff977dc-7398-4ce4-8f1c-37b0059d281f", // Barbell Bench Press
        "bde3755e-bf56-46f4-8b2a-5b6674ec4a13", // Incline Dumbbell Press
        "d00f2496-de33-4fc2-b79e-d5946ae4236f", // Barbell Squat
        "f0316b31-551c-49c4-a5f8-26ad69e051fc", // Romanian Deadlift
        "410d3edd-0652-47b8-9338-88580d0947c3", // Barbell Bent-Over Row
        "f5aed38f-f2a8-4a7f-ad4f-e63e0dbe4c19", // Lat Pulldown
        "b7c17920-ff5b-4982-9aa5-9edd44ac0379", // Overhead Dumbbell Press
        "c85c9de1-8ffe-4d46-b2c2-90ade493f930", // Lateral Raise
        "84e2224d-1a66-4cb9-82ff-7638b22d4539", // Dumbbell Bicep Curl
        "88ff7d7c-ea65-4d8e-9120-f7cc04c40479"  // Cable Tricep Pushdown
      ]);

      // Remove any leftover placeholder "Exercise (uuid)" items
      for (const ex of exercises) {
        if (ex.name && ex.name.startsWith("Exercise (")) {
          await localDB.delete("exercises", ex.id);
        }
      }

      // Re-read after placeholder cleanup
      const activeExercises = await localDB.getAll("exercises");

      // Group exercises by normalized lowercase name
      const groups = new Map();
      for (const ex of activeExercises) {
        if (!ex.name) continue;
        const key = ex.name.trim().toLowerCase();
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key).push(ex);
      }

      for (const [key, group] of groups.entries()) {
        if (group.length <= 1) continue;

        // Choose canonical record: prioritize known canonical ID, otherwise the first record
        let canonical = group.find((ex) => canonicalIds.has(ex.id)) || group[0];

        // For all duplicate records, remap foreign keys and delete the duplicate
        for (const duplicate of group) {
          if (duplicate.id === canonical.id) continue;

          for (const log of logs) {
            if (log.exercise_id === duplicate.id) {
              log.exercise_id = canonical.id;
              log.exercise_name = canonical.name;
              log.target_muscle_group = canonical.target_muscle_group || log.target_muscle_group;
              await localDB.put("exercise_logs", log);
            }
          }

          await localDB.delete("exercises", duplicate.id);
        }
      }
    } catch (err) {
      console.warn("Could not deduplicate exercises:", err);
    }
  }

  // Backfills missing target_muscle_group on existing exercise_logs from exercise catalog or heuristics
  async backfillLogMuscleGroups() {
    try {
      const logs = await localDB.getAll("exercise_logs");
      if (!logs || logs.length === 0) return;
      const exercises = await localDB.getAll("exercises");
      const byId = new Map();
      const byName = new Map();
      for (const ex of exercises) {
        if (ex.id) {
          byId.set(String(ex.id), ex);
          byId.set(String(ex.id).replace(/-/g, "").toLowerCase(), ex);
        }
        if (ex.name) {
          byName.set(ex.name.trim().toLowerCase(), ex);
        }
      }

      for (const log of logs) {
        let changed = false;
        let ex = null;
        if (log.exercise_id) {
          ex = byId.get(String(log.exercise_id)) || byId.get(String(log.exercise_id).replace(/-/g, "").toLowerCase());
        }
        if (!ex && log.exercise_name) {
          ex = byName.get(log.exercise_name.trim().toLowerCase());
          if (ex) {
            log.exercise_id = ex.id;
            changed = true;
          }
        }
        if (ex && (!log.exercise_name || log.exercise_name === "Exercise")) {
          log.exercise_name = ex.name;
          changed = true;
        }

        const candidateName = log.exercise_name || (ex ? ex.name : "");
        const expectedMuscle = (ex && ex.target_muscle_group && ex.target_muscle_group !== "Other")
          ? ex.target_muscle_group
          : (localDB.inferMuscleGroup ? localDB.inferMuscleGroup(candidateName) : "Other");

        if (expectedMuscle && expectedMuscle !== "Other" && log.target_muscle_group !== expectedMuscle) {
          log.target_muscle_group = expectedMuscle;
          changed = true;
        }
        if (changed) {
          await localDB.put("exercise_logs", log);
        }
      }
    } catch (e) {
      console.warn("Backfill log muscle groups notice:", e);
    }
  }

  // Ensures user has baseline exercises even on first run completely offline
  async seedDefaultExercisesIfEmpty() {
    const existing = await localDB.getAll("exercises");
    if (existing.length === 0) {
      const defaults = [
        { id: "fff977dc-7398-4ce4-8f1c-37b0059d281f", name: "Barbell Bench Press", target_muscle_group: "Chest", default_equipment: "Barbell" },
        { id: "bde3755e-bf56-46f4-8b2a-5b6674ec4a13", name: "Incline Dumbbell Press", target_muscle_group: "Chest", default_equipment: "Dumbbell" },
        { id: "d00f2496-de33-4fc2-b79e-d5946ae4236f", name: "Barbell Squat", target_muscle_group: "Quads", default_equipment: "Barbell" },
        { id: "f0316b31-551c-49c4-a5f8-26ad69e051fc", name: "Romanian Deadlift", target_muscle_group: "Hamstrings", default_equipment: "Barbell" },
        { id: "410d3edd-0652-47b8-9338-88580d0947c3", name: "Barbell Bent-Over Row", target_muscle_group: "Back", default_equipment: "Barbell" },
        { id: "f5aed38f-f2a8-4a7f-ad4f-e63e0dbe4c19", name: "Lat Pulldown", target_muscle_group: "Back", default_equipment: "Cable" },
        { id: "b7c17920-ff5b-4982-9aa5-9edd44ac0379", name: "Overhead Dumbbell Press", target_muscle_group: "Shoulders", default_equipment: "Dumbbell" },
        { id: "c85c9de1-8ffe-4d46-b2c2-90ade493f930", name: "Lateral Raise", target_muscle_group: "Shoulders", default_equipment: "Dumbbell" },
        { id: "84e2224d-1a66-4cb9-82ff-7638b22d4539", name: "Dumbbell Bicep Curl", target_muscle_group: "Biceps", default_equipment: "Dumbbell" },
        { id: "88ff7d7c-ea65-4d8e-9120-f7cc04c40479", name: "Cable Tricep Pushdown", target_muscle_group: "Triceps", default_equipment: "Cable" }
      ];
      for (const ex of defaults) {
        await localDB.put("exercises", ex);
      }
    } else {
      // Migrate existing local exercises from coarse 'Arms'/'Legs' to granular groups, and infer if Other
      for (const ex of existing) {
        let updated = false;
        if (ex.name === "Dumbbell Bicep Curl" && ex.target_muscle_group === "Arms") {
          ex.target_muscle_group = "Biceps";
          updated = true;
        } else if (ex.name === "Cable Tricep Pushdown" && ex.target_muscle_group === "Arms") {
          ex.target_muscle_group = "Triceps";
          updated = true;
        } else if (ex.name === "Barbell Squat" && ex.target_muscle_group === "Legs") {
          ex.target_muscle_group = "Quads";
          updated = true;
        } else if (ex.name === "Romanian Deadlift" && ex.target_muscle_group === "Legs") {
          ex.target_muscle_group = "Hamstrings";
          updated = true;
        }

        if ((!ex.target_muscle_group || ex.target_muscle_group === "Other") && localDB.inferMuscleGroup) {
          const inferred = localDB.inferMuscleGroup(ex.name);
          if (inferred && inferred !== "Other") {
            ex.target_muscle_group = inferred;
            updated = true;
          }
        }

        if (updated) {
          await localDB.put("exercises", ex);
        }
      }
    }
  }

  // Restores unfinished session or prepares a new one
  async restoreOrCreateActiveSession() {
    const meta = await localDB.get("app_meta", "active_session_id");
    if (meta && meta.value) {
      const session = await localDB.getFullSession(meta.value);
      if (session && session.status === "in_progress") {
        this.activeSession = session;
        const hasExercises = session.exercise_logs && session.exercise_logs.length > 0;
        if (hasExercises && session.started_at) {
          this.startTime = new Date(session.started_at);
          this.startTimer();
        } else {
          session.started_at = null;
          await localDB.put("workout_sessions", session);
          this.startTime = null;
          this.stopTimer();
          this.resetTimerDisplay();
        }
        return;
      }
    }

    // Start fresh in-progress session
    await this.createNewActiveSession();
  }

  async createNewActiveSession() {
    const sessionId = crypto.randomUUID();
    const newSession = {
      id: sessionId,
      name: "",
      started_at: null,
      completed_at: null,
      session_notes: null,
      routine_id: null,
      synced: false,
      status: "in_progress",
      exercise_logs: []
    };

    await localDB.put("workout_sessions", newSession);
    await localDB.put("app_meta", { key: "active_session_id", value: sessionId });

    this.activeSession = newSession;
    this.startTime = null;
    this.stopTimer();
    this.resetTimerDisplay();
    const notesInput = document.getElementById("session-notes-input");
    if (notesInput) notesInput.value = "";
    await this.renderWorkoutOverview();
  }

  startTimer() {
    this.stopTimer();

    const update = () => {
      if (!this.startTime) return;
      const elapsedMs = Math.max(0, Date.now() - this.startTime.getTime());
      const secs = Math.floor((elapsedMs / 1000) % 60);
      const mins = Math.floor((elapsedMs / (1000 * 60)) % 60);
      const hours = Math.floor(elapsedMs / (1000 * 60 * 60));

      const fmt = [
        String(hours).padStart(2, "0"),
        String(mins).padStart(2, "0"),
        String(secs).padStart(2, "0")
      ].join(":");

      const timerEl = document.getElementById("session-active-timer");
      const badgeTimer = document.getElementById("timer-display");
      if (timerEl) timerEl.textContent = fmt;
      if (badgeTimer) badgeTimer.textContent = fmt;
    };

    update();
    this.timerInterval = setInterval(update, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  resetTimerDisplay() {
    const timerEl = document.getElementById("session-active-timer");
    const badgeTimer = document.getElementById("timer-display");
    if (timerEl) timerEl.textContent = "00:00:00";
    if (badgeTimer) badgeTimer.textContent = "00:00:00";
  }

  bindEvents() {
    // Bottom Navigation switching
    document.querySelectorAll(".bottom-nav .nav-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const viewId = btn.getAttribute("data-view");
        this.switchView(viewId);
      });
    });

    // Back button in header (when in logger view)
    document.getElementById("btn-back").addEventListener("click", () => {
      const openModal = document.querySelector(".modal-overlay:not(.hidden)");
      if (openModal) {
        openModal.classList.add("hidden");
        return;
      }
      if (window.history.length > 1) {
        window.history.back();
      } else {
        this.switchView("view-workout");
      }
    });

    // Handle browser back button and mobile swipe gestures
    window.addEventListener("popstate", async (e) => {
      // 1. If any modal popup is open, close it and stay on current screen
      const openModal = document.querySelector(".modal-overlay:not(.hidden)");
      if (openModal) {
        openModal.classList.add("hidden");
        return;
      }

      // 2. Otherwise navigate to the previous view indicated by hash or state
      const currentHash = window.location.hash;
      const HASH_TO_VIEW = {
        "#workout": "view-workout",
        "#history": "view-history",
        "#exercises": "view-exercises",
        "#insights": "view-insights",
        "#logger": "view-logger"
      };

      const targetView = HASH_TO_VIEW[currentHash] || (e.state && e.state.viewId) || "view-workout";

      if (targetView === "view-logger") {
        const logId = localStorage.getItem("active_log_id");
        if (logId) {
          const log = await localDB.get("exercise_logs", logId);
          if (log) {
            await this.openExerciseLogger(log, false);
            return;
          }
        }
        this.switchView("view-workout", false);
      } else {
        this.switchView(targetView, false);
      }
    });

    // Session name change & live typing update
    const nameInput = document.getElementById("session-name-input");
    const editNameBtn = document.getElementById("btn-edit-active-session-name");
    let sessionNameDebounce = null;

    if (editNameBtn && nameInput) {
      editNameBtn.addEventListener("click", () => {
        nameInput.focus();
        nameInput.select();
      });
    }

    if (nameInput) {
      const persistSessionName = async () => {
        if (!this.activeSession) return;
        const val = nameInput.value.trim();
        this.activeSession.name = val;
        await localDB.put("workout_sessions", {
          id: this.activeSession.id,
          name: this.activeSession.name,
          started_at: this.activeSession.started_at,
          completed_at: this.activeSession.completed_at,
          session_notes: this.activeSession.session_notes,
          routine_id: this.activeSession.routine_id,
          synced: false,
          status: this.activeSession.status
        });
      };

      nameInput.addEventListener("focus", () => {
        if (nameInput.value) {
          nameInput.select();
        }
      });

      nameInput.addEventListener("input", () => {
        if (this.activeSession) {
          this.activeSession.name = nameInput.value.trim();
        }
        clearTimeout(sessionNameDebounce);
        sessionNameDebounce = setTimeout(persistSessionName, 300);
      });

      nameInput.addEventListener("change", persistSessionName);
      nameInput.addEventListener("blur", persistSessionName);
    }

    // Session Notes Input & Auto-Save (Feature 5)
    const sessionNotesInput = document.getElementById("session-notes-input");
    const sessionNotesStatus = document.getElementById("session-notes-status");
    let sessionNotesDebounce = null;
    if (sessionNotesInput) {
      const handleNotesChange = async () => {
        if (!this.activeSession) return;
        this.activeSession.session_notes = sessionNotesInput.value.trim() || null;
        if (sessionNotesStatus) {
          sessionNotesStatus.textContent = "Saving...";
          sessionNotesStatus.classList.add("saving");
        }
        await localDB.put("workout_sessions", {
          id: this.activeSession.id,
          name: this.activeSession.name,
          started_at: this.activeSession.started_at,
          completed_at: this.activeSession.completed_at,
          session_notes: this.activeSession.session_notes,
          routine_id: this.activeSession.routine_id,
          synced: false,
          status: this.activeSession.status
        });
        if (sessionNotesStatus) {
          sessionNotesStatus.textContent = "Auto-saved";
          sessionNotesStatus.classList.remove("saving");
        }
      };

      sessionNotesInput.addEventListener("input", () => {
        if (sessionNotesDebounce) clearTimeout(sessionNotesDebounce);
        sessionNotesDebounce = setTimeout(handleNotesChange, 500);
      });
      sessionNotesInput.addEventListener("change", handleNotesChange);
    }

    // Preview AI Workout Insights Button (Feature 4 & 5)
    const previewAiBtn = document.getElementById("btn-preview-workout-ai");
    if (previewAiBtn) {
      previewAiBtn.addEventListener("click", () => {
        if (this.activeSession) {
          this.selectedInsightsSessionId = this.activeSession.id;
        }
        this.switchView("view-insights");
      });
    }

    // Add Exercise Button (opens modal)
    document.getElementById("btn-add-exercise").addEventListener("click", () => {
      this.openSelectExerciseModal();
    });

    document.getElementById("btn-close-select-modal").addEventListener("click", () => {
      document.getElementById("modal-select-exercise").classList.add("hidden");
    });

    // Finish Workout Button
    document.getElementById("btn-finish-workout").addEventListener("click", async () => {
      await this.finishActiveSession();
    });

    // Steppers (+ / -)
    this.bindStepper("btn-weight-minus", "btn-weight-plus", "input-weight", -2.5, 2.5);
    this.bindStepper("btn-reps-minus", "btn-reps-plus", "input-reps", -1, 1);
    this.bindStepper("btn-rir-minus", "btn-rir-plus", "input-rir", -1, 1);

    // Save / Update Set
    document.getElementById("btn-save-set").addEventListener("click", async () => {
      await this.saveCurrentSet();
    });

    // Cancel Edit Set Buttons
    const cancelEditBtn = document.getElementById("btn-cancel-edit-set");
    if (cancelEditBtn) {
      cancelEditBtn.addEventListener("click", () => {
        this.cancelEditSet();
      });
    }

    const cancelEditBannerBtn = document.getElementById("btn-cancel-edit-banner");
    if (cancelEditBannerBtn) {
      cancelEditBannerBtn.addEventListener("click", () => {
        this.cancelEditSet();
      });
    }

    // Clear Set
    document.getElementById("btn-clear-set").addEventListener("click", () => {
      if (this.editingSetId) {
        this.cancelEditSet();
      }
      document.getElementById("input-weight").value = "135.0";
      document.getElementById("input-reps").value = "5";
      document.getElementById("input-rir").value = "2";
      const setNotes = document.getElementById("input-set-notes");
      if (setNotes) setNotes.value = "";
    });

    // Exercise Notes Input Listener
    const exNotesInput = document.getElementById("input-exercise-notes");
    if (exNotesInput) {
      exNotesInput.addEventListener("input", async (e) => {
        if (this.activeLog) {
          this.activeLog.notes = e.target.value.trim() || null;
          await localDB.put("exercise_logs", this.activeLog);
          await this.renderWorkoutOverview();
        }
      });
      exNotesInput.addEventListener("change", () => {
        this.showToast("Exercise notes saved");
      });
    }

    // Rest Timer Preset buttons (60s, 90s, 2m, 3m)
    document.querySelectorAll(".btn-rest-preset").forEach((btn) => {
      btn.addEventListener("click", () => {
        const secs = parseInt(btn.getAttribute("data-seconds"), 10);
        this.saveExerciseRestDuration(secs);
      });
    });

    // Rest Timer Stepper Adjusters (-15s / +15s)
    const restMinusBtn = document.getElementById("btn-rest-adjust-minus");
    if (restMinusBtn) {
      restMinusBtn.addEventListener("click", () => {
        const cur = this.currentExerciseRestSeconds || 90;
        this.saveExerciseRestDuration(cur - 15);
      });
    }

    const restPlusBtn = document.getElementById("btn-rest-adjust-plus");
    if (restPlusBtn) {
      restPlusBtn.addEventListener("click", () => {
        const cur = this.currentExerciseRestSeconds || 90;
        this.saveExerciseRestDuration(cur + 15);
      });
    }

    // Manual start rest timer button
    const startRestManualBtn = document.getElementById("btn-start-rest-manual");
    if (startRestManualBtn) {
      startRestManualBtn.addEventListener("click", () => {
        const name = this.activeLog ? this.activeLog.exercise_name : "Exercise";
        this.restTimer.start(this.currentExerciseRestSeconds || 90, name);
      });
    }

    // Active Rest Card controls
    const restSkipBtn = document.getElementById("btn-rest-skip");
    if (restSkipBtn) {
      restSkipBtn.addEventListener("click", () => this.restTimer.skip());
    }

    const restPauseBtn = document.getElementById("btn-rest-pause");
    if (restPauseBtn) {
      restPauseBtn.addEventListener("click", () => this.restTimer.togglePause());
    }

    const restAdd30Btn = document.getElementById("btn-rest-add30");
    if (restAdd30Btn) {
      restAdd30Btn.addEventListener("click", () => this.restTimer.addSeconds(30));
    }

    // Global header rest pill click: navigate back to logger
    const globalRestPill = document.getElementById("global-rest-pill");
    if (globalRestPill) {
      globalRestPill.addEventListener("click", () => {
        if (this.activeLog) {
          this.switchView("view-logger");
        }
      });
    }

    // Exercise Sub-tabs (Track / History / Graph)
    document.querySelectorAll(".sub-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".sub-tab-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const subtab = btn.getAttribute("data-subtab");

        document.getElementById("subtab-track-content").classList.toggle("hidden", subtab !== "track");
        document.getElementById("subtab-history-content").classList.toggle("hidden", subtab !== "history");
        document.getElementById("subtab-graph-content").classList.toggle("hidden", subtab !== "graph");

        if (subtab === "history") this.renderExerciseHistoryTab();
        if (subtab === "graph") this.renderExerciseGraphTab();
      });
    });

    // Manual Sync Button in History
    document.getElementById("btn-sync-manual").addEventListener("click", async () => {
      await syncManager.pullHistory();
      await syncManager.syncNow();
      this.renderHistory();
      this.updateDiagnostics();
    });

    // Catalog Search & Filters
    document.getElementById("exercise-search").addEventListener("input", (e) => {
      this.renderCatalog(e.target.value);
    });

    document.querySelectorAll("#muscle-chips .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        document.querySelectorAll("#muscle-chips .chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        this.currentFilterMuscle = chip.getAttribute("data-muscle");
        this.renderCatalog(document.getElementById("exercise-search").value);
      });
    });

    // Create New Exercise Modal
    document.getElementById("btn-create-exercise-modal").addEventListener("click", () => {
      document.getElementById("modal-create-exercise").classList.remove("hidden");
      history.pushState({ isModal: true }, "");
    });

    document.getElementById("btn-close-create-modal").addEventListener("click", () => {
      document.getElementById("modal-create-exercise").classList.add("hidden");
    });

    document.getElementById("form-create-exercise").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("create-ex-name").value.trim();
      const muscle = document.getElementById("create-ex-muscle").value;
      const equipment = document.getElementById("create-ex-equipment").value || null;

      if (!name) return;

      // Verify that an exercise with this name does not already exist
      const existingList = await localDB.getAll("exercises");
      const nameLower = name.toLowerCase();
      const isDuplicate = existingList.some(
        (ex) => (ex.name || "").trim().toLowerCase() === nameLower
      );
      if (isDuplicate) {
        this.showToast(`Exercise "${name}" already exists`, "error");
        return;
      }

      const newEx = {
        id: crypto.randomUUID(),
        name: name,
        target_muscle_group: muscle,
        default_equipment: equipment
      };

      await localDB.put("exercises", newEx);
      document.getElementById("modal-create-exercise").classList.add("hidden");
      e.target.reset();

      // If online, also send to server
      if (navigator.onLine) {
        try {
          const res = await fetch(`${API_BASE_URL}/exercises`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(newEx)
          });
          if (res.status === 409) {
            console.warn("Exercise already exists on server");
          }
        } catch (err) {
          console.warn("Exercise saved locally, server offline:", err);
        }
      }

      this.renderCatalog();
      this.showToast(`Created "${name}"`);
    });

    // Edit Exercise Modal Close
    const closeEditBtn = document.getElementById("btn-close-edit-modal");
    if (closeEditBtn) {
      closeEditBtn.addEventListener("click", () => {
        document.getElementById("modal-edit-exercise").classList.add("hidden");
      });
    }

    // Edit Exercise Form Submit
    const editForm = document.getElementById("form-edit-exercise");
    if (editForm) {
      editForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = document.getElementById("edit-ex-id").value;
        const name = document.getElementById("edit-ex-name").value.trim();
        const muscle = document.getElementById("edit-ex-muscle").value;
        const equipment = document.getElementById("edit-ex-equipment").value || null;

        if (!name || !id) return;

        // Check if renamed to a name that conflicts with another exercise
        const existingList = await localDB.getAll("exercises");
        const isDuplicate = existingList.some(
          (ex) => ex.id !== id && (ex.name || "").trim().toLowerCase() === name.toLowerCase()
        );
        if (isDuplicate) {
          this.showToast(`Exercise "${name}" already exists`, "error");
          return;
        }

        const existingEx = await localDB.get("exercises", id);
        const updatedEx = {
          ...existingEx,
          id: id,
          name: name,
          target_muscle_group: muscle,
          default_equipment: equipment
        };

        await localDB.put("exercises", updatedEx);

        // Update activeLog if currently viewing this exercise
        if (this.activeLog && this.activeLog.exercise_id === id) {
          this.activeLog.exercise_name = name;
        }

        // Also update backend if online
        if (navigator.onLine) {
          try {
            await fetch(`${API_BASE_URL}/exercises/${id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: name,
                target_muscle_group: muscle,
                default_equipment: equipment
              })
            });
          } catch (err) {
            console.warn("Exercise updated locally, server offline:", err);
          }
        }

        document.getElementById("modal-edit-exercise").classList.add("hidden");
        this.renderCatalog();
        this.showToast(`Updated "${name}"`);
      });
    }

    // Delete Exercise Button
    const deleteExBtn = document.getElementById("btn-delete-exercise");
    if (deleteExBtn) {
      deleteExBtn.addEventListener("click", async () => {
        const id = document.getElementById("edit-ex-id").value;
        const name = document.getElementById("edit-ex-name").value.trim();
        if (!id) return;

        // Check if logs exist for this exercise locally
        const allLogs = await localDB.getAll("exercise_logs");
        const hasLogs = allLogs.some((l) => l.exercise_id === id);
        if (hasLogs) {
          this.showToast(`Cannot delete "${name}": workout logs reference it`, "error");
          return;
        }

        if (!confirm(`Are you sure you want to delete "${name}"?`)) {
          return;
        }

        await localDB.delete("exercises", id);

        // Delete from backend if online
        if (navigator.onLine) {
          try {
            await fetch(`${API_BASE_URL}/exercises/${id}`, { method: "DELETE" });
          } catch (err) {
            console.warn("Exercise deleted locally, server offline:", err);
          }
        }

        document.getElementById("modal-edit-exercise").classList.add("hidden");
        this.renderCatalog();
        this.showToast(`Deleted "${name}"`);
      });
    }

    // Edit Workout Notes Modal Close & Submit
    const closeNotesModalBtn = document.getElementById("btn-close-notes-modal");
    if (closeNotesModalBtn) {
      closeNotesModalBtn.addEventListener("click", () => {
        document.getElementById("modal-edit-workout-notes").classList.add("hidden");
      });
    }

    const editNotesForm = document.getElementById("form-edit-workout-notes");
    if (editNotesForm) {
      editNotesForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const sessionId = document.getElementById("edit-session-notes-id").value;
        const notesText = document.getElementById("edit-session-notes-text").value.trim() || null;
        if (!sessionId) return;
        await this.saveWorkoutNotes(sessionId, notesText);
        document.getElementById("modal-edit-workout-notes").classList.add("hidden");
      });
    }

    // Note: Rename and naming modals are handled dynamically via promptWorkoutNameModal

    // Run Insights Button in AI Insights tab
    const runInsightsBtn = document.getElementById("btn-run-insights");
    if (runInsightsBtn) {
      runInsightsBtn.addEventListener("click", async () => {
        if (this.selectedInsightsSessionId) {
          await this.runWorkoutAIInsights(this.selectedInsightsSessionId, true);
        }
      });
    }
  }

  bindStepper(minusId, plusId, inputId, minusDelta, plusDelta) {
    const input = document.getElementById(inputId);
    document.getElementById(minusId).addEventListener("click", () => {
      let val = parseFloat(input.value) || 0;
      val = Math.max(0, val + minusDelta);
      input.value = minusDelta % 1 === 0 ? val : val.toFixed(1);
    });
    document.getElementById(plusId).addEventListener("click", () => {
      let val = parseFloat(input.value) || 0;
      val = val + plusDelta;
      input.value = plusDelta % 1 === 0 ? val : val.toFixed(1);
    });
  }

  switchView(viewId, pushHistory = true) {
    this.currentView = viewId;
    localStorage.setItem("active_view", viewId);

    const VIEW_HASHES = {
      "view-workout": "#workout",
      "view-history": "#history",
      "view-exercises": "#exercises",
      "view-insights": "#insights",
      "view-logger": "#logger"
    };

    if (pushHistory) {
      const hash = VIEW_HASHES[viewId] || "#workout";
      if (window.location.hash !== hash) {
        history.pushState({ viewId: viewId }, "", hash);
      }
    }

    // Toggle panels
    document.querySelectorAll(".view-panel").forEach((panel) => {
      panel.classList.remove("active");
    });
    const target = document.getElementById(viewId);
    if (target) target.classList.add("active");

    // Update bottom nav state
    document.querySelectorAll(".bottom-nav .nav-item").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-view") === viewId);
    });

    // Update header navigation and titles
    const backBtn = document.getElementById("btn-back");
    const titleEl = document.getElementById("page-title");
    const subTitleEl = document.getElementById("page-subtitle");
    const timerBadge = document.getElementById("timer-badge");

    const globalRestPill = document.getElementById("global-rest-pill");

    if (viewId === "view-logger" && this.activeLog) {
      backBtn.classList.remove("hidden");
      titleEl.textContent = this.activeLog.exercise_name;
      subTitleEl.textContent = `${this.activeLog.exercise_name} / Tracker`;
      subTitleEl.classList.remove("hidden");
      timerBadge.classList.remove("hidden");
      if (globalRestPill) globalRestPill.classList.add("hidden");
      syncManager.updateStatusBadge("Online (Synced)");
    } else {
      backBtn.classList.add("hidden");
      subTitleEl.classList.add("hidden");
      timerBadge.classList.add("hidden");

      if (globalRestPill && this.restTimer && this.restTimer.isRunning) {
        globalRestPill.classList.remove("hidden");
      }

      if (viewId === "view-workout") {
        titleEl.textContent = "Workout Overview";
        syncManager.updateStatusBadge("Local (Draft Mode)", true);
        this.renderWorkoutOverview();
      } else if (viewId === "view-history") {
        titleEl.textContent = "Workout History";
        syncManager.updateStatusBadge();
        this.renderHistory();
      } else if (viewId === "view-exercises") {
        titleEl.textContent = "Exercise Library";
        syncManager.updateStatusBadge();
        this.renderCatalog();
      } else if (viewId === "view-insights") {
        titleEl.textContent = "AI Insights";
        syncManager.updateStatusBadge();
        this.renderInsightsView();
      }
    }
  }

  // Render list of exercise cards in the active workout
  async renderWorkoutOverview() {
    if (!this.activeSession) return;

    const fullSession = await localDB.getFullSession(this.activeSession.id);
    const container = document.getElementById("workout-exercises-list");
    container.innerHTML = "";

    const nameInput = document.getElementById("session-name-input");
    if (nameInput && document.activeElement !== nameInput) {
      const smartSuggestion = this.generateSmartWorkoutName(fullSession.exercise_logs);
      nameInput.placeholder = smartSuggestion ? `${smartSuggestion} (Tap to name)` : "Workout Name (e.g. Push Day, Leg Day)";
      nameInput.value = (fullSession.name && fullSession.name !== "Freeform Workout") ? fullSession.name : "";
    }

    const notesInput = document.getElementById("session-notes-input");
    if (notesInput) notesInput.value = fullSession.session_notes || "";

    // Calculate workout volume and category breakdown
    let totalWorkoutVolume = 0;
    const categoryVolumeMap = {};

    if (fullSession.exercise_logs && fullSession.exercise_logs.length > 0) {
      fullSession.exercise_logs.forEach((log) => {
        const muscleGroup = (log.target_muscle_group && log.target_muscle_group !== "Other")
          ? log.target_muscle_group
          : (localDB.inferMuscleGroup ? localDB.inferMuscleGroup(log.exercise_name) : "Other");
        let logVol = 0;
        if (log.sets && log.sets.length > 0) {
          log.sets.forEach((s) => {
            logVol += (s.weight || 0) * (s.reps || 0);
          });
        }
        log.totalVolume = logVol;
        totalWorkoutVolume += logVol;
        categoryVolumeMap[muscleGroup] = (categoryVolumeMap[muscleGroup] || 0) + logVol;
      });
    }

    // Render Workout Total Volume
    const totalVolEl = document.getElementById("workout-total-volume");
    if (totalVolEl) {
      totalVolEl.textContent = `${Math.round(totalWorkoutVolume).toLocaleString()} lbs`;
    }

    // Render Muscle Group Category Breakdown
    const breakdownEl = document.getElementById("workout-category-breakdown");
    if (breakdownEl) {
      breakdownEl.innerHTML = "";
      const categories = Object.keys(categoryVolumeMap);
      if (categories.length === 0 || totalWorkoutVolume === 0) {
        breakdownEl.innerHTML = `<span class="category-empty-text">No sets logged yet. Complete sets to see category distribution.</span>`;
      } else {
        categories.sort((a, b) => categoryVolumeMap[b] - categoryVolumeMap[a]);
        categories.forEach((cat) => {
          const vol = categoryVolumeMap[cat];
          const chip = document.createElement("div");
          chip.className = "category-chip";
          chip.innerHTML = `
            <span class="category-chip-name">${this.escapeHtml(cat)}:</span>
            <span class="category-chip-vol">${Math.round(vol).toLocaleString()} lbs</span>
          `;
          breakdownEl.appendChild(chip);
        });
      }
    }

    if (!fullSession.exercise_logs || fullSession.exercise_logs.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No exercises added yet. Tap "New Exercise" to begin logging sets.</p>
        </div>
      `;
      return;
    }

    fullSession.exercise_logs.forEach((log) => {
      const card = document.createElement("div");
      card.className = "exercise-summary-card";

      const totalSets = log.sets ? log.sets.length : 0;
      const totalReps = log.sets ? log.sets.reduce((sum, s) => sum + s.reps, 0) : 0;
      const logVol = log.totalVolume || 0;
      const noteHtml = log.notes
        ? `<p class="exercise-card-note">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            <span>${this.escapeHtml(log.notes)}</span>
          </p>`
        : "";

      card.innerHTML = `
        <div class="exercise-card-info">
          <h4>${log.exercise_name}</h4>
          <p>${log.exercise_name} &bull; ${totalSets} sets &bull; ${totalReps} reps &bull; <span class="card-vol-badge">${Math.round(logVol).toLocaleString()} lbs vol</span></p>
          ${noteHtml}
        </div>
        <button class="icon-btn" aria-label="Open">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      `;

      card.addEventListener("click", () => {
        this.openExerciseLogger(log);
      });

      container.appendChild(card);
    });
  }

  escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  showToast(message = "Saved successfully", type = "success", duration = 2400) {
    const toast = document.getElementById("toast-notification");
    const msgEl = document.getElementById("toast-message");
    const contentEl = toast ? toast.querySelector(".toast-content") : null;
    const iconEl = toast ? toast.querySelector(".toast-icon") : null;
    if (!toast || !msgEl) return;

    msgEl.textContent = message;

    if (contentEl && iconEl) {
      if (type === "error") {
        contentEl.classList.add("toast-error");
        iconEl.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        `;
      } else {
        contentEl.classList.remove("toast-error");
        iconEl.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        `;
      }
    }

    toast.classList.add("show");

    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.classList.remove("show");
    }, duration);
  }

  // Opens the exercise set logger (Screen 2 Mockup)
  async openExerciseLogger(log, pushHistory = true) {
    this.cancelEditSet(false);
    this.activeLog = log;
    localStorage.setItem("active_log_id", log.id);
    this.switchView("view-logger", pushHistory);

    // Populate exercise-level notes
    const exerciseNotesInput = document.getElementById("input-exercise-notes");
    if (exerciseNotesInput) {
      exerciseNotesInput.value = log.notes || "";
    }

    // Reset set notes input
    const setNotesInput = document.getElementById("input-set-notes");
    if (setNotesInput) {
      setNotesInput.value = "";
    }

    // Reset save set button state
    const saveBtn = document.getElementById("btn-save-set");
    if (saveBtn) {
      if (this.saveBtnTimeout) {
        clearTimeout(this.saveBtnTimeout);
        this.saveBtnTimeout = null;
      }
      saveBtn.classList.remove("btn-saved-success");
      saveBtn.innerHTML = "SAVE SET";
    }

    // Load saved rest timer duration for this specific exercise
    try {
      const exercise = await localDB.get("exercises", log.exercise_id);
      const savedRest = (exercise && exercise.rest_duration_seconds)
        ? exercise.rest_duration_seconds
        : this.getDefaultRestForExercise(exercise ? exercise.name : log.exercise_name);

      this.currentExerciseRestSeconds = savedRest;
      this.updateRestSettingsUI(savedRest);
    } catch (e) {
      this.currentExerciseRestSeconds = 90;
      this.updateRestSettingsUI(90);
    }

    await this.renderLoggedSets();
  }

  getDefaultRestForExercise(name) {
    if (!name) return 90;
    const lower = name.toLowerCase();
    if (lower.includes("squat") || lower.includes("deadlift")) {
      return 180; // 3 minutes
    }
    if (lower.includes("bench") || lower.includes("press") || lower.includes("row")) {
      return 120; // 2 minutes
    }
    return 90; // 90 seconds
  }

  formatRestDurationLabel(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0 && secs > 0) {
      return `${mins}m ${secs}s`;
    } else if (mins > 0) {
      return `${mins}m 00s`;
    } else {
      return `${secs}s`;
    }
  }

  updateRestSettingsUI(seconds) {
    const label = document.getElementById("rest-target-label");
    if (label) {
      label.textContent = this.formatRestDurationLabel(seconds);
    }

    // Highlight active preset button if matches exact seconds
    document.querySelectorAll(".btn-rest-preset").forEach((btn) => {
      const s = parseInt(btn.getAttribute("data-seconds"), 10);
      btn.classList.toggle("active", s === seconds);
    });
  }

  async saveExerciseRestDuration(seconds) {
    seconds = Math.max(15, Math.min(600, seconds));
    this.currentExerciseRestSeconds = seconds;
    this.updateRestSettingsUI(seconds);

    if (this.activeLog && this.activeLog.exercise_id) {
      try {
        const exercise = await localDB.get("exercises", this.activeLog.exercise_id);
        if (exercise) {
          exercise.rest_duration_seconds = seconds;
          await localDB.put("exercises", exercise);
        }
      } catch (err) {
        console.warn("Could not save exercise rest duration:", err);
      }
    }
  }

  async renderLoggedSets() {
    if (!this.activeLog) return;

    const sets = await localDB.getByIndex("set_entries", "exercise_log_id", this.activeLog.id);
    sets.sort((a, b) => a.set_number - b.set_number);

    const list = document.getElementById("logged-sets-list");
    list.innerHTML = "";

    // Exercise-level total volume calculation
    const totalExVol = sets.reduce((sum, s) => sum + ((s.weight || 0) * (s.reps || 0)), 0);
    const exVolEl = document.getElementById("exercise-total-volume");
    if (exVolEl) {
      exVolEl.textContent = `${Math.round(totalExVol).toLocaleString()} lbs`;
    }

    if (sets.length === 0) {
      list.innerHTML = `<div class="empty-state"><p>No sets logged yet. Select weight and reps, then tap "SAVE SET".</p></div>`;
      this.updateAICoachCard(0);
      return;
    }

    sets.forEach((set) => {
      const card = document.createElement("div");
      card.className = "set-item-card";
      if (this.editingSetId === set.id) {
        card.classList.add("is-editing");
      }

      const setVol = Math.round((set.weight || 0) * (set.reps || 0));
      const rirText = set.rir !== null && set.rir !== undefined ? `${set.rir} RIR` : "";
      const noteHtml = set.notes
        ? `<div class="set-note-preview">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <span>${this.escapeHtml(set.notes)}</span>
          </div>`
        : "";

      card.innerHTML = `
        <div class="set-row">
          <div class="set-row-left">
            <span class="set-number">${set.set_number}</span>
          </div>
          <div class="set-stat">${set.weight.toFixed(1)} lbs</div>
          <div class="set-stat">${set.reps} reps</div>
          <div class="set-stat volume-stat">${setVol.toLocaleString()} lbs vol</div>
          ${rirText ? `<div class="set-stat rir-stat">${rirText}</div>` : ""}
          <div class="set-actions">
            <button class="set-edit-btn" aria-label="Edit set" title="Edit set">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
            <button class="set-delete-btn" aria-label="Delete set" title="Delete set">&times;</button>
          </div>
        </div>
        ${noteHtml}
      `;

      if (set.notes) {
        const notePreviewEl = card.querySelector(".set-note-preview");
        if (notePreviewEl) {
          notePreviewEl.style.cursor = "pointer";
          notePreviewEl.title = "Click to edit note";
          notePreviewEl.addEventListener("click", async (e) => {
            e.stopPropagation();
            const updated = prompt("Edit set note:", set.notes || "");
            if (updated !== null) {
              set.notes = updated.trim() || null;
              await localDB.put("set_entries", set);
              await this.renderLoggedSets();
              this.renderWorkoutOverview();
            }
          });
        }
      }

      card.querySelector(".set-edit-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        this.startEditSet(set);
      });

      card.querySelector(".set-delete-btn").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (this.editingSetId === set.id) {
          this.cancelEditSet(false);
        }
        await localDB.delete("set_entries", set.id);
        await this.renderLoggedSets();
        this.renderWorkoutOverview();
      });

      list.appendChild(card);
    });

    this.updateAICoachCard(sets.length);
  }

  startEditSet(set) {
    this.editingSetId = set.id;

    const weightInput = document.getElementById("input-weight");
    if (weightInput) weightInput.value = (set.weight !== undefined && set.weight !== null) ? set.weight : "135.0";

    const repsInput = document.getElementById("input-reps");
    if (repsInput) repsInput.value = (set.reps !== undefined && set.reps !== null) ? set.reps : "5";

    const rirInput = document.getElementById("input-rir");
    if (rirInput) rirInput.value = (set.rir !== null && set.rir !== undefined) ? set.rir : "2";

    const notesInput = document.getElementById("input-set-notes");
    if (notesInput) notesInput.value = set.notes || "";

    const banner = document.getElementById("editing-set-banner");
    if (banner) banner.classList.remove("hidden");

    const numLabel = document.getElementById("editing-set-number-label");
    if (numLabel) numLabel.textContent = set.set_number;

    const saveBtn = document.getElementById("btn-save-set");
    if (saveBtn) {
      saveBtn.textContent = "UPDATE SET";
      saveBtn.classList.remove("btn-saved-success");
    }

    const cancelBtn = document.getElementById("btn-cancel-edit-set");
    if (cancelBtn) cancelBtn.classList.remove("hidden");

    this.renderLoggedSets();

    const stepperBox = document.querySelector(".stepper-box");
    if (stepperBox) {
      stepperBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  cancelEditSet(reRender = true) {
    this.editingSetId = null;

    const banner = document.getElementById("editing-set-banner");
    if (banner) banner.classList.add("hidden");

    const saveBtn = document.getElementById("btn-save-set");
    if (saveBtn) {
      saveBtn.textContent = "SAVE SET";
      saveBtn.classList.remove("btn-saved-success");
    }

    const cancelBtn = document.getElementById("btn-cancel-edit-set");
    if (cancelBtn) cancelBtn.classList.add("hidden");

    if (reRender) {
      this.renderLoggedSets();
    }
  }

  updateAICoachCard(totalSets) {
    const textEl = document.getElementById("ai-coach-text");
    if (!textEl) return;

    if (totalSets === 0) {
      textEl.textContent = "Warm up appropriately before attempting working sets. Aim for clean execution and a steady tempo.";
    } else {
      this.requestAICoachFeedback();
    }
  }

  async requestAICoachFeedback() {
    if (!this.activeLog) return;
    const textEl = document.getElementById("ai-coach-text");
    if (!textEl) return;

    textEl.textContent = "Analyzing set performance and calculating fatigue...";

    try {
      const exercise = await localDB.get("exercises", this.activeLog.exercise_id);
      const muscleGroup = exercise ? exercise.target_muscle_group : null;

      const sets = await localDB.getByIndex("set_entries", "exercise_log_id", this.activeLog.id);
      sets.sort((a, b) => a.set_number - b.set_number);

      if (sets.length === 0) {
        textEl.textContent = "Warm up appropriately before attempting working sets. Aim for clean execution and a steady tempo.";
        return;
      }

      const payload = {
        exercise_name: this.activeLog.exercise_name,
        target_muscle_group: muscleGroup,
        exercise_notes: this.activeLog.notes || null,
        completed_sets: sets.map((s) => ({
          set_number: s.set_number,
          weight: s.weight,
          reps: s.reps,
          rir: s.rir,
          completed: s.completed,
          notes: s.notes
        }))
      };

      const res = await fetch("/coach/exercise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const nextSetNum = sets.length + 1;
      const targetText = data.suggested_weight && data.suggested_reps
        ? ` Ready for Set ${nextSetNum}? Target: ${data.suggested_weight} lbs × ${data.suggested_reps} reps.`
        : "";
      textEl.textContent = `Estimated fatigue: ${data.fatigue_level}.${targetText} ${data.feedback_message}`;

    } catch (err) {
      console.warn("AI coach request failed:", err);
      textEl.textContent = "Maintain form consistency and control your eccentric tempo on the next set.";
    }
  }

  async saveCurrentSet() {
    if (!this.activeLog) return;

    // Hard double-tap & spam protection: check both lock flag and 1200ms debounce
    const now = Date.now();
    if (this.isSavingSet || (this.lastSaveTime && now - this.lastSaveTime < 1200)) {
      return;
    }
    this.isSavingSet = true;
    this.lastSaveTime = now;

    const saveBtn = document.getElementById("btn-save-set");
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.style.pointerEvents = "none";
      saveBtn.classList.add("btn-disabled", "btn-saving");
    }

    try {
      const weight = parseFloat(document.getElementById("input-weight").value) || 0;
      const reps = parseInt(document.getElementById("input-reps").value, 10) || 1;
      const rirVal = document.getElementById("input-rir").value;
      const rir = rirVal !== "" ? parseInt(rirVal, 10) : null;
      const setNotesInput = document.getElementById("input-set-notes");
      const setNotes = setNotesInput ? setNotesInput.value.trim() : "";

      if (this.editingSetId) {
        // Update existing set entry
        const existingSet = await localDB.get("set_entries", this.editingSetId);
        if (existingSet) {
          existingSet.weight = weight;
          existingSet.reps = reps;
          existingSet.rir = rir;
          existingSet.notes = setNotes.length > 0 ? setNotes : null;

          await localDB.put("set_entries", existingSet);

          if (setNotesInput) {
            setNotesInput.value = "";
          }

          const setNum = existingSet.set_number;
          this.cancelEditSet(false);

          await this.renderLoggedSets();
          this.renderWorkoutOverview();

          // Button micro-interaction: green checkmark and "UPDATED"
          if (saveBtn) {
            if (this.saveBtnTimeout) {
              clearTimeout(this.saveBtnTimeout);
            }
            saveBtn.classList.add("btn-saved-success");
            saveBtn.innerHTML = `
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>UPDATED</span>
            `;
            this.saveBtnTimeout = setTimeout(() => {
              saveBtn.classList.remove("btn-saved-success", "btn-disabled", "btn-saving");
              saveBtn.innerHTML = "SAVE SET";
              saveBtn.disabled = false;
              saveBtn.style.pointerEvents = "";
              this.isSavingSet = false;
              this.saveBtnTimeout = null;
            }, 1200);
          } else {
            this.isSavingSet = false;
          }

          this.showToast(`Set ${setNum} Updated (${weight.toFixed(1)} lbs × ${reps} reps)`);
        } else {
          this.cancelEditSet(false);
          this.isSavingSet = false;
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.style.pointerEvents = "";
            saveBtn.classList.remove("btn-disabled", "btn-saving");
          }
        }
      } else {
        // Create new set entry
        const existingSets = await localDB.getByIndex("set_entries", "exercise_log_id", this.activeLog.id);
        const nextSetNumber = existingSets.length + 1;

        const newSet = {
          id: crypto.randomUUID(),
          exercise_log_id: this.activeLog.id,
          set_number: nextSetNumber,
          set_type: "normal",
          weight: weight,
          reps: reps,
          rir: rir,
          completed: true,
          notes: setNotes.length > 0 ? setNotes : null
        };

        await localDB.put("set_entries", newSet);
        if (setNotesInput) {
          setNotesInput.value = "";
        }
        await this.renderLoggedSets();
        this.renderWorkoutOverview();

        // Button micro-interaction: green checkmark and "SAVED"
        if (saveBtn) {
          if (this.saveBtnTimeout) {
            clearTimeout(this.saveBtnTimeout);
          }
          saveBtn.classList.add("btn-saved-success");
          saveBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>SAVED</span>
          `;
          this.saveBtnTimeout = setTimeout(() => {
            saveBtn.classList.remove("btn-saved-success", "btn-disabled", "btn-saving");
            saveBtn.innerHTML = this.editingSetId ? "UPDATE SET" : "SAVE SET";
            saveBtn.disabled = false;
            saveBtn.style.pointerEvents = "";
            this.isSavingSet = false;
            this.saveBtnTimeout = null;
          }, 1200);
        } else {
          this.isSavingSet = false;
        }

        // Floating toast confirmation
        this.showToast(`Set ${nextSetNumber} Saved (${weight.toFixed(1)} lbs × ${reps} reps)`);

        // Auto-start custom rest timer for this exercise
        const restSecs = this.currentExerciseRestSeconds || 90;
        this.restTimer.start(restSecs, this.activeLog.exercise_name);
      }
    } catch (err) {
      console.error("Error saving set:", err);
      this.showToast("Failed to save set", "error");
      this.isSavingSet = false;
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.style.pointerEvents = "";
        saveBtn.classList.remove("btn-disabled", "btn-saving");
      }
    }
  }

  async renderExerciseHistoryTab() {
    const container = document.getElementById("exercise-past-records");
    if (!container || !this.activeLog) return;

    container.innerHTML = `<div class="empty-state"><p>Loading history for ${this.activeLog.exercise_name}...</p></div>`;

    const allSessions = await localDB.getAll("workout_sessions");
    const completed = allSessions.filter((s) => s.status === "completed");

    let pastSetsFound = [];
    for (const s of completed) {
      const logs = await localDB.getByIndex("exercise_logs", "workout_session_id", s.id);
      for (const l of logs) {
        if (l.exercise_id === this.activeLog.exercise_id) {
          const sets = await localDB.getByIndex("set_entries", "exercise_log_id", l.id);
          if (sets.length > 0) {
            pastSetsFound.push({ sessionDate: s.started_at, sets });
          }
        }
      }
    }

    if (pastSetsFound.length === 0) {
      container.innerHTML = `<div class="empty-state"><p>No previous completed sessions for this exercise.</p></div>`;
      return;
    }

    container.innerHTML = "";
    pastSetsFound.forEach((entry) => {
      const card = document.createElement("div");
      card.className = "history-card";
      const dateStr = new Date(entry.sessionDate).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
      });

      card.innerHTML = `
        <div class="history-card-header">
          <h3>${dateStr}</h3>
        </div>
        <div class="history-card-body">
          ${entry.sets.map((s) => `Set ${s.set_number}: ${s.weight} lbs &times; ${s.reps} reps`).join("<br>")}
        </div>
      `;
      container.appendChild(card);
    });
  }

  renderExerciseGraphTab() {
    const box = document.getElementById("progression-summary-box");
    if (box && this.activeLog) {
      box.innerHTML = `
        <p><strong>Exercise:</strong> ${this.activeLog.exercise_name}</p>
        <p><strong>Baseline Overload:</strong> Steady +2.5% volume week-over-week.</p>
        <p><strong>Fatigue Index:</strong> 1.2 (Optimal Recovery Window)</p>
      `;
    }
  }

  // Generates intelligent workout name from exercises and muscle groups
  generateSmartWorkoutName(exerciseLogs) {
    if (!exerciseLogs || exerciseLogs.length === 0) return "Workout";

    const muscleGroups = new Set();
    for (const log of exerciseLogs) {
      let mg = (log.target_muscle_group && log.target_muscle_group !== "Other")
        ? log.target_muscle_group
        : (localDB.inferMuscleGroup ? localDB.inferMuscleGroup(log.exercise_name) : null);
      if (mg && mg !== "Other") {
        muscleGroups.add(mg);
      }
    }

    const groups = Array.from(muscleGroups);
    if (groups.length === 0) return "Strength Workout";

    const hasChest = groups.includes("Chest");
    const hasTriceps = groups.includes("Triceps");
    const hasShoulders = groups.includes("Shoulders");
    const hasBack = groups.includes("Back");
    const hasBiceps = groups.includes("Biceps");
    const hasQuads = groups.includes("Quads");
    const hasHamstrings = groups.includes("Hamstrings");
    const hasGlutes = groups.includes("Glutes");
    const hasCalves = groups.includes("Calves");
    const hasLegs = hasQuads || hasHamstrings || hasGlutes || hasCalves || groups.includes("Legs");

    // Push Day: Chest + Shoulders/Triceps (no back, no legs)
    if (hasChest && (hasShoulders || hasTriceps) && !hasBack && !hasLegs) {
      if (hasShoulders && hasTriceps) return "Push Day";
      if (hasTriceps) return "Chest & Triceps Workout";
      return "Chest & Shoulders Workout";
    }

    // Pull Day: Back + Biceps (no chest, no legs)
    if (hasBack && hasBiceps && !hasChest && !hasLegs) {
      return "Pull Day (Back & Biceps)";
    }

    // Leg Day
    if (hasLegs && !hasChest && !hasBack) {
      return "Leg Day";
    }

    // Upper Body
    if ((hasChest || hasShoulders) && hasBack && !hasLegs) {
      return "Upper Body Workout";
    }

    // Single muscle group
    if (groups.length === 1) {
      return `${groups[0]} Workout`;
    }

    // Two muscle groups
    if (groups.length === 2) {
      return `${groups[0]} & ${groups[1]} Workout`;
    }

    // 3 or more varied groups
    return "Full Body Workout";
  }

  // Completes active workout session and triggers sync
  async finishActiveSession() {
    if (!this.activeSession || this.isFinishingSession) return;
    this.isFinishingSession = true;

    const finishBtn = document.getElementById("btn-finish-workout");
    if (finishBtn) finishBtn.disabled = true;

    try {
      const full = await localDB.getFullSession(this.activeSession.id);
      const hasSets = full && full.exercise_logs && full.exercise_logs.some((l) => l.sets && l.sets.length > 0);

      if (!hasSets) {
        const confirmEmpty = confirm("No sets logged in this session. Finish anyway?");
        if (!confirmEmpty) {
          if (finishBtn) finishBtn.disabled = false;
          this.isFinishingSession = false;
          return;
        }
      }

      // Determine final workout name and prompt with Option A modal if not explicitly named
      const nameInput = document.getElementById("session-name-input");
      let currentVal = (nameInput && nameInput.value.trim()) ? nameInput.value.trim() : (this.activeSession.name || "");
      const isDefaultFreeform = !currentVal || currentVal.toLowerCase() === "freeform workout";

      if (isDefaultFreeform) {
        const smartName = this.generateSmartWorkoutName(full ? full.exercise_logs : []) || "Workout";
        const userEntered = await this.promptWorkoutNameModal({
          title: "Name Your Workout",
          initialValue: smartName,
          placeholder: smartName,
          confirmText: "Save & Finish"
        });

        if (!userEntered) {
          // User clicked Cancel: abort finish so user can continue editing
          if (finishBtn) finishBtn.disabled = false;
          this.isFinishingSession = false;
          return;
        }

        const finalName = userEntered.trim() || smartName || "Workout";
        this.activeSession.name = finalName;
        if (nameInput) nameInput.value = finalName;
      } else {
        this.activeSession.name = currentVal;
      }

      this.activeSession.status = "completed";
      this.activeSession.completed_at = new Date().toISOString();
      if (!this.activeSession.started_at) {
        this.activeSession.started_at = this.activeSession.completed_at;
      }
      this.activeSession.synced = false;

      await localDB.put("workout_sessions", this.activeSession);
      await localDB.delete("app_meta", "active_session_id");

      this.stopTimer();
      this.resetTimerDisplay();
      if (this.restTimer) this.restTimer.skip();

      // Trigger immediate background sync to server
      await syncManager.syncNow();

      // Start a fresh workout draft
      await this.createNewActiveSession();
      this.switchView("view-history");
      this.showToast("Workout saved successfully!");
    } finally {
      if (finishBtn) finishBtn.disabled = false;
      this.isFinishingSession = false;
    }
  }

  // Render Workout History (Screen 3 Mockup)
  async renderHistory() {
    const list = document.getElementById("history-sessions-list");
    if (!list) return;

    this.historyRenderToken = (this.historyRenderToken || 0) + 1;
    const currentToken = this.historyRenderToken;

    await this.backfillLogMuscleGroups();
    if (currentToken !== this.historyRenderToken) return;

    const allSessions = await localDB.getAll("workout_sessions");
    if (currentToken !== this.historyRenderToken) return;

    const completed = allSessions
      .filter((s) => s.status === "completed")
      .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));

    // Deduplicate sessions in memory and purge duplicates from local storage
    const seenIds = new Set();
    const seenTimestamps = new Map();
    const uniqueSessions = [];
    const duplicateIdsToDelete = [];

    const parseUtcTime = (dt) => {
      if (!dt) return 0;
      const str = (typeof dt === "string" && !dt.endsWith("Z") && !dt.includes("+") && !dt.includes("-", 10))
        ? dt + "Z"
        : dt;
      return new Date(str).getTime();
    };

    for (const s of completed) {
      if (seenIds.has(s.id)) {
        duplicateIdsToDelete.push(s.id);
        continue;
      }
      seenIds.add(s.id);

      const timeKey = parseUtcTime(s.started_at);
      let isDuplicateTime = false;
      for (const [existingTime, existingSession] of seenTimestamps.entries()) {
        if (Math.abs(existingTime - timeKey) < 60000) {
          isDuplicateTime = true;
          if (!s.synced && existingSession.synced) {
            duplicateIdsToDelete.push(s.id);
          } else if (s.synced && !existingSession.synced) {
            duplicateIdsToDelete.push(existingSession.id);
            const idx = uniqueSessions.findIndex((us) => us.id === existingSession.id);
            if (idx !== -1) uniqueSessions[idx] = s;
            seenTimestamps.set(timeKey, s);
          } else {
            duplicateIdsToDelete.push(s.id);
          }
          break;
        }
      }

      if (!isDuplicateTime) {
        seenTimestamps.set(timeKey, s);
        uniqueSessions.push(s);
      }
    }

    if (duplicateIdsToDelete.length > 0) {
      for (const dupId of duplicateIdsToDelete) {
        localDB.delete("workout_sessions", dupId).catch(console.warn);
      }
    }

    if (uniqueSessions.length === 0) {
      list.innerHTML = `<div class="empty-state"><p>No completed workouts in history yet. Finish a workout to view records here.</p></div>`;
      return;
    }

    const allExercises = (await localDB.getAll("exercises")) || [];
    const cards = [];

    for (const session of uniqueSessions) {
      const full = await localDB.getFullSession(session.id);
      if (currentToken !== this.historyRenderToken) return;
      if (!full) continue;

      const card = document.createElement("div");
      card.className = "history-card";
      card.setAttribute("data-session-id", session.id);

      const dateObj = new Date(session.started_at);
      const dateDisplay = dateObj.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
      });

      let durationStr = "";
      if (session.completed_at) {
        const diffMs = new Date(session.completed_at) - new Date(session.started_at);
        const mins = Math.max(1, Math.round(diffMs / 60000));
        durationStr = `${mins} min`;
      }

      const totalSets = full.exercise_logs
        ? full.exercise_logs.reduce((acc, l) => acc + (l.sets ? l.sets.length : 0), 0)
        : 0;
      const totalExercises = full.exercise_logs ? full.exercise_logs.length : 0;

      // Total volume and per-muscle-group breakdown for this historical workout
      const { totalVolume: historyTotalVol, muscleVolumes: historyMuscleVols } = this.computeSessionVolume(full, allExercises);

      const summaryMeta = [
        `${totalExercises} exercise${totalExercises !== 1 ? "s" : ""}`,
        `${totalSets} set${totalSets !== 1 ? "s" : ""}`,
        `${Math.round(historyTotalVol).toLocaleString()} lbs`,
        durationStr
      ].filter(Boolean).join(" &bull; ");

      const historyVolumeHtml = `
        <div class="volume-panel history-volume-panel">
          <div class="volume-title-group">
            <span class="volume-panel-title">TOTAL WORKOUT VOLUME</span>
            <span class="volume-total-number">${Math.round(historyTotalVol).toLocaleString()} lbs</span>
          </div>
          <div class="category-breakdown-section">
            <span class="category-section-title">Volume by Muscle Group</span>
            <div class="category-breakdown-grid">
              ${historyMuscleVols.length > 0
          ? historyMuscleVols.map((m) => `
                  <div class="category-chip">
                    <span class="category-chip-name">${this.escapeHtml(m.muscle_group)}</span>
                    <span class="category-chip-vol">${Math.round(m.volume_lbs).toLocaleString()} lbs</span>
                  </div>`).join("")
          : `<span class="category-empty-text">No volume recorded</span>`}
            </div>
          </div>
        </div>
      `;

      const exerciseBreakdownHtml = (full.exercise_logs && full.exercise_logs.length > 0)
        ? full.exercise_logs.map((log) => {
          const exNotesHtml = log.notes
            ? `<div class="history-exercise-notes">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                  <span>${this.escapeHtml(log.notes)}</span>
                </div>`
            : "";

          const setsHtml = (log.sets && log.sets.length > 0)
            ? log.sets.map((set) => {
              const rirText = set.rir !== null && set.rir !== undefined ? `<span class="history-set-rir">${set.rir} RIR</span>` : "";
              const setNoteHtml = set.notes
                ? `<div class="history-set-note">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        </svg>
                        <span>${this.escapeHtml(set.notes)}</span>
                      </div>`
                : "";

              return `
                    <div class="history-set-item">
                      <div class="history-set-main">
                        <span class="history-set-num">Set ${set.set_number}</span>
                        <span class="history-set-stat">${set.weight.toFixed(1)} lbs &times; ${set.reps} reps</span>
                        ${rirText}
                      </div>
                      ${setNoteHtml}
                    </div>
                  `;
            }).join("")
            : `<div class="empty-state" style="padding: 10px 0;"><p>No sets logged</p></div>`;

          return `
              <div class="history-exercise-section">
                <div class="history-exercise-header">
                  <div class="history-exercise-title-row">
                    <h4>${this.escapeHtml(log.exercise_name)}</h4>
                    ${log.target_muscle_group && log.target_muscle_group !== "Other" ? `<span class="history-exercise-mg-badge">${this.escapeHtml(log.target_muscle_group)}</span>` : ""}
                  </div>
                  <span class="history-exercise-count">${log.sets ? log.sets.length : 0} sets</span>
                </div>
                ${exNotesHtml}
                <div class="history-sets-table">
                  ${setsHtml}
                </div>
              </div>
            `;
        }).join("")
        : `<div class="empty-state"><p>No exercises recorded for this session.</p></div>`;

      card.innerHTML = `
        <div class="history-card-header">
          <div class="history-card-header-left">
            <div class="history-title-row">
              <h3>${dateDisplay}: <span class="history-workout-name-text">${this.escapeHtml(session.name || "Workout")}</span></h3>
              <button type="button" class="history-rename-btn icon-btn-inline" data-session-id="${session.id}" data-session-name="${this.escapeHtml(session.name || "Workout")}" title="Rename Workout" aria-label="Rename Workout">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
            </div>
            <span class="history-date">${summaryMeta}</span>
          </div>
          <div class="history-card-header-right">
            <span class="status-pill inline">
              <span class="status-dot ${session.synced ? "online" : "draft"}"></span>
              <span>${session.synced ? "Synced" : "Local"}</span>
            </span>
            <svg class="history-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
        </div>
        <div class="history-card-details">
          ${historyVolumeHtml}
          <div class="history-session-notes-box">
            <div class="history-session-notes-header">
              <span class="history-notes-label">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                <span>Workout Notes:</span>
              </span>
              <button type="button" class="history-notes-edit-btn" data-session-id="${session.id}">${session.session_notes ? "Edit Note" : "+ Add Note"}</button>
            </div>
            <p class="history-notes-text">${session.session_notes ? this.escapeHtml(session.session_notes) : `<span style="color: var(--text-subtle); font-style: italic;">No session notes entered. Tap to add plan or reflections.</span>`}</p>
          </div>
          ${exerciseBreakdownHtml}
          <div class="history-actions-bar">
            <button type="button" class="btn btn-secondary btn-sm history-rename-btn" data-session-id="${session.id}" data-session-name="${this.escapeHtml(session.name || "Workout")}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
              Rename
            </button>
            <button class="btn btn-primary btn-sm history-ai-insights-btn" data-session-id="${session.id}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="margin-right: 4px;">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 16v-4M12 8h.01"></path>
              </svg>
              AI Insights
            </button>
            <button class="btn btn-neutral btn-sm history-delete-btn">Delete Workout</button>
          </div>
        </div>
      `;

      card.addEventListener("click", (e) => {
        if (e.target.closest(".history-delete-btn") || e.target.closest(".history-notes-edit-btn") || e.target.closest(".history-ai-insights-btn") || e.target.closest(".history-rename-btn")) return;
        card.classList.toggle("expanded");
      });

      const renameBtns = card.querySelectorAll(".history-rename-btn");
      renameBtns.forEach((rBtn) => {
        rBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const sid = rBtn.getAttribute("data-session-id");
          const sname = rBtn.getAttribute("data-session-name") || session.name || "Freeform Workout";
          this.openRenameWorkoutModal(sid, sname);
        });
      });

      const editNotesBtn = card.querySelector(".history-notes-edit-btn");
      if (editNotesBtn) {
        editNotesBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.openEditWorkoutNotesModal(session);
        });
      }

      const aiInsightsBtn = card.querySelector(".history-ai-insights-btn");
      if (aiInsightsBtn) {
        aiInsightsBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.selectedInsightsSessionId = session.id;
          this.switchView("view-insights");
        });
      }

      const deleteBtn = card.querySelector(".history-delete-btn");
      if (deleteBtn) {
        deleteBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const confirmed = confirm("Are you sure you want to delete this workout?");
          if (!confirmed) return;

          await localDB.delete("workout_sessions", session.id);
          if (full.exercise_logs) {
            for (const log of full.exercise_logs) {
              await localDB.delete("exercise_logs", log.id);
              if (log.sets) {
                for (const set of log.sets) {
                  await localDB.delete("set_entries", set.id);
                }
              }
            }
          }

          if (navigator.onLine && session.synced) {
            try {
              await fetch(`${API_BASE_URL}/sessions/${session.id}`, { method: "DELETE" });
            } catch (err) {
              console.warn("Could not delete session from server:", err);
            }
          }

          this.showToast("Workout deleted");
          await this.renderHistory();
          this.updateDiagnostics();
        });
      }

      cards.push(card);
    }

    if (currentToken !== this.historyRenderToken) return;
    list.replaceChildren(...cards);
  }

  // Render Exercise Catalog
  async renderCatalog(searchQuery = "") {
    const list = document.getElementById("catalog-list");
    if (!list) return;

    const all = await localDB.getAll("exercises");
    let filtered = all;

    if (this.currentFilterMuscle !== "all") {
      filtered = filtered.filter((ex) => ex.target_muscle_group === this.currentFilterMuscle);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((ex) => ex.name.toLowerCase().includes(q));
    }

    // Defensive in-memory deduplication by normalized name
    const seenNames = new Set();
    filtered = filtered.filter((ex) => {
      const norm = (ex.name || "").trim().toLowerCase();
      if (!norm || seenNames.has(norm)) return false;
      seenNames.add(norm);
      return true;
    });

    filtered.sort((a, b) => a.name.localeCompare(b.name));
    list.innerHTML = "";

    if (filtered.length === 0) {
      list.innerHTML = `<div class="empty-state"><p>No exercises match your search.</p></div>`;
      return;
    }

    filtered.forEach((ex) => {
      const item = document.createElement("div");
      item.className = "catalog-item";
      item.style.cursor = "pointer";
      item.innerHTML = `
        <div style="flex: 1;">
          <div style="font-weight: 600; font-size: 0.9rem;">${this.escapeHtml(ex.name)}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${this.escapeHtml(ex.target_muscle_group)} &bull; ${this.escapeHtml(ex.default_equipment || "Standard")}</div>
        </div>
        <button class="btn-edit-catalog-item" style="padding: 4px 10px; font-size: 0.75rem; border-radius: 6px; border: 1px solid var(--border-color); background: rgba(255, 255, 255, 0.06); color: var(--text-main); font-weight: 600;">Edit</button>
      `;
      item.querySelector(".btn-edit-catalog-item").addEventListener("click", (e) => {
        e.stopPropagation();
        this.openEditExerciseModal(ex);
      });
      item.addEventListener("click", () => {
        this.openEditExerciseModal(ex);
      });
      list.appendChild(item);
    });
  }

  openEditExerciseModal(exercise) {
    const modal = document.getElementById("modal-edit-exercise");
    if (!modal) return;

    document.getElementById("edit-ex-id").value = exercise.id;
    document.getElementById("edit-ex-name").value = exercise.name || "";
    document.getElementById("edit-ex-muscle").value = exercise.target_muscle_group || "Other";
    document.getElementById("edit-ex-equipment").value = exercise.default_equipment || "";

    modal.classList.remove("hidden");
    history.pushState({ isModal: true }, "");
  }

  // Modal: Select Exercise to add to Active Workout
  async openSelectExerciseModal() {
    const modal = document.getElementById("modal-select-exercise");
    const list = document.getElementById("modal-exercise-list");
    const search = document.getElementById("modal-exercise-search");

    modal.classList.remove("hidden");
    history.pushState({ isModal: true }, "");
    search.value = "";

    const renderModalItems = async (query = "") => {
      const all = await localDB.getAll("exercises");
      let filtered = all;
      if (query.trim()) {
        filtered = filtered.filter((ex) => ex.name.toLowerCase().includes(query.toLowerCase()));
      }

      // Defensive in-memory deduplication by normalized name
      const seenNames = new Set();
      filtered = filtered.filter((ex) => {
        const norm = (ex.name || "").trim().toLowerCase();
        if (!norm || seenNames.has(norm)) return false;
        seenNames.add(norm);
        return true;
      });

      filtered.sort((a, b) => a.name.localeCompare(b.name));

      list.innerHTML = "";
      filtered.forEach((ex) => {
        const item = document.createElement("div");
        item.className = "modal-list-item";
        item.innerHTML = `
          <div>
            <div style="font-weight: 600; font-size: 0.88rem;">${ex.name}</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">${ex.target_muscle_group} &bull; ${ex.default_equipment || "Standard"}</div>
          </div>
          <button class="btn btn-primary btn-sm">&plus; Add</button>
        `;

        item.addEventListener("click", async () => {
          modal.classList.add("hidden");
          await this.addExerciseToActiveWorkout(ex);
        });

        list.appendChild(item);
      });
    };

    search.oninput = (e) => renderModalItems(e.target.value);
    await renderModalItems();
  }

  async addExerciseToActiveWorkout(exercise) {
    if (!this.activeSession) return;

    // Start workout session timer on first added exercise if not already active
    if (!this.activeSession.started_at || !this.startTime) {
      const nowIso = new Date().toISOString();
      this.activeSession.started_at = nowIso;
      this.startTime = new Date(nowIso);
      await localDB.put("workout_sessions", this.activeSession);
      this.startTimer();
    }

    const existingLogs = await localDB.getByIndex("exercise_logs", "workout_session_id", this.activeSession.id);
    const nextOrder = existingLogs.length;

    const newLog = {
      id: crypto.randomUUID(),
      workout_session_id: this.activeSession.id,
      exercise_id: exercise.id,
      order_index: nextOrder,
      notes: null,
      exercise_name: exercise.name,
      target_muscle_group: (exercise.target_muscle_group && exercise.target_muscle_group !== "Other")
        ? exercise.target_muscle_group
        : (localDB.inferMuscleGroup ? localDB.inferMuscleGroup(exercise.name) : "Other")
    };

    await localDB.put("exercise_logs", newLog);
    await this.renderWorkoutOverview();

    // Immediately open set logger for the newly added exercise
    this.openExerciseLogger(newLog);
  }

  populateMuscleGroupDropdowns() {
    const groups = [
      "Chest",
      "Back",
      "Shoulders",
      "Biceps",
      "Triceps",
      "Quads",
      "Hamstrings",
      "Glutes",
      "Calves",
      "Core",
      "Other"
    ];

    ["create-ex-muscle", "edit-ex-muscle"].forEach((selectId) => {
      const select = document.getElementById(selectId);
      if (select) {
        const currentVal = select.value;
        select.innerHTML = groups.map((g) => `<option value="${g}">${g}</option>`).join("");
        if (currentVal && groups.includes(currentVal)) {
          select.value = currentVal;
        }
      }
    });

    const chipsContainer = document.getElementById("muscle-chips");
    if (chipsContainer) {
      const currentActive = this.currentFilterMuscle || "all";
      let chipsHtml = `<button class="chip ${currentActive === "all" ? "active" : ""}" data-muscle="all">All</button>`;
      groups.forEach((g) => {
        if (g !== "Other") {
          chipsHtml += `<button class="chip ${currentActive === g ? "active" : ""}" data-muscle="${g}">${g}</button>`;
        }
      });
      chipsContainer.innerHTML = chipsHtml;
      chipsContainer.querySelectorAll(".chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          chipsContainer.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
          chip.classList.add("active");
          this.currentFilterMuscle = chip.getAttribute("data-muscle");
          this.renderCatalog(document.getElementById("exercise-search").value);
        });
      });
    }
  }

  // Shows local IndexedDB record counts in the AI Insights system status card
  async updateDiagnostics() {
    const el = document.getElementById("storage-diagnostics");
    if (!el) return;

    const exercises = await localDB.getAll("exercises");
    const sessions = await localDB.getAll("workout_sessions");
    const logs = await localDB.getAll("exercise_logs");
    const sets = await localDB.getAll("set_entries");

    el.innerHTML = `
      Local IndexedDB records:<br>
      &bull; Exercises: ${exercises.length}<br>
      &bull; Sessions: ${sessions.length} (${sessions.filter((s) => s.synced).length} synced)<br>
      &bull; Logs: ${logs.length}<br>
      &bull; Sets: ${sets.length}
    `;
  }

  // Sums weight * reps for a full session, overall and per muscle group (sorted high to low)
  computeSessionVolume(fullSession, exerciseCatalog = null) {
    let totalVolume = 0;
    const map = {};
    (fullSession.exercise_logs || []).forEach((log) => {
      let mg = (log.target_muscle_group && log.target_muscle_group !== "Other")
        ? log.target_muscle_group
        : null;

      let match = null;
      if (!mg && exerciseCatalog && exerciseCatalog.length > 0) {
        match = exerciseCatalog.find((e) =>
          (log.exercise_id && (
            e.id === log.exercise_id ||
            String(e.id).replace(/-/g, "").toLowerCase() === String(log.exercise_id).replace(/-/g, "").toLowerCase()
          )) ||
          (log.exercise_name && e.name && (
            e.name.trim().toLowerCase() === log.exercise_name.trim().toLowerCase() ||
            log.exercise_name.toLowerCase().includes(e.name.toLowerCase()) ||
            e.name.toLowerCase().includes(log.exercise_name.toLowerCase())
          ))
        );
        if (match && match.target_muscle_group && match.target_muscle_group !== "Other") {
          mg = match.target_muscle_group;
        }
      }

      if (!mg || mg === "Other") {
        const candidateName = log.exercise_name || (match ? match.name : "");
        mg = (localDB.inferMuscleGroup ? localDB.inferMuscleGroup(candidateName) : "Other") || "Other";
      }

      (log.sets || []).forEach((s) => {
        const weight = Number(s.weight) || 0;
        const reps = Number(s.reps) || 0;
        const v = weight * reps;
        totalVolume += v;
        map[mg] = (map[mg] || 0) + v;
      });
    });
    const muscleVolumes = Object.entries(map)
      .map(([muscle_group, volume_lbs]) => ({ muscle_group, volume_lbs }))
      .sort((a, b) => b.volume_lbs - a.volume_lbs);
    return { totalVolume, muscleVolumes };
  }

  // Fingerprint of everything the coach looks at; cached insights are reused only if it matches
  computeInsightsSignature(fullSession) {
    return JSON.stringify({
      n: fullSession.name || "",
      sn: fullSession.session_notes || "",
      l: (fullSession.exercise_logs || []).map((l) => [
        l.exercise_id,
        l.notes || "",
        (l.sets || []).map((s) => [s.weight, s.reps, s.rir, s.notes || ""])
      ])
    });
  }

  // Prompt modal for workout naming and renaming, returning a Promise<string | null>
  promptWorkoutNameModal({ title = "Name Your Workout", initialValue = "", placeholder = "e.g. Chest & Triceps, Leg Day...", confirmText = "Save Name" } = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById("modal-rename-workout");
      const titleEl = document.getElementById("rename-workout-modal-title");
      const nameInput = document.getElementById("rename-session-name-input");
      const submitBtn = document.getElementById("btn-save-rename-workout");
      const form = document.getElementById("form-rename-workout");
      const cancelBtn = document.getElementById("btn-cancel-rename-workout");
      const closeBtn = document.getElementById("btn-close-rename-workout-modal");

      if (!modal || !nameInput || !form) {
        resolve(initialValue || "Workout");
        return;
      }

      if (titleEl) titleEl.textContent = title;
      if (submitBtn) submitBtn.textContent = confirmText;
      nameInput.value = initialValue || "";
      nameInput.placeholder = placeholder || "e.g. Chest & Triceps, Leg Day...";

      modal.classList.remove("hidden");
      history.pushState({ isModal: true }, "");

      setTimeout(() => {
        nameInput.focus();
        nameInput.select();
      }, 50);

      let settled = false;

      const cleanup = () => {
        modal.classList.add("hidden");
        form.removeEventListener("submit", handleSubmit);
        if (cancelBtn) cancelBtn.removeEventListener("click", handleCancel);
        if (closeBtn) closeBtn.removeEventListener("click", handleCancel);
      };

      const handleSubmit = (e) => {
        e.preventDefault();
        if (settled) return;
        settled = true;
        const entered = nameInput.value.trim() || initialValue || "Workout";
        cleanup();
        resolve(entered);
      };

      const handleCancel = (e) => {
        if (e) e.preventDefault();
        if (settled) return;
        settled = true;
        cleanup();
        resolve(null);
      };

      form.addEventListener("submit", handleSubmit);
      if (cancelBtn) cancelBtn.addEventListener("click", handleCancel);
      if (closeBtn) closeBtn.addEventListener("click", handleCancel);
    });
  }

  // Open modal to rename a workout
  async openRenameWorkoutModal(sessionId, currentName = "") {
    const defaultName = (currentName && currentName !== "Freeform Workout") ? currentName : "";
    const newName = await this.promptWorkoutNameModal({
      title: "Rename Workout",
      initialValue: defaultName,
      placeholder: defaultName || "e.g. Chest & Triceps, Leg Day...",
      confirmText: "Save Name"
    });

    if (newName && newName.trim()) {
      await this.saveWorkoutName(sessionId, newName.trim());
    }
  }

  // Save workout name for any session (active or past)
  async saveWorkoutName(sessionId, newName) {
    const trimmed = (newName || "").trim() || "Workout";
    const session = await localDB.get("workout_sessions", sessionId);
    if (!session) return;
    session.name = trimmed;
    session.synced = false;
    delete session.ai_insights; // Invalidate cached insights
    await localDB.put("workout_sessions", session);

    if (this.activeSession && this.activeSession.id === sessionId) {
      this.activeSession.name = trimmed;
      const nameInput = document.getElementById("session-name-input");
      if (nameInput) nameInput.value = trimmed;
    }

    this.showToast("Workout renamed successfully");

    // Attempt direct PATCH if online
    if (navigator.onLine) {
      try {
        const patchRes = await fetch(`${API_BASE_URL}/sessions/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed })
        });
        if (patchRes.ok) {
          session.synced = true;
          await localDB.put("workout_sessions", session);
        }
      } catch (err) {
        console.warn("Direct PATCH session name notice:", err);
      }
    }

    await syncManager.syncNow();

    if (this.currentView === "view-history") {
      await this.renderHistory();
    } else if (this.currentView === "view-insights") {
      await this.renderInsightsView();
    } else if (this.currentView === "view-workout") {
      await this.renderWorkoutOverview();
    }
  }

  // Open modal to add or edit workout notes on a session
  openEditWorkoutNotesModal(session) {
    const modal = document.getElementById("modal-edit-workout-notes");
    if (!modal) return;
    const idInput = document.getElementById("edit-session-notes-id");
    const textInput = document.getElementById("edit-session-notes-text");
    const titleLabel = document.getElementById("edit-session-notes-title-label");

    if (idInput) idInput.value = session.id;
    if (textInput) textInput.value = session.session_notes || "";
    if (titleLabel) {
      titleLabel.textContent = `Notes for ${session.name || "Workout"} (${new Date(session.started_at).toLocaleDateString()})`;
    }
    modal.classList.remove("hidden");
    if (textInput) textInput.focus();
  }

  // Save workout notes for any session (active or past)
  async saveWorkoutNotes(sessionId, newNotes) {
    const session = await localDB.get("workout_sessions", sessionId);
    if (!session) return;
    session.session_notes = newNotes;
    session.synced = false;
    delete session.ai_insights; // Invalidate cached insights so they refresh with new notes
    await localDB.put("workout_sessions", session);

    if (this.activeSession && this.activeSession.id === sessionId) {
      this.activeSession.session_notes = newNotes;
      const notesInput = document.getElementById("session-notes-input");
      if (notesInput) notesInput.value = newNotes || "";
    }

    this.showToast("Workout notes saved");
    await syncManager.syncNow();
    if (this.currentView === "view-history") {
      await this.renderHistory();
    } else if (this.currentView === "view-insights") {
      await this.renderInsightsView();
    }
  }

  // Render the dynamic AI Insights dashboard
  async renderInsightsView() {
    this.updateDiagnostics();
    const container = document.getElementById("insights-results-container");
    const selectorScroll = document.getElementById("insights-workout-selector");
    const totalCountEl = document.getElementById("insights-total-workouts-count");
    if (!selectorScroll || !container) return;

    // Retrieve all completed sessions and active draft
    const allSessions = await localDB.getAll("workout_sessions");
    const completed = allSessions
      .filter((s) => s.status === "completed")
      .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));

    // Deduplicate completed sessions by ID and timestamp
    const seenIds = new Set();
    const uniqueWorkouts = [];
    for (const s of completed) {
      if (!seenIds.has(s.id)) {
        seenIds.add(s.id);
        uniqueWorkouts.push(s);
      }
    }

    const availableWorkouts = [];
    if (this.activeSession) {
      availableWorkouts.push(this.activeSession);
    }
    uniqueWorkouts.forEach((w) => availableWorkouts.push(w));

    if (totalCountEl) {
      totalCountEl.textContent = `${availableWorkouts.length} workout${availableWorkouts.length !== 1 ? "s" : ""}`;
    }

    if (availableWorkouts.length === 0) {
      selectorScroll.innerHTML = `<div class="empty-state" style="padding: 6px;"><p>No workouts recorded yet.</p></div>`;
      container.innerHTML = `
        <div class="empty-state">
          <p>Start a workout or finish logging sets to view AI volume analytics, progression recommendations, and form cues.</p>
        </div>
      `;
      document.getElementById("insights-action-card")?.classList.add("hidden");
      return;
    }

    // Determine currently selected session
    if (!this.selectedInsightsSessionId || !availableWorkouts.some((w) => w.id === this.selectedInsightsSessionId)) {
      this.selectedInsightsSessionId = availableWorkouts[0].id;
    }

    // Render selector chips
    selectorScroll.innerHTML = "";
    for (const w of availableWorkouts) {
      const isSelected = w.id === this.selectedInsightsSessionId;
      const isActiveDraft = w.status === "in_progress" || (this.activeSession && this.activeSession.id === w.id);

      const full = await localDB.getFullSession(w.id);
      let vol = 0;
      if (full && full.exercise_logs) {
        full.exercise_logs.forEach((l) => {
          (l.sets || []).forEach((s) => {
            vol += (s.weight || 0) * (s.reps || 0);
          });
        });
      }

      const dateStr = w.started_at
        ? new Date(w.started_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : "Today";

      const chip = document.createElement("div");
      chip.className = `insight-chip-item ${isSelected ? "active" : ""}`;
      chip.setAttribute("data-session-id", w.id);
      chip.innerHTML = `
        <span class="chip-status-tag ${isActiveDraft ? "active-tag" : "past-tag"}">
          ${isActiveDraft ? "In Progress" : dateStr}
        </span>
        <span class="chip-workout-name">${this.escapeHtml(w.name || "Workout")}</span>
        <span class="chip-workout-vol">${Math.round(vol).toLocaleString()} lbs</span>
      `;

      chip.addEventListener("click", () => {
        this.selectedInsightsSessionId = w.id;
        document.querySelectorAll(".insight-chip-item").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        this.displaySelectedWorkoutInsights(w.id);
      });

      if (isSelected) {
        setTimeout(() => chip.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }), 50);
      }

      selectorScroll.appendChild(chip);
    }

    // Display the currently selected workout's insights
    await this.displaySelectedWorkoutInsights(this.selectedInsightsSessionId);
  }

  // Display insights for the selected workout
  async displaySelectedWorkoutInsights(sessionId) {
    const actionCard = document.getElementById("insights-action-card");
    const titleEl = document.getElementById("insights-selected-title");
    const metaEl = document.getElementById("insights-selected-meta");
    const container = document.getElementById("insights-results-container");
    if (!container) return;

    const fullSession = await localDB.getFullSession(sessionId);
    if (!fullSession) {
      container.innerHTML = `<div class="empty-state"><p>Workout session not found.</p></div>`;
      return;
    }

    const isActiveDraft = fullSession.status === "in_progress" || (this.activeSession && this.activeSession.id === fullSession.id);
    const dateDisplay = fullSession.started_at
      ? new Date(fullSession.started_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
      })
      : "Active Today";

    const totalSets = (fullSession.exercise_logs || []).reduce((acc, l) => acc + (l.sets ? l.sets.length : 0), 0);
    const totalExercises = (fullSession.exercise_logs || []).length;

    if (actionCard && titleEl && metaEl) {
      actionCard.classList.remove("hidden");
      titleEl.textContent = `${fullSession.name || "Workout"} ${isActiveDraft ? "(In Progress)" : ""}`;
      metaEl.textContent = `${dateDisplay} • ${totalExercises} exercise${totalExercises !== 1 ? "s" : ""} • ${totalSets} set${totalSets !== 1 ? "s" : ""}`;
    }

    // Reuse cached insights only if the workout has not changed since they were generated
    if (fullSession.ai_insights && fullSession.ai_insights_signature === this.computeInsightsSignature(fullSession)) {
      this.renderInsightsContent(fullSession.ai_insights, fullSession);
      return;
    }

    // If no sets and no notes, prompt to log
    if (totalSets === 0 && !fullSession.session_notes) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No sets or workout notes have been logged for "${this.escapeHtml(fullSession.name || "Workout")}". Add notes or complete sets to generate AI insights.</p>
        </div>
      `;
      return;
    }

    // Automatically trigger analysis for this workout
    await this.runWorkoutAIInsights(sessionId, false);
  }

  // Execute AI analysis via API or local deterministic engine
  async runWorkoutAIInsights(sessionId, forceRefresh = false) {
    const container = document.getElementById("insights-results-container");
    const runBtn = document.getElementById("btn-run-insights");
    const engineBadge = document.getElementById("ai-engine-status");
    if (!container) return;

    const fullSession = await localDB.getFullSession(sessionId);
    if (!fullSession) return;

    // Token guards against an older, slower request overwriting a newer selection
    this.insightsRequestToken = (this.insightsRequestToken || 0) + 1;
    const requestToken = this.insightsRequestToken;

    // Show loading state
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.innerHTML = `
        <svg class="spin-loader" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
          <path d="M12 2a10 10 0 0 1 10 10"></path>
        </svg>
        <span>Analyzing...</span>
      `;
    }

    container.innerHTML = `
      <div class="empty-state" style="padding: 30px 10px;">
        <svg class="spin-loader" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent-gold)" stroke-width="2.5" style="margin-bottom: 12px;">
          <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
          <path d="M12 2a10 10 0 0 1 10 10"></path>
        </svg>
        <p style="color: var(--text-main); font-weight: 600;">Analyzing Volume, Biomechanics &amp; Overload Targets...</p>
        <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">Evaluating set notes, RIR, and session plan...</p>
      </div>
    `;

    let durationMins = null;
    if (fullSession.completed_at && fullSession.started_at) {
      durationMins = Math.max(1, Math.round((new Date(fullSession.completed_at) - new Date(fullSession.started_at)) / 60000));
    }

    const payload = {
      workout_name: fullSession.name || "Workout",
      session_notes: fullSession.session_notes || null,
      duration_minutes: durationMins,
      exercises: (fullSession.exercise_logs || []).map((l) => ({
        exercise_name: l.exercise_name || "Exercise",
        target_muscle_group: (l.target_muscle_group && l.target_muscle_group !== "Other")
          ? l.target_muscle_group
          : (localDB.inferMuscleGroup ? localDB.inferMuscleGroup(l.exercise_name) : null),
        exercise_notes: l.notes || null,
        completed_sets: (l.sets || []).map((s) => ({
          set_number: s.set_number,
          set_type: s.set_type || "normal",
          weight: s.weight || 0,
          reps: s.reps || 0,
          rir: s.rir !== undefined ? s.rir : null,
          completed: !!s.completed,
          notes: s.notes || null
        }))
      }))
    };

    let insights = null;
    let engineSource = "Cloud Coach";

    // Attempt server request (time-boxed so the UI never hangs)
    if (navigator.onLine) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      try {
        const res = await fetch(`${API_BASE_URL}/coach/workout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        if (res.ok) {
          insights = await res.json();
          engineSource = "Gemini Strength Engine";
        }
      } catch (err) {
        console.warn("Server AI coach error, using deterministic engine:", err);
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // Local deterministic fallback engine
    if (!insights) {
      insights = this.generateLocalWorkoutInsights(fullSession);
      engineSource = "Local Strength Engine";
    }

    if (engineBadge) {
      engineBadge.textContent = engineSource;
    }

    // Cache insights on the stored session record only (never write nested logs back)
    const storedSession = await localDB.get("workout_sessions", sessionId);
    if (storedSession) {
      storedSession.ai_insights = insights;
      storedSession.ai_insights_signature = this.computeInsightsSignature(fullSession);
      await localDB.put("workout_sessions", storedSession);
    }

    // A newer request superseded this one; drop the result
    if (requestToken !== this.insightsRequestToken) return;

    if (runBtn) {
      runBtn.disabled = false;
      runBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
        </svg>
        <span>Refresh Insights</span>
      `;
    }

    this.renderInsightsContent(insights, fullSession);
  }

  // Deterministic local client fallback engine
  generateLocalWorkoutInsights(fullSession) {
    const muscleMap = {};
    let totalVol = 0;
    const progressionSuggestions = [];
    const formCues = [];
    const highlights = [];

    (fullSession.exercise_logs || []).forEach((ex) => {
      const mg = (ex.target_muscle_group && ex.target_muscle_group !== "Other")
        ? ex.target_muscle_group
        : (localDB.inferMuscleGroup ? localDB.inferMuscleGroup(ex.exercise_name) : "Full Body");
      let exVol = 0;
      let maxWeight = 0;
      let bestSet = null;
      const rirs = [];
      const allNotes = [];
      if (ex.notes) allNotes.push(ex.notes);

      (ex.sets || []).forEach((s) => {
        const vol = (s.weight || 0) * (s.reps || 0);
        exVol += vol;
        totalVol += vol;
        muscleMap[mg] = (muscleMap[mg] || 0) + vol;
        if ((s.weight || 0) > maxWeight) {
          maxWeight = s.weight || 0;
          bestSet = s;
        }
        if (s.rir !== null && s.rir !== undefined) rirs.push(s.rir);
        if (s.notes) allNotes.push(s.notes);
      });

      if (bestSet) {
        const avgRir = rirs.length > 0 ? rirs.reduce((a, b) => a + b, 0) / rirs.length : 2;
        let nextWeight = maxWeight;
        let rec = "";
        if (avgRir >= 2) {
          const inc = maxWeight >= 100 ? 5 : 2.5;
          nextWeight = Math.round((maxWeight + inc) / 2.5) * 2.5;
          rec = `Average RIR of ${avgRir.toFixed(1)} confirms reserve capacity. Increase working load to ${nextWeight} lbs next session for progressive overload.`;
        } else if (avgRir === 0) {
          nextWeight = maxWeight;
          rec = `Working sets reached technical failure (RIR 0). Maintain ${nextWeight} lbs next session and aim for 1-2 additional clean reps before advancing weight.`;
        } else {
          nextWeight = Math.round((maxWeight + 2.5) / 2.5) * 2.5;
          rec = `Optimal training intensity achieved (RIR ~1). Consider a micro-progression to ${nextWeight} lbs or adding another set next cycle.`;
        }

        progressionSuggestions.push({
          exercise_name: ex.exercise_name || "Exercise",
          current_performance: `${bestSet.weight} lbs x ${bestSet.reps} reps (RIR ${bestSet.rir !== null && bestSet.rir !== undefined ? bestSet.rir : "N/A"})`,
          suggested_weight: nextWeight,
          suggested_reps: bestSet.reps,
          suggested_sets: (ex.sets || []).length,
          recommendation: rec
        });
      }

      const combinedNotes = allNotes.join(" ").toLowerCase();
      if (combinedNotes.includes("flare") || combinedNotes.includes("elbow")) {
        formCues.push({
          exercise_name: ex.exercise_name || "Exercise",
          form_cue: "Tuck elbows to 45–60 degrees relative to your torso.",
          observation: `Notes indicated elbow flare or shoulder stress on ${ex.exercise_name}.`,
          maintenance_tip: "Pack shoulder blades into your back pockets and actively pull the bar toward your chest to engage lats."
        });
      } else if (combinedNotes.includes("back") || combinedNotes.includes("spine") || combinedNotes.includes("round")) {
        formCues.push({
          exercise_name: ex.exercise_name || "Exercise",
          form_cue: "Brace intra-abdominal pressure (Valsalva) and maintain a rigid neutral spine.",
          observation: `Notes indicated lumbar or spine fatigue on ${ex.exercise_name}.`,
          maintenance_tip: "Hinge cleanly from the hips and lead with the chest; do not initiate movement by flexing lumbar vertebrae."
        });
      } else if (combinedNotes.includes("knee") || combinedNotes.includes("cave") || combinedNotes.includes("valgus")) {
        formCues.push({
          exercise_name: ex.exercise_name || "Exercise",
          form_cue: "Drive knees outward over your 2nd and 3rd toes throughout the movement.",
          observation: `Notes indicated knee collapse or uneven tracking on ${ex.exercise_name}.`,
          maintenance_tip: "Maintain tripod foot contact (heel, big toe, pinky toe) and corkscrew feet into the floor."
        });
      } else if (combinedNotes.includes("heavy") || combinedNotes.includes("struggle") || combinedNotes.includes("slow")) {
        formCues.push({
          exercise_name: ex.exercise_name || "Exercise",
          form_cue: "Maintain consistent bar path velocity through the sticking point.",
          observation: `Lifter experienced significant load resistance on ${ex.exercise_name}.`,
          maintenance_tip: "Commit to aggressive concentric drive while keeping core stability completely locked."
        });
      } else if ((ex.sets || []).length > 0) {
        formCues.push({
          exercise_name: ex.exercise_name || "Exercise",
          form_cue: "Control the eccentric phase for 2-3 seconds to maximize mechanical tension.",
          observation: `Key biomechanical cue for ${ex.exercise_name}.`,
          maintenance_tip: "Pause momentarily at the deepest stretch without relaxing active muscular contraction."
        });
      }

      if (exVol > 0) {
        highlights.push(`${ex.exercise_name}: ${Math.round(exVol).toLocaleString()} lbs moved across ${(ex.sets || []).length} sets`);
      }
    });

    const muscleGroupVolumes = Object.entries(muscleMap)
      .map(([k, v]) => ({ muscle_group: k, volume_lbs: Math.round(v * 10) / 10 }))
      .sort((a, b) => b.volume_lbs - a.volume_lbs);

    let strainRating = "light";
    if (totalVol < 4000) strainRating = "light";
    else if (totalVol < 12000) strainRating = "moderate";
    else if (totalVol < 22000) strainRating = "high";
    else strainRating = "excessive";

    let workoutNotesFeedback = "";
    if (fullSession.session_notes && fullSession.session_notes.trim()) {
      workoutNotesFeedback = `Session Plan & Execution Review: You noted '${fullSession.session_notes.trim()}'. Your session demonstrated targeted intent with ${(fullSession.exercise_logs || []).length} exercises logged and ${Math.round(totalVol).toLocaleString()} lbs of mechanical work. Continuing to reflect on physical readiness and session objectives reinforces systematic strength development.`;
    } else {
      workoutNotesFeedback = `No workout notes were recorded for this session. Pro-tip: Jotting down your target focus, pre-workout energy, or planned RIR in the Workout Notes field enables the AI Coach to track mental readiness and adapt intensity recommendations.`;
    }

    const targetMuscleGroups = Object.keys(muscleMap);
    return {
      overall_assessment: `Completed ${(fullSession.exercise_logs || []).length} exercises across ${targetMuscleGroups.length} muscle groups generating ${Math.round(totalVol).toLocaleString()} lbs of total mechanical work. Training strain rated as ${strainRating}.`,
      strain_rating: strainRating,
      total_volume_lbs: totalVol,
      target_muscle_groups: targetMuscleGroups,
      muscle_group_volumes: muscleGroupVolumes,
      workout_notes_feedback: workoutNotesFeedback,
      progression_suggestions: progressionSuggestions,
      form_cues: formCues,
      highlights: highlights,
      recovery_recommendations: `Hydrate with 500-750ml water enriched with electrolytes. Target 30-40g high-quality protein within 2 hours to initiate muscle protein synthesis for ${targetMuscleGroups.join(", ") || "worked muscles"}. Allow 48 hours before taxing these primary muscle groups with heavy compound loading again.`
    };
  }

  // Render the generated AI insights into stunning HTML components
  renderInsightsContent(insights, fullSession) {
    const container = document.getElementById("insights-results-container");
    if (!container) return;

    // 1. Session Assessment & Workout Notes Feedback
    const strainClass = (insights.strain_rating || "moderate").toLowerCase();
    const strainLabel = (insights.strain_rating || "Moderate").toUpperCase();

    const notesFeedbackHtml = `
      <div class="insight-session-notes-feedback">
        <span class="insight-notes-quote-title">Lifter's Session Notes &amp; Plan</span>
        <p class="insight-notes-quote-body">${fullSession.session_notes ? `"${this.escapeHtml(fullSession.session_notes)}"` : `<span style="font-style: italic; color: var(--text-subtle);">No session notes recorded for this workout.</span>`}</p>
        <p class="insight-notes-feedback-body">${this.escapeHtml(insights.workout_notes_feedback || "")}</p>
      </div>
    `;

    // 2. Volume by Muscle Group
    const totalVol = insights.total_volume_lbs || 0;
    const muscleVols = insights.muscle_group_volumes || [];
    const maxMuscleVol = muscleVols.length > 0 ? Math.max(...muscleVols.map((m) => m.volume_lbs)) : 1;

    const muscleBarsHtml = muscleVols.length > 0
      ? muscleVols.map((m) => {
        const pct = Math.max(8, Math.round((m.volume_lbs / maxMuscleVol) * 100));
        return `
            <div class="muscle-bar-item">
              <div class="muscle-bar-header">
                <span class="muscle-bar-name">${this.escapeHtml(m.muscle_group)}</span>
                <span class="muscle-bar-val">${Math.round(m.volume_lbs).toLocaleString()} lbs</span>
              </div>
              <div class="muscle-bar-track">
                <div class="muscle-bar-fill" style="width: ${pct}%"></div>
              </div>
            </div>
          `;
      }).join("")
      : `<p class="category-empty-text">No muscle group volume calculated.</p>`;

    // 3. Progressive Overload & Weight Suggestions
    const progressionHtml = (insights.progression_suggestions && insights.progression_suggestions.length > 0)
      ? insights.progression_suggestions.map((s) => {
        const targetWeightStr = s.suggested_weight !== null && s.suggested_weight !== undefined
          ? `${s.suggested_weight.toFixed(1)} lbs`
          : "Maintain Load";
        const setsRepsStr = s.suggested_reps ? ` &times; ${s.suggested_reps} reps` : "";

        return `
            <div class="progression-item-card">
              <div class="progression-item-top">
                <span class="progression-exercise-title">${this.escapeHtml(s.exercise_name)}</span>
                <span class="progression-target-badge">Target: ${targetWeightStr}${setsRepsStr}</span>
              </div>
              <span class="progression-current-perf">Last Set: ${this.escapeHtml(s.current_performance || "")}</span>
              <p class="progression-rec-text">${this.escapeHtml(s.recommendation)}</p>
            </div>
          `;
      }).join("")
      : `<p class="category-empty-text">No specific progression targets calculated.</p>`;

    // 4. Form Cues & Maintenance Tips
    const formCuesHtml = (insights.form_cues && insights.form_cues.length > 0)
      ? insights.form_cues.map((c) => `
          <div class="form-cue-item-card">
            <span class="form-cue-title">${this.escapeHtml(c.exercise_name)}</span>
            <span class="form-cue-obs">${this.escapeHtml(c.observation)}</span>
            <p class="form-cue-cue">Cue: &ldquo;${this.escapeHtml(c.form_cue)}&rdquo;</p>
            <p class="form-cue-tip">Maintenance Tip: ${this.escapeHtml(c.maintenance_tip)}</p>
          </div>
        `).join("")
      : `<p class="category-empty-text">Strict form maintained across all recorded sets.</p>`;

    // 5. Highlights and Recovery
    const highlightsHtml = (insights.highlights && insights.highlights.length > 0)
      ? `<ul class="highlights-bullet-list">
          ${insights.highlights.map((h) => `<li>${this.escapeHtml(h)}</li>`).join("")}
        </ul>`
      : "";

    container.innerHTML = `
      <!-- Assessment & Notes Card -->
      <div class="insight-card-section">
        <div class="insight-card-title-row">
          <span class="insight-card-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M12 16v-4M12 8h.01"></path>
            </svg>
            Session Assessment &amp; Plan
          </span>
          <span class="strain-pill ${strainClass}">${strainLabel} STRAIN</span>
        </div>
        <p class="insight-assessment-text">${this.escapeHtml(insights.overall_assessment)}</p>
        ${notesFeedbackHtml}
      </div>

      <!-- Volume by Muscle Group Card -->
      <div class="insight-card-section">
        <div class="insight-card-title-row">
          <span class="insight-card-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
            </svg>
            Volume by Muscle Group (${Math.round(totalVol).toLocaleString()} lbs Total)
          </span>
        </div>
        <div class="muscle-volume-bars">
          ${muscleBarsHtml}
        </div>
      </div>

      <!-- Progressive Overload Targets Card -->
      <div class="insight-card-section">
        <div class="insight-card-title-row">
          <span class="insight-card-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
              <polyline points="17 6 23 6 23 12"></polyline>
            </svg>
            Next Workout Progression &amp; Weight Targets
          </span>
        </div>
        <div class="progression-list">
          ${progressionHtml}
        </div>
      </div>

      <!-- Form Cues & Maintenance Tips Card -->
      <div class="insight-card-section">
        <div class="insight-card-title-row">
          <span class="insight-card-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            Biomechanical Form Cues &amp; Tips
          </span>
        </div>
        <div class="form-cues-list">
          ${formCuesHtml}
        </div>
      </div>

      <!-- Highlights & Recovery Card -->
      <div class="insight-card-section">
        <div class="insight-card-title-row">
          <span class="insight-card-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M18 8h1a4 4 0 0 1 0 8h-1"></path>
              <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path>
              <line x1="6" y1="1" x2="6" y2="4"></line>
              <line x1="10" y1="1" x2="10" y2="4"></line>
              <line x1="14" y1="1" x2="14" y2="4"></line>
            </svg>
            Session Standouts &amp; Recovery
          </span>
        </div>
        ${highlightsHtml}
        <p class="recovery-text">${this.escapeHtml(insights.recovery_recommendations)}</p>
      </div>
    `;
  }
}

const app = new WorkoutApp();
document.addEventListener("DOMContentLoaded", () => {
  app.init();
});
