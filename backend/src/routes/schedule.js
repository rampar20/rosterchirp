const express   = require('express');
const { query, queryOne, queryResult, exec, withTransaction } = require('../models/db');
const { authMiddleware, teamManagerMiddleware } = require('../middleware/auth');
const multer    = require('multer');
const { parse: csvParse } = require('csv-parse/sync');
const upload    = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const R = (schema, type, id) => `${schema}:${type}:${id}`;

module.exports = function(io) {

const router = express.Router();

// ── Event notification helper ─────────────────────────────────────────────────
// Posts a plain system message to each assigned user group's DM channel
// when an event is created or updated.

async function sendEventMessage(schema, dmGroupId, actorId, content) {
  const r = await queryResult(schema,
    "INSERT INTO messages (group_id,user_id,content,type) VALUES ($1,$2,$3,'system') RETURNING id",
    [dmGroupId, actorId, content]
  );
  const msg = await queryOne(schema, `
    SELECT m.*, u.name AS user_name, u.display_name AS user_display_name,
      u.avatar AS user_avatar, u.role AS user_role, u.status AS user_status,
      u.hide_admin_tag AS user_hide_admin_tag, u.about_me AS user_about_me, u.allow_dm AS user_allow_dm
    FROM messages m JOIN users u ON m.user_id = u.id WHERE m.id = $1
  `, [r.rows[0].id]);
  if (msg) { msg.reactions = []; io.to(R(schema, 'group', dmGroupId)).emit('message:new', msg); }
}

async function postEventNotification(schema, eventId, actorId) {
  try {
    const event = await queryOne(schema, 'SELECT * FROM events WHERE id=$1', [eventId]);
    if (!event) return;
    const dateStr = new Date(event.start_at).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
    const groups = await query(schema, `
      SELECT ug.dm_group_id FROM event_user_groups eug
      JOIN user_groups ug ON ug.id = eug.user_group_id
      WHERE eug.event_id = $1 AND ug.dm_group_id IS NOT NULL
    `, [eventId]);
    for (const { dm_group_id } of groups)
      await sendEventMessage(schema, dm_group_id, actorId, `📅 Event added: "${event.title}" on ${dateStr}`);
  } catch (e) {
    console.error('[Schedule] postEventNotification error:', e.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getPartnerId(schema, userId) {
  const row = await queryOne(schema,
    'SELECT CASE WHEN user_id_1=$1 THEN user_id_2 ELSE user_id_1 END AS partner_id FROM guardian_partners WHERE user_id_1=$1 OR user_id_2=$1',
    [userId]
  );
  return row?.partner_id || null;
}

async function isToolManagerFn(schema, user) {
  if (user.role === 'admin' || user.role === 'manager') return true;
  const tm = await queryOne(schema, "SELECT value FROM settings WHERE key='team_tool_managers'");
  const gm = await queryOne(schema, "SELECT value FROM settings WHERE key='team_group_managers'");
  const groupIds = [...new Set([...JSON.parse(tm?.value||'[]'), ...JSON.parse(gm?.value||'[]')])];
  if (!groupIds.length) return false;
  const ph = groupIds.map((_,i) => `$${i+2}`).join(',');
  return !!(await queryOne(schema, `SELECT 1 FROM user_group_members WHERE user_id=$1 AND user_group_id IN (${ph})`, [user.id, ...groupIds]));
}

async function canViewEvent(schema, event, userId, isToolManager) {
  if (isToolManager || event.is_public) return true;
  const assigned = await queryOne(schema, `
    SELECT 1 FROM event_user_groups eug
    JOIN user_group_members ugm ON ugm.user_group_id=eug.user_group_id
    WHERE eug.event_id=$1 AND ugm.user_id=$2
  `, [event.id, userId]);
  if (assigned) return true;
  // Also allow if user has an alias in one of the event's user groups (Guardian Only mode)
  const aliasAssigned = await queryOne(schema, `
    SELECT 1 FROM event_user_groups eug
    JOIN alias_group_members agm ON agm.user_group_id=eug.user_group_id
    JOIN guardian_aliases ga ON ga.id=agm.alias_id
    WHERE eug.event_id=$1 AND ga.guardian_id=$2
  `, [event.id, userId]);
  if (aliasAssigned) return true;
  // Allow if partner is assigned to the event (directly or via alias)
  const partnerId = await getPartnerId(schema, userId);
  if (partnerId) {
    const partnerAssigned = await queryOne(schema, `
      SELECT 1 FROM event_user_groups eug
      JOIN user_group_members ugm ON ugm.user_group_id=eug.user_group_id
      WHERE eug.event_id=$1 AND ugm.user_id=$2
    `, [event.id, partnerId]);
    if (partnerAssigned) return true;
    const partnerAliasAssigned = await queryOne(schema, `
      SELECT 1 FROM event_user_groups eug
      JOIN alias_group_members agm ON agm.user_group_id=eug.user_group_id
      JOIN guardian_aliases ga ON ga.id=agm.alias_id
      WHERE eug.event_id=$1 AND ga.guardian_id=$2
    `, [event.id, partnerId]);
    if (partnerAliasAssigned) return true;
  }
  return false;
}

async function enrichEvent(schema, event) {
  event.event_type = event.event_type_id
    ? await queryOne(schema, 'SELECT * FROM event_types WHERE id=$1', [event.event_type_id])
    : null;
  // recurrence_rule is JSONB in Postgres — already parsed, no need to JSON.parse
  event.user_groups = await query(schema, `
    SELECT ug.id, ug.name FROM event_user_groups eug
    JOIN user_groups ug ON ug.id=eug.user_group_id WHERE eug.event_id=$1
  `, [event.id]);
  return event;
}

async function applyEventUpdate(schema, eventId, fields, userGroupIds) {
  const { title, eventTypeId, startAt, endAt, allDay, location, description, isPublic, trackAvailability, recurrenceRule, origEvent } = fields;
  await exec(schema, `
    UPDATE events SET
      title               = COALESCE($1, title),
      event_type_id       = $2,
      start_at            = COALESCE($3, start_at),
      end_at              = COALESCE($4, end_at),
      all_day             = COALESCE($5, all_day),
      location            = $6,
      description         = $7,
      is_public           = COALESCE($8, is_public),
      track_availability  = COALESCE($9, track_availability),
      recurrence_rule     = $10,
      updated_at          = NOW()
    WHERE id = $11
  `, [
    title?.trim() || null,
    eventTypeId !== undefined ? (eventTypeId || null) : origEvent.event_type_id,
    startAt || null,
    endAt   || null,
    allDay !== undefined ? allDay : null,
    location    !== undefined ? (location    || null) : origEvent.location,
    description !== undefined ? (description || null) : origEvent.description,
    isPublic           !== undefined ? isPublic           : null,
    trackAvailability  !== undefined ? trackAvailability  : null,
    recurrenceRule !== undefined ? recurrenceRule : origEvent.recurrence_rule,
    eventId,
  ]);
  if (Array.isArray(userGroupIds)) {
    await exec(schema, 'DELETE FROM event_user_groups WHERE event_id=$1', [eventId]);
    for (const ugId of userGroupIds)
      await exec(schema, 'INSERT INTO event_user_groups (event_id,user_group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [eventId, ugId]);
  }
}

// ── Event Types ───────────────────────────────────────────────────────────────

router.get('/event-types', authMiddleware, async (req, res) => {
  try {
    const eventTypes = await query(req.schema, 'SELECT * FROM event_types ORDER BY is_default DESC, name ASC');
    res.json({ eventTypes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/event-types', authMiddleware, teamManagerMiddleware, async (req, res) => {
  const { name, colour, defaultUserGroupId, defaultDurationHrs } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    if (await queryOne(req.schema, 'SELECT id FROM event_types WHERE LOWER(name)=LOWER($1)', [name.trim()]))
      return res.status(400).json({ error: 'Event type with that name already exists' });
    const r = await queryResult(req.schema,
      'INSERT INTO event_types (name,colour,default_user_group_id,default_duration_hrs) VALUES ($1,$2,$3,$4) RETURNING id',
      [name.trim(), colour||'#6366f1', defaultUserGroupId||null, defaultDurationHrs||1.0]
    );
    res.json({ eventType: await queryOne(req.schema, 'SELECT * FROM event_types WHERE id=$1', [r.rows[0].id]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/event-types/:id', authMiddleware, teamManagerMiddleware, async (req, res) => {
  try {
    const et = await queryOne(req.schema, 'SELECT * FROM event_types WHERE id=$1', [req.params.id]);
    if (!et) return res.status(404).json({ error: 'Not found' });
    if (et.is_protected) return res.status(403).json({ error: 'Cannot edit a protected event type' });
    const { name, colour, defaultUserGroupId, defaultDurationHrs } = req.body;
    if (name && name.trim() !== et.name) {
      if (await queryOne(req.schema, 'SELECT id FROM event_types WHERE LOWER(name)=LOWER($1) AND id!=$2', [name.trim(), et.id]))
        return res.status(400).json({ error: 'Name already in use' });
    }
    await exec(req.schema, `
      UPDATE event_types SET
        name                 = COALESCE($1, name),
        colour               = COALESCE($2, colour),
        default_user_group_id = $3,
        default_duration_hrs = COALESCE($4, default_duration_hrs)
      WHERE id=$5
    `, [name?.trim()||null, colour||null, defaultUserGroupId??et.default_user_group_id, defaultDurationHrs||null, et.id]);
    res.json({ eventType: await queryOne(req.schema, 'SELECT * FROM event_types WHERE id=$1', [et.id]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/event-types/:id', authMiddleware, teamManagerMiddleware, async (req, res) => {
  try {
    const et = await queryOne(req.schema, 'SELECT * FROM event_types WHERE id=$1', [req.params.id]);
    if (!et) return res.status(404).json({ error: 'Not found' });
    if (et.is_default || et.is_protected) return res.status(403).json({ error: 'Cannot delete a protected event type' });
    await exec(req.schema, 'UPDATE events SET event_type_id=NULL WHERE event_type_id=$1', [et.id]);
    await exec(req.schema, 'DELETE FROM event_types WHERE id=$1', [et.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── User's own groups (for regular users creating events) ─────────────────────

router.get('/my-groups', authMiddleware, async (req, res) => {
  try {
    const groups = await query(req.schema, `
      SELECT ug.id, ug.name FROM user_groups ug
      JOIN user_group_members ugm ON ugm.user_group_id = ug.id
      WHERE ugm.user_id = $1
      ORDER BY ug.name ASC
    `, [req.user.id]);
    res.json({ groups });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Events ────────────────────────────────────────────────────────────────────

router.get('/', authMiddleware, async (req, res) => {
  try {
    const itm = await isToolManagerFn(req.schema, req.user);
    const { from, to } = req.query;
    let sql = 'SELECT * FROM events WHERE 1=1';
    const params = [];
    let pi = 1;
    if (from) { sql += ` AND end_at >= $${pi++}`;   params.push(from); }
    if (to)   { sql += ` AND start_at <= $${pi++}`; params.push(to); }
    sql += ' ORDER BY start_at ASC';
    const rawEvents = await query(req.schema, sql, params);
    const events = [];
    for (const e of rawEvents) {
      if (!(await canViewEvent(req.schema, e, req.user.id, itm))) continue;
      await enrichEvent(req.schema, e);
      const mine = await queryOne(req.schema, 'SELECT response FROM event_availability WHERE event_id=$1 AND user_id=$2', [e.id, req.user.id]);
      e.my_response = mine?.response || null;
      events.push(e);
    }
    res.json({ events });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/me/pending', authMiddleware, async (req, res) => {
  try {
    const pending = await query(req.schema, `
      SELECT DISTINCT e.* FROM events e
      JOIN event_user_groups eug ON eug.event_id=e.id
      JOIN user_group_members ugm ON ugm.user_group_id=eug.user_group_id
      WHERE ugm.user_id=$1 AND e.track_availability=TRUE
        AND e.end_at >= NOW()
        AND NOT EXISTS (SELECT 1 FROM event_availability ea WHERE ea.event_id=e.id AND ea.user_id=$1)
      ORDER BY e.start_at ASC
    `, [req.user.id]);
    const result = [];
    for (const e of pending) result.push(await enrichEvent(req.schema, e));
    res.json({ events: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const event = await queryOne(req.schema, 'SELECT * FROM events WHERE id=$1', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Not found' });
    const itm = await isToolManagerFn(req.schema, req.user);
    if (!(await canViewEvent(req.schema, event, req.user.id, itm))) return res.status(403).json({ error: 'Access denied' });
    await enrichEvent(req.schema, event);
    const partnerId = await getPartnerId(req.schema, req.user.id);
    const isMember = !itm && !!(
      (await queryOne(req.schema, `
        SELECT 1 FROM event_user_groups eug
        JOIN user_group_members ugm ON ugm.user_group_id=eug.user_group_id
        WHERE eug.event_id=$1 AND ugm.user_id=$2
      `, [event.id, req.user.id]))
      ||
      // Guardian Only: user has an alias in one of the event's user groups
      (await queryOne(req.schema, `
        SELECT 1 FROM event_user_groups eug
        JOIN alias_group_members agm ON agm.user_group_id=eug.user_group_id
        JOIN guardian_aliases ga ON ga.id=agm.alias_id
        WHERE eug.event_id=$1 AND ga.guardian_id=$2
      `, [event.id, req.user.id]))
      ||
      // Partner is assigned to this event (user group or alias)
      (partnerId && !!(
        (await queryOne(req.schema, `
          SELECT 1 FROM event_user_groups eug
          JOIN user_group_members ugm ON ugm.user_group_id=eug.user_group_id
          WHERE eug.event_id=$1 AND ugm.user_id=$2
        `, [event.id, partnerId]))
        ||
        (await queryOne(req.schema, `
          SELECT 1 FROM event_user_groups eug
          JOIN alias_group_members agm ON agm.user_group_id=eug.user_group_id
          JOIN guardian_aliases ga ON ga.id=agm.alias_id
          WHERE eug.event_id=$1 AND ga.guardian_id=$2
        `, [event.id, partnerId]))
      ))
    );
    if (event.track_availability && (itm || isMember)) {
      // User responses
      const userAvail = await query(req.schema, `
        SELECT ea.response, ea.note, ea.updated_at, u.id AS user_id, u.name, u.first_name, u.last_name, u.display_name, u.avatar, FALSE AS is_alias
        FROM event_availability ea JOIN users u ON u.id=ea.user_id WHERE ea.event_id=$1
      `, [req.params.id]);
      // Alias responses (Guardian Only mode)
      const aliasAvail = await query(req.schema, `
        SELECT eaa.response, eaa.note, eaa.updated_at, ga.id AS alias_id, ga.first_name, ga.last_name, ga.avatar, ga.guardian_id, TRUE AS is_alias
        FROM event_alias_availability eaa JOIN guardian_aliases ga ON ga.id=eaa.alias_id WHERE eaa.event_id=$1
      `, [req.params.id]);
      event.availability = [...userAvail, ...aliasAvail];

      // For non-tool-managers: mask notes on entries that don't belong to them or their aliases
      if (!itm) {
        const myAliasIds = new Set(
          (await query(req.schema,
            `SELECT id FROM guardian_aliases WHERE guardian_id=$1
               OR guardian_id IN (
                 SELECT CASE WHEN user_id_1=$1 THEN user_id_2 ELSE user_id_1 END
                 FROM guardian_partners WHERE user_id_1=$1 OR user_id_2=$1
               )`,
            [req.user.id])).map(r => r.id)
        );
        event.availability = event.availability.map(r => {
          const isOwn = !r.is_alias && r.user_id === req.user.id;
          const isOwnAlias = r.is_alias && myAliasIds.has(r.alias_id);
          return (isOwn || isOwnAlias) ? r : { ...r, note: null };
        });
      }

      if (itm) {
        const assignedRows = await query(req.schema, `
          SELECT DISTINCT u.id AS user_id, u.name, u.first_name, u.last_name, u.display_name
          FROM event_user_groups eug
          JOIN user_group_members ugm ON ugm.user_group_id=eug.user_group_id
          JOIN users u ON u.id=ugm.user_id
          WHERE eug.event_id=$1
        `, [req.params.id]);
        // Also include alias members
        const assignedAliases = await query(req.schema, `
          SELECT DISTINCT ga.id AS alias_id, ga.first_name, ga.last_name
          FROM event_user_groups eug
          JOIN alias_group_members agm ON agm.user_group_id=eug.user_group_id
          JOIN guardian_aliases ga ON ga.id=agm.alias_id
          WHERE eug.event_id=$1
        `, [req.params.id]);
        const respondedUserIds = new Set(userAvail.map(r => r.user_id));
        const respondedAliasIds = new Set(aliasAvail.map(r => r.alias_id));
        const noResponseRows = [
          ...assignedRows.filter(r => !respondedUserIds.has(r.user_id)),
          ...assignedAliases.filter(r => !respondedAliasIds.has(r.alias_id)).map(r => ({ ...r, is_alias: true })),
        ];
        event.no_response_count = noResponseRows.length;
        event.no_response_users = noResponseRows;
      }

      // Detect if event targets the players group (for responder select dropdown)
      const playersRow = await queryOne(req.schema, "SELECT value FROM settings WHERE key='feature_players_group_id'");
      const playersGroupId = parseInt(playersRow?.value);
      event.has_players_group = !!(playersGroupId && event.user_groups?.some(g => g.id === playersGroupId));

      // Detect if event targets the guardians group (so guardian shows own name in select)
      const guardiansRow = await queryOne(req.schema, "SELECT value FROM settings WHERE key='feature_guardians_group_id'");
      const guardiansGroupId = parseInt(guardiansRow?.value);
      event.in_guardians_group = !!(guardiansGroupId && event.user_groups?.some(g => g.id === guardiansGroupId) &&
        (
          (await queryOne(req.schema, 'SELECT 1 FROM user_group_members WHERE user_group_id=$1 AND user_id=$2', [guardiansGroupId, req.user.id]))
          ||
          (partnerId && await queryOne(req.schema, 'SELECT 1 FROM user_group_members WHERE user_group_id=$1 AND user_id=$2', [guardiansGroupId, partnerId]))
        ));

      // Return current user's aliases (and partner's) for the responder dropdown (Guardian Only)
      if (event.has_players_group) {
        event.my_aliases = await query(req.schema,
          `SELECT id,first_name,last_name,avatar FROM guardian_aliases
           WHERE guardian_id=$1
              OR guardian_id IN (
                SELECT CASE WHEN user_id_1=$1 THEN user_id_2 ELSE user_id_1 END
                FROM guardian_partners WHERE user_id_1=$1 OR user_id_2=$1
              )
           ORDER BY first_name,last_name`,
          [req.user.id]
        );
      }

      // Return partner user info if they are in one of this event's user groups
      if (partnerId) {
        const partnerInGroup = await queryOne(req.schema, `
          SELECT 1 FROM event_user_groups eug
          JOIN user_group_members ugm ON ugm.user_group_id=eug.user_group_id
          WHERE eug.event_id=$1 AND ugm.user_id=$2
        `, [event.id, partnerId]);
        if (partnerInGroup) {
          const pUser = await queryOne(req.schema, 'SELECT id,name,display_name,avatar FROM users WHERE id=$1', [partnerId]);
          const pGp   = await queryOne(req.schema,
            'SELECT respond_separately FROM guardian_partners WHERE (user_id_1=$1 AND user_id_2=$2) OR (user_id_1=$2 AND user_id_2=$1)',
            [Math.min(req.user.id, partnerId), Math.max(req.user.id, partnerId)]
          );
          event.my_partner = pUser ? { ...pUser, respond_separately: pGp?.respond_separately || false } : null;
        }
      }
    }
    const mine = await queryOne(req.schema, 'SELECT response, note FROM event_availability WHERE event_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    event.my_response = mine?.response || null;
    event.my_note = mine?.note || null;
    res.json({ event });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', authMiddleware, async (req, res) => {
  const { title, eventTypeId, startAt, endAt, allDay, location, description, isPublic, trackAvailability, userGroupIds=[], recurrenceRule } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  if (!startAt || !endAt) return res.status(400).json({ error: 'Start and end time required' });
  try {
    const itm = await isToolManagerFn(req.schema, req.user);
    const groupIds = Array.isArray(userGroupIds) ? userGroupIds : [];
    if (!itm) {
      // Regular users: must select at least one group they belong to; event always private
      if (!groupIds.length) return res.status(400).json({ error: 'Select at least one group' });
      for (const ugId of groupIds) {
        const member = await queryOne(req.schema, 'SELECT 1 FROM user_group_members WHERE user_id=$1 AND user_group_id=$2', [req.user.id, ugId]);
        if (!member) return res.status(403).json({ error: 'You can only assign groups you belong to' });
      }
    }
    const effectiveIsPublic = itm ? (isPublic !== false) : false;
    const r = await queryResult(req.schema, `
      INSERT INTO events (title,event_type_id,start_at,end_at,all_day,location,description,is_public,track_availability,recurrence_rule,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id
    `, [title.trim(), eventTypeId||null, startAt, endAt, !!allDay, location||null, description||null,
        effectiveIsPublic, !!trackAvailability, recurrenceRule||null, req.user.id]);
    const eventId = r.rows[0].id;
    for (const ugId of groupIds)
      await exec(req.schema, 'INSERT INTO event_user_groups (event_id,user_group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [eventId, ugId]);
    if (groupIds.length > 0)
      await postEventNotification(req.schema, eventId, req.user.id);
    const event = await queryOne(req.schema, 'SELECT * FROM events WHERE id=$1', [eventId]);
    res.json({ event: await enrichEvent(req.schema, event) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const event = await queryOne(req.schema, 'SELECT * FROM events WHERE id=$1', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Not found' });
    const itm = await isToolManagerFn(req.schema, req.user);
    if (!itm && event.created_by !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    let { title, eventTypeId, startAt, endAt, allDay, location, description, isPublic, trackAvailability, userGroupIds, recurrenceRule, recurringScope, occurrenceStart } = req.body;
    if (!itm) {
      // Regular users editing their own event: force private, validate group membership
      isPublic = false;
      if (Array.isArray(userGroupIds)) {
        if (!userGroupIds.length) return res.status(400).json({ error: 'Select at least one group' });
        for (const ugId of userGroupIds) {
          const member = await queryOne(req.schema, 'SELECT 1 FROM user_group_members WHERE user_id=$1 AND user_group_id=$2', [req.user.id, ugId]);
          if (!member) return res.status(403).json({ error: 'You can only assign groups you belong to' });
        }
        // Preserve any existing groups on this event that the user doesn't belong to
        // (e.g. groups added by an admin) — silently merge them back into the submitted list
        const existingGroupIds = (await query(req.schema, 'SELECT user_group_id FROM event_user_groups WHERE event_id=$1', [req.params.id])).map(r => r.user_group_id);
        const submittedSet = new Set(userGroupIds.map(Number));
        for (const gid of existingGroupIds) {
          if (submittedSet.has(gid)) continue;
          const member = await queryOne(req.schema, 'SELECT 1 FROM user_group_members WHERE user_id=$1 AND user_group_id=$2', [req.user.id, gid]);
          if (!member) userGroupIds.push(gid);
        }
      }
    }

    const pad = n => String(n).padStart(2, '0');
    const fields = { title, eventTypeId, startAt, endAt, allDay, location, description, isPublic, trackAvailability, recurrenceRule, origEvent: event };

    // Resolve group list for new-event paths (exception instance / future split)
    // Pre-fetched before any transaction so it uses the regular pool connection
    const resolvedGroupIds = Array.isArray(userGroupIds)
      ? userGroupIds
      : (await query(req.schema, 'SELECT user_group_id FROM event_user_groups WHERE event_id=$1', [req.params.id])).map(r => r.user_group_id);

    // ── Capture prev group/DM mapping before any mutations ────────────────────
    const prevGroupRows = await query(req.schema, `
      SELECT eug.user_group_id, ug.dm_group_id FROM event_user_groups eug
      JOIN user_groups ug ON ug.id=eug.user_group_id
      WHERE eug.event_id=$1 AND ug.dm_group_id IS NOT NULL
    `, [req.params.id]);
    const prevGroupIdSet = new Set(prevGroupRows.map(r => r.user_group_id));

    let targetId = Number(req.params.id); // ID of the event to return in the response

    if (event.recurrence_rule && recurringScope === 'this') {
      // ── EXCEPTION INSTANCE ────────────────────────────────────────────────
      // 1. Add occurrence date to master's exceptions (hides the virtual occurrence)
      // 2. INSERT a new standalone event row for this modified occurrence
      const occDate = new Date(occurrenceStart || event.start_at);
      const occDateStr = `${occDate.getFullYear()}-${pad(occDate.getMonth()+1)}-${pad(occDate.getDate())}`;
      await withTransaction(req.schema, async (client) => {
        const rule = { ...event.recurrence_rule };
        const existing = Array.isArray(rule.exceptions) ? rule.exceptions : [];
        rule.exceptions = [...existing.filter(d => d !== occDateStr), occDateStr];
        await client.query('UPDATE events SET recurrence_rule=$1 WHERE id=$2', [JSON.stringify(rule), event.id]);

        const r2 = await client.query(`
          INSERT INTO events (title,event_type_id,start_at,end_at,all_day,location,description,is_public,track_availability,created_by,recurring_master_id,original_start_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id
        `, [
          title?.trim() || event.title,
          eventTypeId !== undefined ? (eventTypeId || null) : event.event_type_id,
          startAt || occurrenceStart || event.start_at,
          endAt   || event.end_at,
          allDay  !== undefined ? allDay : event.all_day,
          location    !== undefined ? (location    || null) : event.location,
          description !== undefined ? (description || null) : event.description,
          isPublic    !== undefined ? isPublic    : event.is_public,
          trackAvailability !== undefined ? trackAvailability : event.track_availability,
          event.created_by,
          event.id,
          occurrenceStart || event.start_at,
        ]);
        targetId = r2.rows[0].id;
        for (const ugId of resolvedGroupIds)
          await client.query('INSERT INTO event_user_groups (event_id,user_group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [targetId, ugId]);
      });

      // Notify: "Event updated" for the occurrence date
      try {
        const exceptionGroupRows = await query(req.schema, `
          SELECT ug.dm_group_id FROM event_user_groups eug
          JOIN user_groups ug ON ug.id=eug.user_group_id
          WHERE eug.event_id=$1 AND ug.dm_group_id IS NOT NULL
        `, [targetId]);
        const dateStr = new Date(startAt || occurrenceStart || event.start_at).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
        const timeChanged = startAt && new Date(startAt).getTime() !== occDate.getTime();
        const locationChanged = location !== undefined && (location || null) !== (event.location || null);
        if (timeChanged) {
          for (const { dm_group_id } of exceptionGroupRows)
            await sendEventMessage(req.schema, dm_group_id, req.user.id, `📅 Event updated: "${title?.trim() || event.title}" on ${dateStr}`);
        }
        if (locationChanged) {
          const locMsg = location ? `📍 Location updated to "${location}": "${title?.trim() || event.title}" on ${dateStr}` : `📍 Location removed: "${title?.trim() || event.title}" on ${dateStr}`;
          for (const { dm_group_id } of exceptionGroupRows)
            await sendEventMessage(req.schema, dm_group_id, req.user.id, locMsg);
        }
      } catch (e) { console.error('[Schedule] exception notification error:', e.message); }

    } else if (event.recurrence_rule && recurringScope === 'future') {
      // ── SERIES SPLIT ──────────────────────────────────────────────────────
      // Truncate old master to end before this occurrence; INSERT new master starting here
      const occDate = new Date(occurrenceStart || event.start_at);
      if (occDate <= new Date(event.start_at)) {
        // Splitting at/before the first occurrence = effectively "edit all"
        await applyEventUpdate(req.schema, event.id, fields, userGroupIds);
        targetId = event.id;
      } else {
        await withTransaction(req.schema, async (client) => {
          // 1. Truncate old master
          const endBefore = new Date(occDate);
          endBefore.setDate(endBefore.getDate() - 1);
          const rule = { ...event.recurrence_rule };
          rule.ends    = 'on';
          rule.endDate = `${endBefore.getFullYear()}-${pad(endBefore.getMonth()+1)}-${pad(endBefore.getDate())}`;
          delete rule.endCount;
          await client.query('UPDATE events SET recurrence_rule=$1 WHERE id=$2', [JSON.stringify(rule), event.id]);

          // 2. INSERT new master with submitted fields
          const newRecRule = recurrenceRule !== undefined ? recurrenceRule : event.recurrence_rule;
          const r2 = await client.query(`
            INSERT INTO events (title,event_type_id,start_at,end_at,all_day,location,description,is_public,track_availability,recurrence_rule,created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id
          `, [
            title?.trim() || event.title,
            eventTypeId !== undefined ? (eventTypeId || null) : event.event_type_id,
            startAt || (occurrenceStart || event.start_at),
            endAt   || event.end_at,
            allDay  !== undefined ? allDay : event.all_day,
            location    !== undefined ? (location    || null) : event.location,
            description !== undefined ? (description || null) : event.description,
            isPublic    !== undefined ? isPublic    : event.is_public,
            trackAvailability !== undefined ? trackAvailability : event.track_availability,
            newRecRule ? JSON.stringify(newRecRule) : null,
            event.created_by,
          ]);
          targetId = r2.rows[0].id;
          for (const ugId of resolvedGroupIds)
            await client.query('INSERT INTO event_user_groups (event_id,user_group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [targetId, ugId]);
        });
        await postEventNotification(req.schema, targetId, req.user.id);
      }

    } else {
      // ── EDIT ALL (or non-recurring direct edit) ───────────────────────────
      await applyEventUpdate(req.schema, event.id, fields, userGroupIds);
      targetId = event.id;

      // Clean up availability for users removed from groups
      if (Array.isArray(userGroupIds)) {
        const prevGroupIds = (await query(req.schema, 'SELECT user_group_id FROM event_user_groups WHERE event_id=$1', [event.id])).map(r => r.user_group_id);
        const newGroupSet  = new Set(userGroupIds.map(Number));
        const removedGroupIds = prevGroupIds.filter(id => !newGroupSet.has(id));
        for (const removedGid of removedGroupIds) {
          const removedUids = (await query(req.schema, 'SELECT user_id FROM user_group_members WHERE user_group_id=$1', [removedGid])).map(r => r.user_id);
          for (const uid of removedUids) {
            if (newGroupSet.size > 0) {
              const ph = [...newGroupSet].map((_,i) => `$${i+2}`).join(',');
              const stillAssigned = await queryOne(req.schema, `SELECT 1 FROM user_group_members WHERE user_id=$1 AND user_group_id IN (${ph})`, [uid, ...[...newGroupSet]]);
              if (stillAssigned) continue;
            }
            await exec(req.schema, 'DELETE FROM event_availability WHERE event_id=$1 AND user_id=$2', [event.id, uid]);
          }
        }
      }

      // Targeted notifications — only for meaningful changes, only to relevant groups
      try {
        const updated = await queryOne(req.schema, 'SELECT * FROM events WHERE id=$1', [event.id]);
        const finalGroupRows = await query(req.schema, `
          SELECT eug.user_group_id, ug.dm_group_id FROM event_user_groups eug
          JOIN user_groups ug ON ug.id=eug.user_group_id
          WHERE eug.event_id=$1 AND ug.dm_group_id IS NOT NULL
        `, [event.id]);
        const allDmIds = finalGroupRows.map(r => r.dm_group_id);
        const dateStr = new Date(updated.start_at).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });

        // Newly added groups → "Event added" only to those groups
        if (Array.isArray(userGroupIds)) {
          for (const { user_group_id, dm_group_id } of finalGroupRows) {
            if (!prevGroupIdSet.has(user_group_id))
              await sendEventMessage(req.schema, dm_group_id, req.user.id, `📅 Event added: "${updated.title}" on ${dateStr}`);
          }
        }
        // Date/time changed → "Event updated" to all groups
        const timeChanged = (startAt && new Date(startAt).getTime() !== new Date(event.start_at).getTime())
                         || (endAt   && new Date(endAt).getTime()   !== new Date(event.end_at).getTime())
                         || (allDay  !== undefined && !!allDay !== !!event.all_day);
        if (timeChanged) {
          for (const dmId of allDmIds)
            await sendEventMessage(req.schema, dmId, req.user.id, `📅 Event updated: "${updated.title}" on ${dateStr}`);
        }
        // Location changed → "Location updated" to all groups
        const locationChanged = location !== undefined && (location || null) !== (event.location || null);
        if (locationChanged) {
          const locContent = updated.location
            ? `📍 Location updated to "${updated.location}": "${updated.title}" on ${dateStr}`
            : `📍 Location removed: "${updated.title}" on ${dateStr}`;
          for (const dmId of allDmIds)
            await sendEventMessage(req.schema, dmId, req.user.id, locContent);
        }
      } catch (e) {
        console.error('[Schedule] event update notification error:', e.message);
      }
    }

    const updated = await queryOne(req.schema, 'SELECT * FROM events WHERE id=$1', [targetId]);
    res.json({ event: await enrichEvent(req.schema, updated) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const event = await queryOne(req.schema, 'SELECT * FROM events WHERE id=$1', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Not found' });
    const itm = await isToolManagerFn(req.schema, req.user);
    if (!itm && event.created_by !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    const { recurringScope, occurrenceStart } = req.body || {};
    const pad = n => String(n).padStart(2, '0');

    if (event.recurrence_rule && recurringScope === 'all') {
      // Delete the single base row — all virtual occurrences disappear with it
      await exec(req.schema, 'DELETE FROM events WHERE id=$1', [req.params.id]);

    } else if (event.recurrence_rule && recurringScope === 'future') {
      // Truncate the series so it ends before this occurrence
      const occDate = new Date(occurrenceStart || event.start_at);
      if (occDate <= new Date(event.start_at)) {
        // Occurrence is at or before the base start — delete the whole series
        await exec(req.schema, 'DELETE FROM events WHERE id=$1', [req.params.id]);
      } else {
        const endBefore = new Date(occDate);
        endBefore.setDate(endBefore.getDate() - 1);
        const rule = { ...event.recurrence_rule };
        rule.ends    = 'on';
        rule.endDate = `${endBefore.getFullYear()}-${pad(endBefore.getMonth()+1)}-${pad(endBefore.getDate())}`;
        delete rule.endCount;
        await exec(req.schema, 'UPDATE events SET recurrence_rule=$1 WHERE id=$2', [JSON.stringify(rule), req.params.id]);
      }

    } else if (event.recurrence_rule && recurringScope === 'this') {
      // Add occurrence date to exceptions — base row and other occurrences are untouched
      const occDate = new Date(occurrenceStart || event.start_at);
      const occDateStr = `${occDate.getFullYear()}-${pad(occDate.getMonth()+1)}-${pad(occDate.getDate())}`;
      const rule = { ...event.recurrence_rule };
      const existing = Array.isArray(rule.exceptions) ? rule.exceptions : [];
      rule.exceptions = [...existing.filter(d => d !== occDateStr), occDateStr];
      await exec(req.schema, 'UPDATE events SET recurrence_rule=$1 WHERE id=$2', [JSON.stringify(rule), req.params.id]);

    } else {
      // Non-recurring single delete
      await exec(req.schema, 'DELETE FROM events WHERE id=$1', [req.params.id]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Availability ──────────────────────────────────────────────────────────────

router.put('/:id/availability', authMiddleware, async (req, res) => {
  try {
    const event = await queryOne(req.schema, 'SELECT * FROM events WHERE id=$1', [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Not found' });
    if (!event.track_availability) return res.status(400).json({ error: 'Availability tracking not enabled' });
    const { response, note, aliasId, forPartnerId } = req.body;
    if (!['going','maybe','not_going'].includes(response)) return res.status(400).json({ error: 'Invalid response' });
    const trimmedNote = note ? String(note).trim().slice(0, 20) : null;

    if (forPartnerId) {
      // Respond on behalf of partner — verify partnership and partner's group membership
      const isPartner = await queryOne(req.schema,
        'SELECT 1 FROM guardian_partners WHERE (user_id_1=$1 AND user_id_2=$2) OR (user_id_1=$2 AND user_id_2=$1)',
        [req.user.id, forPartnerId]);
      if (!isPartner) return res.status(403).json({ error: 'Not your partner' });
      const partnerInGroup = await queryOne(req.schema, `
        SELECT 1 FROM event_user_groups eug JOIN user_group_members ugm ON ugm.user_group_id=eug.user_group_id
        WHERE eug.event_id=$1 AND ugm.user_id=$2
      `, [event.id, forPartnerId]);
      if (!partnerInGroup) return res.status(403).json({ error: 'Partner is not assigned to this event' });
      await exec(req.schema, `
        INSERT INTO event_availability (event_id,user_id,response,note,updated_at) VALUES ($1,$2,$3,$4,NOW())
        ON CONFLICT (event_id,user_id) DO UPDATE SET response=$3, note=$4, updated_at=NOW()
      `, [event.id, forPartnerId, response, trimmedNote]);
      return res.json({ success: true, response, note: trimmedNote });
    }

    if (aliasId) {
      // Alias response (Guardian Only mode) — verify alias belongs to current user or their partner
      const alias = await queryOne(req.schema,
        `SELECT id FROM guardian_aliases WHERE id=$1 AND (
           guardian_id=$2 OR guardian_id IN (
             SELECT CASE WHEN user_id_1=$2 THEN user_id_2 ELSE user_id_1 END
             FROM guardian_partners WHERE user_id_1=$2 OR user_id_2=$2
           )
         )`,
        [aliasId, req.user.id]);
      if (!alias) return res.status(403).json({ error: 'Alias not found or not yours' });
      await exec(req.schema, `
        INSERT INTO event_alias_availability (event_id,alias_id,response,note,updated_at) VALUES ($1,$2,$3,$4,NOW())
        ON CONFLICT (event_id,alias_id) DO UPDATE SET response=$3, note=$4, updated_at=NOW()
      `, [event.id, aliasId, response, trimmedNote]);
    } else {
      // Regular user response — also allowed if partner is in the event's group
      const itm = await isToolManagerFn(req.schema, req.user);
      const avPartner = await getPartnerId(req.schema, req.user.id);
      const inGroup = await queryOne(req.schema, `
        SELECT 1 FROM event_user_groups eug JOIN user_group_members ugm ON ugm.user_group_id=eug.user_group_id
        WHERE eug.event_id=$1 AND (ugm.user_id=$2 OR ugm.user_id=$3)
      `, [event.id, req.user.id, avPartner || -1]);
      if (!inGroup && !itm) return res.status(403).json({ error: 'You are not assigned to this event' });
      await exec(req.schema, `
        INSERT INTO event_availability (event_id,user_id,response,note,updated_at) VALUES ($1,$2,$3,$4,NOW())
        ON CONFLICT (event_id,user_id) DO UPDATE SET response=$3, note=$4, updated_at=NOW()
      `, [event.id, req.user.id, response, trimmedNote]);
    }
    res.json({ success: true, response, note: trimmedNote });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/availability/note', authMiddleware, async (req, res) => {
  try {
    const existing = await queryOne(req.schema, 'SELECT response FROM event_availability WHERE event_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!existing) return res.status(404).json({ error: 'No availability response found' });
    const trimmedNote = req.body.note ? String(req.body.note).trim().slice(0, 20) : null;
    await exec(req.schema, 'UPDATE event_availability SET note=$1, updated_at=NOW() WHERE event_id=$2 AND user_id=$3', [trimmedNote, req.params.id, req.user.id]);
    res.json({ success: true, note: trimmedNote });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/availability', authMiddleware, async (req, res) => {
  try {
    const { aliasId, forPartnerId } = req.query;
    if (forPartnerId) {
      const isPartner = await queryOne(req.schema,
        'SELECT 1 FROM guardian_partners WHERE (user_id_1=$1 AND user_id_2=$2) OR (user_id_1=$2 AND user_id_2=$1)',
        [req.user.id, forPartnerId]);
      if (!isPartner) return res.status(403).json({ error: 'Not your partner' });
      await exec(req.schema, 'DELETE FROM event_availability WHERE event_id=$1 AND user_id=$2', [req.params.id, forPartnerId]);
    } else if (aliasId) {
      const alias = await queryOne(req.schema,
        `SELECT id FROM guardian_aliases WHERE id=$1 AND (
           guardian_id=$2 OR guardian_id IN (
             SELECT CASE WHEN user_id_1=$2 THEN user_id_2 ELSE user_id_1 END
             FROM guardian_partners WHERE user_id_1=$2 OR user_id_2=$2
           )
         )`,
        [aliasId, req.user.id]);
      if (!alias) return res.status(403).json({ error: 'Alias not found or not yours' });
      await exec(req.schema, 'DELETE FROM event_alias_availability WHERE event_id=$1 AND alias_id=$2', [req.params.id, aliasId]);
    } else {
      await exec(req.schema, 'DELETE FROM event_availability WHERE event_id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/me/bulk-availability', authMiddleware, async (req, res) => {
  const { responses } = req.body;
  if (!Array.isArray(responses)) return res.status(400).json({ error: 'responses array required' });
  try {
    let saved = 0;
    const itm = await isToolManagerFn(req.schema, req.user);
    const bulkPartnerId = await getPartnerId(req.schema, req.user.id);
    for (const { eventId, response } of responses) {
      if (!['going','maybe','not_going'].includes(response)) continue;
      const event = await queryOne(req.schema, 'SELECT * FROM events WHERE id=$1', [eventId]);
      if (!event || !event.track_availability) continue;
      const inGroup = await queryOne(req.schema, `
        SELECT 1 FROM event_user_groups eug JOIN user_group_members ugm ON ugm.user_group_id=eug.user_group_id
        WHERE eug.event_id=$1 AND (ugm.user_id=$2 OR ugm.user_id=$3)
      `, [eventId, req.user.id, bulkPartnerId || -1]);
      if (!inGroup && !itm) continue;
      await exec(req.schema, `
        INSERT INTO event_availability (event_id,user_id,response,updated_at) VALUES ($1,$2,$3,NOW())
        ON CONFLICT (event_id,user_id) DO UPDATE SET response=$3, updated_at=NOW()
      `, [eventId, req.user.id, response]);
      saved++;
    }
    res.json({ success: true, saved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CSV Import ────────────────────────────────────────────────────────────────

router.post('/import/preview', authMiddleware, teamManagerMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const rows = csvParse(req.file.buffer.toString('utf8'), { columns:true, skip_empty_lines:true, trim:true });
    const results = await Promise.all(rows.map(async (row, i) => {
      const title     = row['Event Title'] || row['event_title'] || row['title'] || '';
      const startDate = row['start_date']  || row['Start Date']  || '';
      const startTime = row['start_time']  || row['Start Time']  || '09:00';
      const location  = row['event_location'] || row['location'] || '';
      const typeName  = row['event_type']  || row['Event Type']  || 'Default';
      const durHrs    = parseFloat(row['default_duration'] || row['duration'] || '1') || 1;
      if (!title || !startDate) return { row:i+1, title, error:'Missing title or start date', duplicate:false };
      const startAt = `${startDate}T${startTime.padStart(5,'0')}:00`;
      const endMs   = new Date(startAt).getTime() + durHrs * 3600000;
      const endAt   = isNaN(endMs) ? startAt : new Date(endMs).toISOString().slice(0,19);
      const dup     = await queryOne(req.schema, 'SELECT id,title FROM events WHERE title=$1 AND start_at=$2', [title, startAt]);
      return { row:i+1, title, startAt, endAt, location, typeName, durHrs, duplicate:!!dup, duplicateId:dup?.id, error:null };
    }));
    res.json({ rows: results });
  } catch (e) { res.status(400).json({ error: 'CSV parse error: ' + e.message }); }
});

router.post('/import/confirm', authMiddleware, teamManagerMiddleware, async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows array required' });
  try {
    let imported = 0;
    const colours = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#ec4899'];
    for (const row of rows) {
      if (row.error || row.skip) continue;
      let typeId = null;
      if (row.typeName) {
        let et = await queryOne(req.schema, 'SELECT id FROM event_types WHERE LOWER(name)=LOWER($1)', [row.typeName]);
        if (!et) {
          const usedColours = (await query(req.schema, 'SELECT colour FROM event_types')).map(r => r.colour);
          const colour = colours.find(c => !usedColours.includes(c)) || '#' + Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0');
          const cr = await queryResult(req.schema, 'INSERT INTO event_types (name,colour) VALUES ($1,$2) RETURNING id', [row.typeName, colour]);
          typeId = cr.rows[0].id;
        } else { typeId = et.id; }
      }
      await exec(req.schema,
        'INSERT INTO events (title,event_type_id,start_at,end_at,location,is_public,track_availability,created_by) VALUES ($1,$2,$3,$4,$5,TRUE,FALSE,$6)',
        [row.title, typeId, row.startAt, row.endAt, row.location||null, req.user.id]
      );
      imported++;
    }
    res.json({ success: true, imported });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

return router;
}; // end module.exports
