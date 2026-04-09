// ── Unified Push Handler (Optimized for Mobile) ──────────────────────────────
self.addEventListener('push', (event) => {
  console.log('[SW] Push event received. Messaging Ready:', !!messaging);

  // event.waitUntil is the "Keep-Alive" signal for mobile OS
  event.waitUntil(
    (async () => {
      try {
        let payload;

        // 1. Try to parse the data directly from the push event (Fastest/Reliable)
        if (event.data) {
          try {
            payload = event.data.json();
            console.log('[SW] Raw push data parsed:', JSON.stringify(payload));
          } catch (e) {
            console.warn('[SW] Could not parse JSON, using text fallback');
            payload = { notification: { body: event.data.text() } };
          }
        }

        // 2. If the payload is empty, check if Firebase can catch it 
        // (This happens if your server sends "Notification" instead of "Data" messages)
        if (!payload && messaging) {
          // This is a last-resort wait for the SDK
          payload = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(null), 2000);
            messaging.onBackgroundMessage((bgPayload) => {
              clearTimeout(timeout);
              resolve(bgPayload);
            });
          });
        }

        // 3. Construct and show the notification
        if (payload) {
          const n = payload.notification || {};
          const d = payload.data || {};
          
          // Use the specific function you already defined
          await showRosterChirpNotification({
            title:   n.title   || d.title   || 'New Message',
            body:    n.body    || d.body    || '',
            url:     d.url     || d.link    || '/', // some SDKs use 'link'
            groupId: d.groupId || '',
          });
        } else {
          // Fallback if we woke up for a "ghost" push with no data
          await self.registration.showNotification('RosterChirp', {
            body: 'You have a new update.',
            tag: 'rosterchirp-fallback'
          });
        }
      } catch (error) {
        console.error('[SW] Critical Push Error:', error);
      }
    })()
  );
});