const express = require('express');
const router  = express.Router();
const { query, queryOne, queryResult, exec } = require('../models/db');
const { authMiddleware, adminMiddleware, teamManagerMiddleware } = require('../middleware/auth');

const R = (schema, type, id) => `${schema}:${type}:${id}`;

module.exports = function(io) {

// ── Helpers ───────────────────────────────────────────────────────────────────

async function postSysMsg(schema, groupId, actorId, content) {
  const r = await queryResult(schema,
    "INSERT INTO messages (group_id,user_id,content,type) VALUES ($1,$2,$3,'system') RETURNING id",
    [groupId, actorId, content]
  );
  const msg = await queryOne(schema, `
    SELECT m.*, u.name AS user_name, u.display_name AS user_display_name,
      u.avatar AS user_avatar, u.role AS user_role, u.status AS user_status,
      u.hide_admin_tag AS user_hide_admin_tag, u.about_me AS user_about_me, u.allow_dm AS user_allow_dm
    FROM messages m JOIN users u ON m.user_id=u.id WHERE m.id=$1
  `, [r.rows[0].id]);
  if (msg) { msg.reactions = []; io.to(R(schema,'group',groupId)).emit('message:new', msg); }
}

async function addUserSilent(schema, dmGroupId, userId) {
  await exec(schema, 'INSERT INTO group_members (group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [dmGroupId, userId]);
  io.in(R(schema,'user',userId)).socketsJoin(R(schema,'group',dmGroupId));
  const dmGroup = await queryOne(schema, 'SELECT * FROM groups WHERE id=$1', [dmGroupId]);
  if (dmGroup) io.to(R(schema,'user',userId)).emit('group:new', { group: dmGroup });
}

async function addUser(schema, dmGroupId, userId, actorId) {
  await addUserSilent(schema, dmGroupId, userId);
  const u = await queryOne(schema, 'SELECT name,display_name FROM users WHERE id=$1', [userId]);
  await postSysMsg(schema, dmGroupId, actorId, `${u?.display_name||u?.name||'A user'} has joined the conversation.`);
}

async function removeUser(schema, dmGroupId, userId, actorId) {
  await exec(schema, 'DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [dmGroupId, userId]);
  io.in(R(schema,'user',userId)).socketsLeave(R(schema,'group',dmGroupId));
  io.to(R(schema,'user',userId)).emit('group:deleted', { groupId: dmGroupId });
  const u = await queryOne(schema, 'SELECT name,display_name FROM users WHERE id=$1', [userId]);
  await postSysMsg(schema, dmGroupId, actorId, `${u?.display_name||u?.name||'A user'} has been removed from the conversation.`);
}

async function getUserIdsForGroup(schema, userGroupId) {
  const rows = await query(schema, 'SELECT user_id FROM user_group_members WHERE user_group_id=$1', [userGroupId]);
  return rows.map(r => r.user_id);
}

// GET /me — current user's user-group memberships
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const rows = await query(req.schema, 'SELECT user_group_id FROM user_group_members WHERE user_id=$1', [req.user.id]);
    const groupIds = rows.map(r => r.user_group_id);
    if (groupIds.length === 0) return res.json({ userGroups: [] });
    const placeholders = groupIds.map((_,i) => `$${i+1}`).join(',');
    const userGroups = await query(req.schema, `SELECT * FROM user_groups WHERE id IN (${placeholders}) ORDER BY name ASC`, groupIds);
    // Also resolve multi-group DMs this user can see
    const mgDms = await query(req.schema, `
      SELECT mgd.*, (SELECT COUNT(*) FROM multi_group_dm_members WHERE multi_group_dm_id=mgd.id) AS group_count
      FROM multi_group_dms mgd
      JOIN multi_group_dm_members mgdm ON mgdm.multi_group_dm_id=mgd.id
      WHERE mgdm.user_group_id IN (${placeholders})
      GROUP BY mgd.id ORDER BY mgd.name ASC
    `, groupIds);
    for (const dm of mgDms) {
      dm.memberGroupIds = (await query(req.schema, 'SELECT user_group_id FROM multi_group_dm_members WHERE multi_group_dm_id=$1', [dm.id])).map(r => r.user_group_id);
    }
    res.json({ userGroups, multiGroupDms: mgDms });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /multigroup
router.get('/multigroup', authMiddleware, teamManagerMiddleware, async (req, res) => {
  try {
    const dms = await query(req.schema, `
      SELECT mgd.*, (SELECT COUNT(*) FROM multi_group_dm_members WHERE multi_group_dm_id=mgd.id) AS group_count
      FROM multi_group_dms mgd ORDER BY mgd.name ASC
    `);
    for (const dm of dms) {
      dm.memberGroupIds = (await query(req.schema, 'SELECT user_group_id FROM multi_group_dm_members WHERE multi_group_dm_id=$1', [dm.id])).map(r => r.user_group_id);
    }
    res.json({ dms });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /multigroup
router.post('/multigroup', authMiddleware, teamManagerMiddleware, async (req, res) => {
  const { name, userGroupIds } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  if (!Array.isArray(userGroupIds) || userGroupIds.length < 2) return res.status(400).json({ error: 'At least 2 groups required' });
  try {
    // Check for existing DM with same groups
    const existing = await queryOne(req.schema, 'SELECT * FROM multi_group_dms WHERE LOWER(name)=LOWER($1)', [name.trim()]);
    if (existing) {
      const existingIds = (await query(req.schema, 'SELECT user_group_id FROM multi_group_dm_members WHERE multi_group_dm_id=$1', [existing.id])).map(r => r.user_group_id).sort();
      const newIds = [...userGroupIds].map(Number).sort();
      if (JSON.stringify(existingIds) === JSON.stringify(newIds)) return res.status(400).json({ error: 'A DM with these groups already exists' });
    }
    // Create the chat group
    const gr = await queryResult(req.schema,
      "INSERT INTO groups (name,type,is_readonly,is_managed,is_multi_group) VALUES ($1,'private',FALSE,TRUE,TRUE) RETURNING id",
      [name.trim()]
    );
    const dmGroupId = gr.rows[0].id;
    // Create multi_group_dms record
    const mgr = await queryResult(req.schema,
      'INSERT INTO multi_group_dms (name,dm_group_id) VALUES ($1,$2) RETURNING id',
      [name.trim(), dmGroupId]
    );
    const mgId = mgr.rows[0].id;
    // Add each user group and their members
    const addedUsers = new Set();
    for (const ugId of userGroupIds) {
      await exec(req.schema, 'INSERT INTO multi_group_dm_members (multi_group_dm_id,user_group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [mgId, ugId]);
      const uids = await getUserIdsForGroup(req.schema, ugId);
      for (const uid of uids) {
        if (!addedUsers.has(uid)) {
          addedUsers.add(uid);
          await addUserSilent(req.schema, dmGroupId, uid);
        }
      }
    }
    const dmGroup = await queryOne(req.schema, 'SELECT * FROM groups WHERE id=$1', [dmGroupId]);
    res.json({ dm: { id: mgId, name: name.trim(), dm_group_id: dmGroupId, group_count: userGroupIds.length }, group: dmGroup });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /multigroup/:id
router.patch('/multigroup/:id', authMiddleware, teamManagerMiddleware, async (req, res) => {
  const { userGroupIds } = req.body;
  try {
    const mg = await queryOne(req.schema, 'SELECT * FROM multi_group_dms WHERE id=$1', [req.params.id]);
    if (!mg) return res.status(404).json({ error: 'Not found' });
    if (!Array.isArray(userGroupIds)) return res.status(400).json({ error: 'userGroupIds required' });
    const currentGroupIds = new Set((await query(req.schema, 'SELECT user_group_id FROM multi_group_dm_members WHERE multi_group_dm_id=$1', [mg.id])).map(r => r.user_group_id));
    const newGroupSet = new Set(userGroupIds.map(Number));
    for (const ugId of newGroupSet) {
      if (!currentGroupIds.has(ugId)) {
        await exec(req.schema, 'INSERT INTO multi_group_dm_members (multi_group_dm_id,user_group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [mg.id, ugId]);
        const uids = await getUserIdsForGroup(req.schema, ugId);
        for (const uid of uids) await addUserSilent(req.schema, mg.dm_group_id, uid);
        await postSysMsg(req.schema, mg.dm_group_id, req.user.id, `A new group has joined this conversation.`);
      }
    }
    for (const ugId of currentGroupIds) {
      if (!newGroupSet.has(ugId)) {
        await exec(req.schema, 'DELETE FROM multi_group_dm_members WHERE multi_group_dm_id=$1 AND user_group_id=$2', [mg.id, ugId]);
        const uids = await getUserIdsForGroup(req.schema, ugId);
        for (const uid of uids) {
          const stillIn = await queryOne(req.schema, `
            SELECT 1 FROM multi_group_dm_members mgdm JOIN user_group_members ugm ON ugm.user_group_id=mgdm.user_group_id
            WHERE mgdm.multi_group_dm_id=$1 AND ugm.user_id=$2
          `, [mg.id, uid]);
          if (!stillIn) {
            await exec(req.schema, 'DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [mg.dm_group_id, uid]);
            io.in(R(req.schema,'user',uid)).socketsLeave(R(req.schema,'group',mg.dm_group_id));
            io.to(R(req.schema,'user',uid)).emit('group:deleted', { groupId: mg.dm_group_id });
          }
        }
        await postSysMsg(req.schema, mg.dm_group_id, req.user.id, `A group has been removed from this conversation.`);
      }
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /multigroup/:id
router.delete('/multigroup/:id', authMiddleware, teamManagerMiddleware, async (req, res) => {
  try {
    const mg = await queryOne(req.schema, 'SELECT * FROM multi_group_dms WHERE id=$1', [req.params.id]);
    if (!mg) return res.status(404).json({ error: 'Not found' });
    if (mg.dm_group_id) {
      const members = (await query(req.schema, 'SELECT user_id FROM group_members WHERE group_id=$1', [mg.dm_group_id])).map(r => r.user_id);
      await exec(req.schema, 'DELETE FROM groups WHERE id=$1', [mg.dm_group_id]);
      for (const uid of members) io.to(R(req.schema,'user',uid)).emit('group:deleted', { groupId: mg.dm_group_id });
    }
    await exec(req.schema, 'DELETE FROM multi_group_dms WHERE id=$1', [mg.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET / — list all user groups
router.get('/', authMiddleware, teamManagerMiddleware, async (req, res) => {
  try {
    const groups = await query(req.schema, `
      SELECT ug.*, (SELECT COUNT(*) FROM user_group_members WHERE user_group_id=ug.id) AS member_count
      FROM user_groups ug ORDER BY ug.name ASC
    `);
    res.json({ groups });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /byuser/:userId — user group IDs for a specific user
router.get('/byuser/:userId', authMiddleware, teamManagerMiddleware, async (req, res) => {
  try {
    const rows = await query(req.schema, 'SELECT user_group_id FROM user_group_members WHERE user_id=$1', [req.params.userId]);
    res.json({ groupIds: rows.map(r => r.user_group_id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /:id
router.get('/:id', authMiddleware, teamManagerMiddleware, async (req, res) => {
  try {
    const group = await queryOne(req.schema, 'SELECT * FROM user_groups WHERE id=$1', [req.params.id]);
    if (!group) return res.status(404).json({ error: 'Not found' });
    const members = await query(req.schema, `
      SELECT u.id,u.name,u.display_name,u.avatar,u.role,u.status
      FROM user_group_members ugm JOIN users u ON u.id=ugm.user_id
      WHERE ugm.user_group_id=$1 ORDER BY u.name ASC
    `, [req.params.id]);
    const aliasMembers = await query(req.schema, `
      SELECT ga.id, ga.first_name, ga.last_name,
             ga.first_name || ' ' || ga.last_name AS name,
             ga.guardian_id, ga.avatar, ga.date_of_birth
      FROM alias_group_members agm
      JOIN guardian_aliases ga ON ga.id = agm.alias_id
      WHERE agm.user_group_id=$1
      ORDER BY ga.first_name, ga.last_name ASC
    `, [req.params.id]);
    res.json({ group, members, aliasMembers });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST / — create user group
router.post('/', authMiddleware, teamManagerMiddleware, async (req, res) => {
  const { name, memberIds = [], noDm = false } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    const existing = await queryOne(req.schema, 'SELECT id FROM user_groups WHERE LOWER(name)=LOWER($1)', [name.trim()]);
    if (existing) return res.status(400).json({ error: 'Name already in use' });

    let dmGroupId = null;
    if (!noDm) {
      const gr = await queryResult(req.schema,
        "INSERT INTO groups (name,type,is_readonly,is_managed) VALUES ($1,'private',FALSE,TRUE) RETURNING id",
        [name.trim()]
      );
      dmGroupId = gr.rows[0].id;
    }

    const ugr = await queryResult(req.schema,
      'INSERT INTO user_groups (name,dm_group_id) VALUES ($1,$2) RETURNING id',
      [name.trim(), dmGroupId]
    );
    const ugId = ugr.rows[0].id;
    const defaultAdmin = await queryOne(req.schema, 'SELECT id FROM users WHERE is_default_admin=TRUE');
    for (const uid of memberIds) {
      if (defaultAdmin && uid === defaultAdmin.id) continue;
      await exec(req.schema, 'INSERT INTO user_group_members (user_group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ugId, uid]);
      if (dmGroupId) await addUserSilent(req.schema, dmGroupId, uid);
    }
    const ug = await queryOne(req.schema, 'SELECT * FROM user_groups WHERE id=$1', [ugId]);
    res.json({ userGroup: ug });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /:id
router.patch('/:id', authMiddleware, teamManagerMiddleware, async (req, res) => {
  const { name, memberIds, createDm = false, aliasMemberIds } = req.body;
  try {
    let ug = await queryOne(req.schema, 'SELECT * FROM user_groups WHERE id=$1', [req.params.id]);
    if (!ug) return res.status(404).json({ error: 'Not found' });

    if (name && name.trim() !== ug.name) {
      const conflict = await queryOne(req.schema, 'SELECT id FROM user_groups WHERE LOWER(name)=LOWER($1) AND id!=$2', [name.trim(), ug.id]);
      if (conflict) return res.status(400).json({ error: 'Name already in use' });
      await exec(req.schema, 'UPDATE user_groups SET name=$1, updated_at=NOW() WHERE id=$2', [name.trim(), ug.id]);
      if (ug.dm_group_id) await exec(req.schema, 'UPDATE groups SET name=$1, updated_at=NOW() WHERE id=$2', [name.trim(), ug.dm_group_id]);
    }

    // Create DM group if requested and one doesn't exist yet
    if (createDm && !ug.dm_group_id) {
      const groupName = (name?.trim()) || ug.name;
      const gr = await queryResult(req.schema,
        "INSERT INTO groups (name,type,is_readonly,is_managed) VALUES ($1,'private',FALSE,TRUE) RETURNING id",
        [groupName]
      );
      const newDmId = gr.rows[0].id;
      await exec(req.schema, 'UPDATE user_groups SET dm_group_id=$1, updated_at=NOW() WHERE id=$2', [newDmId, ug.id]);
      ug = await queryOne(req.schema, 'SELECT * FROM user_groups WHERE id=$1', [ug.id]);
      // Add all current members to the new DM silently (no per-user join messages for a bulk creation)
      const currentMembers = await query(req.schema, 'SELECT user_id FROM user_group_members WHERE user_group_id=$1', [ug.id]);
      for (const { user_id } of currentMembers) {
        await addUserSilent(req.schema, newDmId, user_id);
      }
    }

    if (Array.isArray(memberIds)) {
      const defaultAdmin = await queryOne(req.schema, 'SELECT id FROM users WHERE is_default_admin=TRUE');
      const newIds   = new Set(memberIds.map(Number).filter(Boolean));
      if (defaultAdmin) newIds.delete(defaultAdmin.id); // default admin cannot be in user groups
      const currentSet = new Set((await query(req.schema, 'SELECT user_id FROM user_group_members WHERE user_group_id=$1', [ug.id])).map(r => r.user_id));
      const addedUids = [], removedUids = [];

      for (const uid of newIds) {
        if (!currentSet.has(uid)) {
          await exec(req.schema, 'INSERT INTO user_group_members (user_group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ug.id, uid]);
          if (ug.dm_group_id) await addUserSilent(req.schema, ug.dm_group_id, uid);
          addedUids.push(uid);
        }
      }
      for (const uid of currentSet) {
        if (!newIds.has(uid)) {
          await exec(req.schema, 'DELETE FROM user_group_members WHERE user_group_id=$1 AND user_id=$2', [ug.id, uid]);
          if (ug.dm_group_id) {
            await exec(req.schema, 'DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [ug.dm_group_id, uid]);
            io.in(R(req.schema,'user',uid)).socketsLeave(R(req.schema,'group',ug.dm_group_id));
            io.to(R(req.schema,'user',uid)).emit('group:deleted', { groupId: ug.dm_group_id });
          }
          io.to(R(req.schema,'user',uid)).emit('schedule:refresh');
          removedUids.push(uid);
        }
      }

      // Notification rule (only if DM exists): single user → named message; multiple → generic
      if (ug.dm_group_id) {
        if (addedUids.length === 1) {
          const u = await queryOne(req.schema, 'SELECT name,display_name FROM users WHERE id=$1', [addedUids[0]]);
          await postSysMsg(req.schema, ug.dm_group_id, req.user.id, `${u?.display_name||u?.name||'A user'} has joined the conversation.`);
        } else if (addedUids.length > 1) {
          await postSysMsg(req.schema, ug.dm_group_id, req.user.id, `${addedUids.length} new members have joined the conversation.`);
        }
        if (removedUids.length === 1) {
          const u = await queryOne(req.schema, 'SELECT name,display_name FROM users WHERE id=$1', [removedUids[0]]);
          await postSysMsg(req.schema, ug.dm_group_id, req.user.id, `${u?.display_name||u?.name||'A user'} has been removed from the conversation.`);
        } else if (removedUids.length > 1) {
          await postSysMsg(req.schema, ug.dm_group_id, req.user.id, `${removedUids.length} members have been removed from the conversation.`);
        }
      }

      // Propagate to multi-group DMs
      const mgDms = await query(req.schema, `
        SELECT mgd.id, mgd.dm_group_id FROM multi_group_dm_members mgdm
        JOIN multi_group_dms mgd ON mgd.id=mgdm.multi_group_dm_id WHERE mgdm.user_group_id=$1
      `, [ug.id]);
      for (const mg of mgDms) {
        if (!mg.dm_group_id) continue;
        for (const uid of addedUids) await addUserSilent(req.schema, mg.dm_group_id, uid);
        for (const uid of removedUids) {
          const stillIn = await queryOne(req.schema, `
            SELECT 1 FROM multi_group_dm_members mgdm JOIN user_group_members ugm ON ugm.user_group_id=mgdm.user_group_id
            WHERE mgdm.multi_group_dm_id=$1 AND ugm.user_id=$2
          `, [mg.id, uid]);
          if (!stillIn) {
            await exec(req.schema, 'DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [mg.dm_group_id, uid]);
            io.in(R(req.schema,'user',uid)).socketsLeave(R(req.schema,'group',mg.dm_group_id));
            io.to(R(req.schema,'user',uid)).emit('group:deleted', { groupId: mg.dm_group_id });
          }
        }
        if (addedUids.length === 1) {
          const u = await queryOne(req.schema, 'SELECT name,display_name FROM users WHERE id=$1', [addedUids[0]]);
          await postSysMsg(req.schema, mg.dm_group_id, req.user.id, `${u?.display_name||u?.name||'A user'} has joined this conversation.`);
        } else if (addedUids.length > 1) {
          await postSysMsg(req.schema, mg.dm_group_id, req.user.id, `${addedUids.length} new members have joined this conversation.`);
        }
        if (removedUids.length === 1) {
          const u = await queryOne(req.schema, 'SELECT name,display_name FROM users WHERE id=$1', [removedUids[0]]);
          await postSysMsg(req.schema, mg.dm_group_id, req.user.id, `${u?.display_name||u?.name||'A user'} has been removed from this conversation.`);
        } else if (removedUids.length > 1) {
          await postSysMsg(req.schema, mg.dm_group_id, req.user.id, `${removedUids.length} members have been removed from this conversation.`);
        }
      }
    }

    // Alias member management (Guardian Only mode — players group)
    if (Array.isArray(aliasMemberIds)) {
      const newAliasIds = new Set(aliasMemberIds.map(Number).filter(Boolean));
      const currentAliasSet = new Set(
        (await query(req.schema, 'SELECT alias_id FROM alias_group_members WHERE user_group_id=$1', [ug.id])).map(r => r.alias_id)
      );
      for (const aid of newAliasIds) {
        if (!currentAliasSet.has(aid)) {
          await exec(req.schema, 'INSERT INTO alias_group_members (user_group_id,alias_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ug.id, aid]);
        }
      }
      for (const aid of currentAliasSet) {
        if (!newAliasIds.has(aid)) {
          await exec(req.schema, 'DELETE FROM alias_group_members WHERE user_group_id=$1 AND alias_id=$2', [ug.id, aid]);
        }
      }
    }

    const updated = await queryOne(req.schema, 'SELECT * FROM user_groups WHERE id=$1', [req.params.id]);
    res.json({ group: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /:id
router.delete('/:id', authMiddleware, teamManagerMiddleware, async (req, res) => {
  try {
    const ug = await queryOne(req.schema, 'SELECT * FROM user_groups WHERE id=$1', [req.params.id]);
    if (!ug) return res.status(404).json({ error: 'Not found' });
    if (ug.dm_group_id) {
      const members = (await query(req.schema, 'SELECT user_id FROM group_members WHERE group_id=$1', [ug.dm_group_id])).map(r => r.user_id);
      await exec(req.schema, 'DELETE FROM groups WHERE id=$1', [ug.dm_group_id]);
      for (const uid of members) { io.in(R(req.schema,'user',uid)).socketsLeave(R(req.schema,'group',ug.dm_group_id)); io.to(R(req.schema,'user',uid)).emit('group:deleted', { groupId: ug.dm_group_id }); }
    }
    await exec(req.schema, 'DELETE FROM user_groups WHERE id=$1', [ug.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// POST /:id/members/:userId — add a single user to a group (with DM + notifications)
router.post('/:id/members/:userId', authMiddleware, teamManagerMiddleware, async (req, res) => {
  try {
    const ug = await queryOne(req.schema, 'SELECT * FROM user_groups WHERE id=$1', [req.params.id]);
    if (!ug) return res.status(404).json({ error: 'Not found' });
    const userId = parseInt(req.params.userId);
    const defaultAdmin = await queryOne(req.schema, 'SELECT id FROM users WHERE is_default_admin=TRUE');
    if (defaultAdmin && userId === defaultAdmin.id) return res.status(400).json({ error: 'Cannot add default admin to user groups' });

    await exec(req.schema, 'INSERT INTO user_group_members (user_group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ug.id, userId]);

    if (ug.dm_group_id) {
      await addUserSilent(req.schema, ug.dm_group_id, userId);
      const u = await queryOne(req.schema, 'SELECT name,display_name FROM users WHERE id=$1', [userId]);
      await postSysMsg(req.schema, ug.dm_group_id, req.user.id, `${u?.display_name||u?.name||'A user'} has joined the conversation.`);
    }

    // Propagate to multi-group DMs
    const mgDms = await query(req.schema, `
      SELECT mgd.id, mgd.dm_group_id FROM multi_group_dm_members mgdm
      JOIN multi_group_dms mgd ON mgd.id=mgdm.multi_group_dm_id WHERE mgdm.user_group_id=$1
    `, [ug.id]);
    for (const mg of mgDms) {
      if (!mg.dm_group_id) continue;
      await addUserSilent(req.schema, mg.dm_group_id, userId);
      const u = await queryOne(req.schema, 'SELECT name,display_name FROM users WHERE id=$1', [userId]);
      await postSysMsg(req.schema, mg.dm_group_id, req.user.id, `${u?.display_name||u?.name||'A user'} has joined this conversation.`);
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /:id/members/:userId — remove a single user from a group (with DM + notifications)
router.delete('/:id/members/:userId', authMiddleware, teamManagerMiddleware, async (req, res) => {
  try {
    const ug = await queryOne(req.schema, 'SELECT * FROM user_groups WHERE id=$1', [req.params.id]);
    if (!ug) return res.status(404).json({ error: 'Not found' });
    const userId = parseInt(req.params.userId);

    await exec(req.schema, 'DELETE FROM user_group_members WHERE user_group_id=$1 AND user_id=$2', [ug.id, userId]);

    io.to(R(req.schema,'user',userId)).emit('schedule:refresh');

    if (ug.dm_group_id) {
      await exec(req.schema, 'DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [ug.dm_group_id, userId]);
      io.in(R(req.schema,'user',userId)).socketsLeave(R(req.schema,'group',ug.dm_group_id));
      io.to(R(req.schema,'user',userId)).emit('group:deleted', { groupId: ug.dm_group_id });
      const u = await queryOne(req.schema, 'SELECT name,display_name FROM users WHERE id=$1', [userId]);
      await postSysMsg(req.schema, ug.dm_group_id, req.user.id, `${u?.display_name||u?.name||'A user'} has been removed from the conversation.`);
    }

    // Propagate to multi-group DMs
    const mgDms = await query(req.schema, `
      SELECT mgd.id, mgd.dm_group_id FROM multi_group_dm_members mgdm
      JOIN multi_group_dms mgd ON mgd.id=mgdm.multi_group_dm_id WHERE mgdm.user_group_id=$1
    `, [ug.id]);
    for (const mg of mgDms) {
      if (!mg.dm_group_id) continue;
      const stillIn = await queryOne(req.schema, `
        SELECT 1 FROM multi_group_dm_members mgdm JOIN user_group_members ugm ON ugm.user_group_id=mgdm.user_group_id
        WHERE mgdm.multi_group_dm_id=$1 AND ugm.user_id=$2
      `, [mg.id, userId]);
      if (!stillIn) {
        await exec(req.schema, 'DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [mg.dm_group_id, userId]);
        io.in(R(req.schema,'user',userId)).socketsLeave(R(req.schema,'group',mg.dm_group_id));
        io.to(R(req.schema,'user',userId)).emit('group:deleted', { groupId: mg.dm_group_id });
        const u = await queryOne(req.schema, 'SELECT name,display_name FROM users WHERE id=$1', [userId]);
        await postSysMsg(req.schema, mg.dm_group_id, req.user.id, `${u?.display_name||u?.name||'A user'} has been removed from this conversation.`);
      }
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── U2U DM Restrictions ───────────────────────────────────────────────────────

// GET /:id/restrictions — get blocked group IDs for a user group
router.get('/:id/restrictions', authMiddleware, teamManagerMiddleware, async (req, res) => {
  try {
    const rows = await query(req.schema,
      'SELECT blocked_group_id FROM user_group_dm_restrictions WHERE restricting_group_id = $1',
      [req.params.id]
    );
    res.json({ blockedGroupIds: rows.map(r => r.blocked_group_id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /:id/restrictions — replace the full restriction list for a user group
// Body: { blockedGroupIds: [id, id, ...] }
router.put('/:id/restrictions', authMiddleware, teamManagerMiddleware, async (req, res) => {
  const { blockedGroupIds = [] } = req.body;
  const restrictingId = parseInt(req.params.id);
  try {
    const ug = await queryOne(req.schema, 'SELECT id FROM user_groups WHERE id = $1', [restrictingId]);
    if (!ug) return res.status(404).json({ error: 'User group not found' });

    // Clear all existing restrictions for this group then insert new ones
    await exec(req.schema,
      'DELETE FROM user_group_dm_restrictions WHERE restricting_group_id = $1',
      [restrictingId]
    );
    for (const blockedId of blockedGroupIds) {
      if (parseInt(blockedId) === restrictingId) continue; // cannot restrict own group
      await exec(req.schema,
        'INSERT INTO user_group_dm_restrictions (restricting_group_id, blocked_group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [restrictingId, parseInt(blockedId)]
      );
    }
    res.json({ success: true, blockedGroupIds });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// DELETE /api/usergroups/:id/members/:userId — admin force-remove (for deleted/orphaned users)
router.delete('/:id/members/:userId', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const ugId = parseInt(req.params.id);
    const userId = parseInt(req.params.userId);
    const ug = await queryOne(req.schema, 'SELECT id FROM user_groups WHERE id=$1', [ugId]);
    if (!ug) return res.status(404).json({ error: 'User group not found' });
    await exec(req.schema,
      'DELETE FROM user_group_members WHERE user_group_id=$1 AND user_id=$2',
      [ugId, userId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

return router;
};
