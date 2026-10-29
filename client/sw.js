const CACHE_NAME = "workout-tracker-v25";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./db.js",
  "./sync.js",
  "./chime.wav",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon.svg"
];

function fetchWithTimeout(request, timeoutMs = 2500) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { signal: controller.signal }).finally(() => {
    clearTimeout(id);
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Do not intercept backend REST API calls
  if (
    url.pathname.startsWith("/exercises") ||
    url.pathname.startsWith("/sessions") ||
    url.pathname.startsWith("/sync") ||
    url.pathname.startsWith("/coach") ||
    url.pathname.startsWith("/server-info")
  ) {
    return;
  }

  // Only handle GET requests
  if (event.request.method !== "GET") {
    return;
  }

  // Navigation requests: Return cached app shell immediately (instant offline load)
  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cached =
          (await caches.match(event.request)) ||
          (await caches.match("./index.html")) ||
          (await caches.match("./"));

        if (cached) {
          // Revalidate in background if server is online without blocking page load
          fetchWithTimeout(event.request, 2500)
            .then(async (networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                const cache = await caches.open(CACHE_NAME);
                await cache.put(event.request, networkResponse.clone());
                await cache.put("./index.html", networkResponse);
              }
            })
            .catch(() => {});
          return cached;
        }

        // Cache miss: fetch from network
        try {
          const networkResponse = await fetchWithTimeout(event.request, 3500);
          if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, networkResponse.clone());
            cache.put("./index.html", networkResponse.clone());
          }
          return networkResponse;
        } catch (err) {
          const fallback = (await caches.match("./index.html")) || (await caches.match("./"));
          if (fallback) return fallback;
          throw err;
        }
      })()
    );
    return;
  }

  // Static assets: Cache-first with background revalidation
  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) {
        // Background revalidation
        fetchWithTimeout(event.request, 2500)
          .then(async (networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const cache = await caches.open(CACHE_NAME);
              await cache.put(event.request, networkResponse);
            }
          })
          .catch(() => {});
        return cached;
      }

      // Not in cache yet: fetch from network
      try {
        const networkResponse = await fetchWithTimeout(event.request, 3000);
        if (networkResponse && networkResponse.status === 200) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      } catch (err) {
        const fallback = await caches.match(event.request);
        if (fallback) return fallback;
        throw err;
      }
    })()
  );
});

let scheduledTimerId = null;
let scheduledTimerResolve = null;

// Handle background notification triggers from RestTimerManager
self.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.data.type === "SCHEDULE_REST_TIMER") {
    if (scheduledTimerId) {
      clearTimeout(scheduledTimerId);
      scheduledTimerId = null;
    }
    if (scheduledTimerResolve) {
      scheduledTimerResolve();
      scheduledTimerResolve = null;
    }

    const delayMs = Math.max(0, event.data.delayMs || 0);
    const exerciseName = event.data.exerciseName || "Exercise";

    const waitPromise = new Promise((resolve) => {
      scheduledTimerResolve = resolve;
      scheduledTimerId = setTimeout(async () => {
        try {
          await self.registration.showNotification("Rest Complete!", {
            body: `Time for your next set of ${exerciseName}`,
            icon: "./icon-192.png",
            badge: "./icon-192.png",
            vibrate: [500, 200, 500, 200, 500],
            tag: "rest-timer-finished",
            renotify: true,
            requireInteraction: true,
            silent: false
          });
        } catch (err) {
          console.error("[SW] Notification display error:", err);
        } finally {
          scheduledTimerId = null;
          scheduledTimerResolve = null;
          resolve();
        }
      }, delayMs);
    });

    if (event.waitUntil) {
      event.waitUntil(waitPromise);
    }
  } else if (event.data.type === "CANCEL_REST_TIMER") {
    if (scheduledTimerId) {
      clearTimeout(scheduledTimerId);
      scheduledTimerId = null;
    }
    if (scheduledTimerResolve) {
      scheduledTimerResolve();
      scheduledTimerResolve = null;
    }
  } else if (event.data.type === "REST_FINISHED_NOTIFICATION") {
    if (scheduledTimerId) {
      clearTimeout(scheduledTimerId);
      scheduledTimerId = null;
    }
    if (scheduledTimerResolve) {
      scheduledTimerResolve();
      scheduledTimerResolve = null;
    }
    const title = event.data.title || "Rest Complete!";
    const body = event.data.body || "Time for your next set";
    const p = self.registration.showNotification(title, {
      body: body,
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      vibrate: [500, 200, 500, 200, 500],
      tag: "rest-timer-finished",
      renotify: true,
      requireInteraction: true,
      silent: false
    });
    if (event.waitUntil) {
      event.waitUntil(p);
    }
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow("./");
    })
  );
});
