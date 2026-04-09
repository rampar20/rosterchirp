const express = require('express');
const router  = express.Router();
const { query, queryOne, exec } = require('../models/db');
const { authMiddleware } = require('../middleware/auth');

// ── Firebase Admin (FCM — Android/Chrome) ──────────────────────────────────────
let firebaseAdmin = null;
let firebaseApp   = null;

function getMessaging() {
  if (firebaseApp) return firebaseAdmin.messaging(firebaseApp);
  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!json) return null;
  try {
    firebaseAdmin = require('firebase-admin');
    const svc = JSON.parse(json);
    firebaseApp = firebaseAdmin.initializeApp({
      credential: firebaseAdmin.credential.cert(svc),
    });
    console.log('[Push] Firebase Admin initialised');
    return firebaseAdmin.messaging(firebaseApp);
  } catch (e) {
    console.error('[Push] Firebase Admin init failed:', e.message);
    return null;
  }
}

// ── web-push (VAPID — iOS/Firefox/Edge) ────────────────────────────────────────
let webPushReady = false;

function getWebPush() {
  if (webPushReady) return require('web-push');
  const pub  = process.env.VAPID_PUBLIC;
  const priv = process.env.VAPID_PRIVATE;
  if (!pub || !priv) return null;
  try {
    const wp = require('web-push');
    // Subject must be mailto: or https:// — Apple returns 403 for any other format.
    const subject = process.env.VAPID_SUBJECT || 'mailto:push@rosterchirp.app';
    wp.setVapidDetails(subject, pub, priv);
    webPushReady = true;
    console.log('[Push] web-push (VAPID) initialised');
    return wp;
  } catch (e) {
    console.error('[Push] web-push init failed:', e.message);
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

// Called from messages.js (REST) and index.js (socket) for every outbound push.
// Dispatches to FCM (fcm_token rows) or web-push (webpush_endpoint rows) based on
// which columns are populated. Both paths run concurrently for a given user.
async function sendPushToUser(schema, userId, payload) {
  try {
    const subs = await query(schema,
      `SELECT * FROM push_subscriptions
        WHERE user_id = $1
          AND (fcm_token IS NOT NULL OR webpush_endpoint IS NOT NULL)`,
      [userId]
    );
    if (subs.length === 0) {
      console.log(`[Push] No subscription for user ${userId} (schema=${schema})`);
      return;
    }

    const messaging = getMessaging();
    const wp        = getWebPush();

    for (const sub of subs) {
      if (sub.fcm_token) {
        // ── FCM path ──────────────────────────────────────────────────────────
        if (!messaging) continue;
        try {
          await messaging.send({
            token: sub.fcm_token,
            notification: {
              title: payload.title || 'New Message',
              body:  payload.body  || '',
            },
            data: {
              url:     payload.url    || '/',
              groupId: payload.groupId ? String(payload.groupId) : '',
            },
            android: {
              priority: 'high',
              notification: { sound: 'default' },
            },
            apns: {
              headers: { 'apns-priority': '10' },
              payload: { aps: { sound: 'default', badge: 1, contentAvailable: true } },
            },
            webpush: {
              headers: { Urgency: 'high' },
              notification: {
                icon:     '/icons/icon-192.png',
                badge:    '/icons/icon-192-maskable.png',
                tag:      payload.groupId ? `rosterchirp-group-${payload.groupId}` : 'rosterchirp-message',
                renotify: true,
              },
              fcm_options: { link: payload.url || '/' },
            },
          });
          console.log(`[Push] FCM sent to user ${userId} device=${sub.device} schema=${schema}`);
        } catch (err) {
          const stale = [
            'messaging/registration-token-not-registered',
            'messaging/invalid-registration-token',
            'messaging/invalid-argument',
          ];
          if (stale.includes(err.code)) {
            await exec(schema, 'DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
            console.log(`[Push] Removed stale FCM token for user ${userId} device=${sub.device}`);
          }
        }
      } else if (sub.webpush_endpoint) {
        // ── Web Push / VAPID path (iOS, Firefox, Edge) ────────────────────────
        if (!wp) continue;
        const subscription = {
          endpoint: sub.webpush_endpoint,
          keys: { p256dh: sub.webpush_p256dh, auth: sub.webpush_auth },
        };
        const body = JSON.stringify({
          notification: {
            title: payload.title || 'New Message',
            body:  payload.body  || '',
          },
          data: {
            url:     payload.url     || '/',
            groupId: payload.groupId ? String(payload.groupId) : '',
            icon:    '/icons/icon-192.png',
          },
        });
        try {
          await wp.sendNotification(subscription, body, { TTL: 86400, urgency: 'high' });
          console.log(`[Push] WebPush sent to user ${userId} device=${sub.device} schema=${schema}`);
        } catch (err) {
          // 404/410 = subscription expired or user unsubscribed — remove the stale row
          if (err.statusCode === 404 || err.statusCode === 410) {
            await exec(schema, 'DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
            console.log(`[Push] Removed stale WebPush sub for user ${userId} device=${sub.device}`);
          }
        }
      }
    }
  } catch (e) {
    console.error('[Push] sendPushToUser error:', e.message);
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// Public — frontend fetches this to initialise the Firebase JS SDK
router.get('/firebase-config', (req, res) => {
  const apiKey             = process.env.FIREBASE_API_KEY;
  const projectId          = process.env.FIREBASE_PROJECT_ID;
  const messagingSenderId  = process.env.FIREBASE_MESSAGING_SENDER_ID;
  const appId              = process.env.FIREBASE_APP_ID;
  const vapidKey           = process.env.FIREBASE_VAPID_KEY;

  if (!apiKey || !projectId || !messagingSenderId || !appId || !vapidKey) {
    return res.status(503).json({ error: 'FCM not configured' });
  }
  res.json({ apiKey, projectId, messagingSenderId, appId, vapidKey });
});

// Public — iOS frontend fetches this to create a PushManager subscription
router.get('/vapid-public-key', (req, res) => {
  const pub = process.env.VAPID_PUBLIC;
  if (!pub) return res.status(503).json({ error: 'VAPID not configured' });
  res.json({ vapidPublicKey: pub });
});

// Register / refresh an FCM token for the logged-in user (Android/Chrome)
router.post('/subscribe', authMiddleware, async (req, res) => {
  const { fcmToken } = req.body;
  if (!fcmToken) return res.status(400).json({ error: 'fcmToken required' });
  try {
    const device = req.device || 'desktop';
    await exec(req.schema,
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND device = $2',
      [req.user.id, device]
    );
    await exec(req.schema,
      'INSERT INTO push_subscriptions (user_id, device, fcm_token) VALUES ($1, $2, $3)',
      [req.user.id, device, fcmToken]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Register / refresh a Web Push subscription for the logged-in user (iOS/Firefox/Edge)
// Body: { endpoint, keys: { p256dh, auth } }  — the PushSubscription JSON from the browser
router.post('/subscribe-webpush', authMiddleware, async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'endpoint and keys.p256dh/auth required' });
  }
  try {
    const device = req.device || 'mobile'; // iOS is always mobile
    await exec(req.schema,
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND device = $2',
      [req.user.id, device]
    );
    await exec(req.schema,
      `INSERT INTO push_subscriptions (user_id, device, webpush_endpoint, webpush_p256dh, webpush_auth)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, device, endpoint, keys.p256dh, keys.auth]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Remove the push subscription for the logged-in user / device
router.post('/unsubscribe', authMiddleware, async (req, res) => {
  try {
    const device = req.device || 'desktop';
    await exec(req.schema,
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND device = $2',
      [req.user.id, device]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Send a test push to the requesting user's own devices.
// Covers both FCM tokens and Web Push subscriptions in one call.
// mode query param only applies to FCM test messages (notification vs browser).
router.post('/test', authMiddleware, async (req, res) => {
  try {
    const subs = await query(req.schema,
      `SELECT * FROM push_subscriptions
        WHERE user_id = $1
          AND (fcm_token IS NOT NULL OR webpush_endpoint IS NOT NULL)`,
      [req.user.id]
    );
    if (subs.length === 0) {
      return res.status(404).json({
        error: 'No push subscription found. Grant notification permission and reload the app first.',
      });
    }

    const messaging = getMessaging();
    const wp        = getWebPush();
    const mode      = req.query.mode === 'browser' ? 'browser' : 'notification';
    const results   = [];

    for (const sub of subs) {
      if (sub.fcm_token) {
        if (!messaging) {
          results.push({ device: sub.device, type: 'fcm', status: 'failed', error: 'Firebase Admin not initialised — check FIREBASE_SERVICE_ACCOUNT in .env' });
          continue;
        }
        try {
          const message = {
            token: sub.fcm_token,
            android: { priority: 'high', notification: { sound: 'default' } },
            apns: {
              headers: { 'apns-priority': '10' },
              payload: { aps: { sound: 'default', badge: 1, contentAvailable: true } },
            },
            webpush: {
              headers: { Urgency: 'high' },
              notification: { icon: '/icons/icon-192.png', badge: '/icons/icon-192-maskable.png', tag: 'rosterchirp-test' },
            },
          };
          if (mode === 'browser') {
            message.webpush.notification.title = 'RosterChirp Test (browser)';
            message.webpush.notification.body  = 'FCM delivery confirmed — Chrome handled this directly.';
            message.webpush.fcm_options = { link: '/' };
          } else {
            message.notification = { title: 'RosterChirp Test', body: 'Push notifications are working!' };
            message.data = { url: '/', groupId: '' };
            message.webpush.fcm_options = { link: '/' };
          }
          await messaging.send(message);
          results.push({ device: sub.device, type: 'fcm', mode, status: 'sent' });
        } catch (err) {
          results.push({ device: sub.device, type: 'fcm', mode, status: 'failed', error: err.message, code: err.code });
        }
      } else if (sub.webpush_endpoint) {
        if (!wp) {
          results.push({ device: sub.device, type: 'webpush', status: 'failed', error: 'VAPID keys not configured — check VAPID_PUBLIC/VAPID_PRIVATE in .env' });
          continue;
        }
        const subscription = {
          endpoint: sub.webpush_endpoint,
          keys: { p256dh: sub.webpush_p256dh, auth: sub.webpush_auth },
        };
        try {
          await wp.sendNotification(
            subscription,
            JSON.stringify({
              notification: { title: 'RosterChirp Test', body: 'Push notifications are working!' },
              data: { url: '/', icon: '/icons/icon-192.png' },
            }),
            { TTL: 300, urgency: 'high' }
          );
          results.push({ device: sub.device, type: 'webpush', status: 'sent' });
        } catch (err) {
          results.push({ device: sub.device, type: 'webpush', status: 'failed', error: err.message, statusCode: err.statusCode });
        }
      }
    }

    res.json({ results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Debug endpoint (admin-only) — lists all push subscriptions for this schema
router.get('/debug', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const subs = await query(req.schema, `
      SELECT ps.id, ps.user_id, ps.device,
             ps.fcm_token,
             ps.webpush_endpoint,
             u.name, u.email
        FROM push_subscriptions ps
        JOIN users u ON u.id = ps.user_id
       WHERE ps.fcm_token IS NOT NULL OR ps.webpush_endpoint IS NOT NULL
       ORDER BY u.name, ps.device
    `);
    const fcmConfigured      = !!(process.env.FIREBASE_API_KEY && process.env.FIREBASE_SERVICE_ACCOUNT && process.env.FIREBASE_VAPID_KEY);
    const firebaseAdminReady = !!getMessaging();
    const vapidConfigured    = !!(process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE);
    res.json({ subscriptions: subs, fcmConfigured, firebaseAdminReady, vapidConfigured });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router, sendPushToUser };
