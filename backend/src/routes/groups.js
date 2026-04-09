const express = require('express');
const fs      = require('fs');
const router  = express.Router();
const { query, queryOne, queryResult, exec } = require('../models/db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

async function getLoginType(schema) {
  const row = await queryOne(schema, "SELECT value FROM settings WHERE key='feature_login_type'");
  return row?.value || 'all_ages';
}

function deleteImageFile(imageUrl) {
  if (!imageUrl) return;
  try { const fp = '/app' + imageUrl; if (fs.existsSync(fp)) fs.unlinkSync(fp); }
  catch (e) { console.warn('[Groups] Could not delete image:', e.message); }
}

// Schema-aware room name helper
const R = (schema, type, id) => `${schema}:${type}:${id}`;

// Compute and store composite_members for a non-managed private group.
// Captures up to 4 current members (excluding deleted users), ordered by name.
async function computeAndStoreComposite(schema, groupId) {
  const members = await query(schema,
    `SELECT u.id, u.name, u.avatar FROM group_members gm
     JOIN users u ON gm.user_id = u.id
     WHERE gm.group_id = $1 AND u.name != 'Deleted User'
     ORDER BY u.name LIMIT 4`,
    [groupId]
  );
  await exec(schema, 'UPDATE groups SET composite_members=$1 WHERE id=$2',
    [JSON.stringify(members), groupId]
  );
}

module.exports = (io) => {

async function emitGroupNew(schema, io, groupId) {
  const group = await queryOne(schema, 'SELECT * FROM groups WHERE id=$1', [groupId]);
  if (!group) return;
  if (group.type === 'public') {
    io.to(R(schema, 'schema', 'all')).emit('group:new', { group });
  } else {
    const members = await query(schema, 'SELECT user_id FROM group_members WHERE group_id=$1', [groupId]);
    for (const m of members) io.to(R(schema, 'user', m.user_id)).emit('group:new', { group });
  }
}

async function emitGroupUpdated(schema, io, groupId) {
  const group = await queryOne(schema, 'SELECT * FROM groups WHERE id=$1', [groupId]);
  if (!group) return;
  let uids;
  if (group.type === 'public') {
    uids = await query(schema, "SELECT id AS user_id FROM users WHERE status='active'");
  } else {
    uids = await query(schema, 'SELECT user_id FROM group_members WHERE group_id=$1', [groupId]);
  }
  for (const m of uids) io.to(R(schema, 'user', m.user_id)).emit('group:updated', { group });
}

// GET all groups for current user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const publicGroups = await query(req.schema, `
      SELECT g.*,
        (SELECT COUNT(*) FROM messages m WHERE m.group_id=g.id AND m.is_deleted=FALSE) AS message_count,
        (SELECT m.content  FROM messages m WHERE m.group_id=g.id AND m.is_deleted=FALSE ORDER BY m.created_at DESC LIMIT 1) AS last_message,
        (SELECT m.created_at FROM messages m WHERE m.group_id=g.id AND m.is_deleted=FALSE ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
        (SELECT m.user_id  FROM messages m WHERE m.group_id=g.id AND m.is_deleted=FALSE ORDER BY m.created_at DESC LIMIT 1) AS last_message_user_id
      FROM groups g WHERE g.type='public' ORDER BY g.is_default DESC, g.name ASC
    `);

    const privateGroupsRaw = await query(req.schema, `
      SELECT g.*, u.name AS owner_name, ug.id AS source_user_group_id,
        (SELECT COUNT(*) FROM messages m WHERE m.group_id=g.id AND m.is_deleted=FALSE) AS message_count,
        (SELECT m.content  FROM messages m WHERE m.group_id=g.id AND m.is_deleted=FALSE ORDER BY m.created_at DESC LIMIT 1) AS last_message,
        (SELECT m.created_at FROM messages m WHERE m.group_id=g.id AND m.is_deleted=FALSE ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
        (SELECT m.user_id  FROM messages m WHERE m.group_id=g.id AND m.is_deleted=FALSE ORDER BY m.created_at DESC LIMIT 1) AS last_message_user_id,
        (SELECT json_agg(t) FROM (
          SELECT u2.id, u2.name, u2.avatar
          FROM group_members gm2
          JOIN users u2 ON gm2.user_id = u2.id
          WHERE gm2.group_id = g.id AND u2.name != 'Deleted User'
          ORDER BY u2.name LIMIT 4
        ) t) AS member_previews
      FROM groups g JOIN group_members gm ON g.id=gm.group_id AND gm.user_id=$1
      LEFT JOIN users u ON g.owner_id=u.id
      LEFT JOIN user_groups ug ON ug.dm_group_id=g.id AND g.is_managed=TRUE AND g.is_multi_group IS NOT TRUE
      WHERE g.type='private'
      ORDER BY last_message_at DESC NULLS LAST
    `, [userId]);

    const privateGroups = await Promise.all(privateGroupsRaw.map(async g => {
      if (g.is_direct) {
        if (!g.direct_peer1_id || !g.direct_peer2_id) {
          const peers = await query(req.schema, 'SELECT user_id FROM group_members WHERE group_id=$1 LIMIT 2', [g.id]);
          if (peers.length === 2) {
            await exec(req.schema, 'UPDATE groups SET direct_peer1_id=$1, direct_peer2_id=$2 WHERE id=$3', [peers[0].user_id, peers[1].user_id, g.id]);
            g.direct_peer1_id = peers[0].user_id; g.direct_peer2_id = peers[1].user_id;
          }
        }
        const otherUserId = g.direct_peer1_id === userId ? g.direct_peer2_id : g.direct_peer1_id;
        if (otherUserId) {
          const other = await queryOne(req.schema, 'SELECT display_name, name, avatar FROM users WHERE id=$1', [otherUserId]);
          if (other) {
            g.peer_id = otherUserId; g.peer_real_name = other.name;
            g.peer_display_name = other.display_name || null; g.peer_avatar = other.avatar || null;
            g.name = other.display_name || other.name;
          }
        }
      }
      const custom = await queryOne(req.schema, 'SELECT name FROM user_group_names WHERE user_id=$1 AND group_id=$2', [userId, g.id]);
      if (custom) { g.owner_name_original = g.name; g.name = custom.name; }
      return g;
    }));

    res.json({ publicGroups, privateGroups });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST create group
router.post('/', authMiddleware, async (req, res) => {
  const { name, type, memberIds, isReadonly, isDirect } = req.body;
  try {
    if (type === 'public' && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Only admins can create public groups' });

    // Direct message
    if (isDirect && memberIds?.length === 1) {
      const otherUserId = memberIds[0], userId = req.user.id;

      // U2U restriction check — admins always exempt
      if (req.user.role !== 'admin') {
        // Get all user groups the initiating user belongs to
        const initiatorGroups = await query(req.schema,
          'SELECT user_group_id FROM user_group_members WHERE user_id = $1', [userId]
        );
        const initiatorGroupIds = initiatorGroups.map(r => r.user_group_id);

        // Get all user groups the target user belongs to
        const targetGroups = await query(req.schema,
          'SELECT user_group_id FROM user_group_members WHERE user_id = $1', [otherUserId]
        );
        const targetGroupIds = targetGroups.map(r => r.user_group_id);

        // Least-restrictive-wins: the initiator needs at least ONE group
        // that has no restriction against ALL of the target's groups.
        // If initiatorGroups is empty, no restrictions apply (user not in any managed group).
        if (initiatorGroupIds.length > 0 && targetGroupIds.length > 0) {
          // For each initiator group, check if it is restricted from ANY of the target groups
          let canDm = false;
          for (const igId of initiatorGroupIds) {
            const restrictions = await query(req.schema,
              'SELECT blocked_group_id FROM user_group_dm_restrictions WHERE restricting_group_id = $1',
              [igId]
            );
            const blockedIds = new Set(restrictions.map(r => r.blocked_group_id));
            // This initiator group is unrestricted if none of the target's groups are blocked
            const isRestricted = targetGroupIds.some(tgId => blockedIds.has(tgId));
            if (!isRestricted) { canDm = true; break; }
          }
          if (!canDm) {
            return res.status(403).json({
              error: 'Direct messages with this user are not permitted.',
              code: 'DM_RESTRICTED'
            });
          }
        }
      }

      const existing = await queryOne(req.schema, `
        SELECT g.id FROM groups g
        JOIN group_members gm1 ON gm1.group_id=g.id AND gm1.user_id=$1
        JOIN group_members gm2 ON gm2.group_id=g.id AND gm2.user_id=$2
        WHERE g.is_direct=TRUE LIMIT 1
      `, [userId, otherUserId]);
      if (existing) {
        await exec(req.schema, "UPDATE groups SET is_readonly=FALSE, owner_id=NULL, updated_at=NOW() WHERE id=$1", [existing.id]);
        await exec(req.schema, 'INSERT INTO group_members (group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [existing.id, userId]);
        return res.json({ group: await queryOne(req.schema, 'SELECT * FROM groups WHERE id=$1', [existing.id]) });
      }
      const otherUser = await queryOne(req.schema, 'SELECT name, display_name FROM users WHERE id=$1', [otherUserId]);
      const dmName = (otherUser?.display_name || otherUser?.name) + ' ↔ ' + (req.user.display_name || req.user.name);
      const r = await queryResult(req.schema,
        "INSERT INTO groups (name,type,owner_id,is_readonly,is_direct,direct_peer1_id,direct_peer2_id) VALUES ($1,'private',NULL,FALSE,TRUE,$2,$3) RETURNING id",
        [dmName, userId, otherUserId]
      );
      const groupId = r.rows[0].id;
      await exec(req.schema, 'INSERT INTO group_members (group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [groupId, userId]);
      await exec(req.schema, 'INSERT INTO group_members (group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [groupId, otherUserId]);

      // Mixed Age: if initiator is not a minor and the other user is a minor, auto-add their guardian
      let guardianAdded = false, guardianName = null;
      const loginType = await getLoginType(req.schema);
      if (loginType === 'mixed_age' && !req.user.is_minor) {
        const otherUserFull = await queryOne(req.schema,
          'SELECT is_minor, guardian_user_id FROM users WHERE id=$1', [otherUserId]);
        if (otherUserFull?.is_minor && otherUserFull.guardian_user_id) {
          const guardianId = otherUserFull.guardian_user_id;
          if (guardianId !== userId) {
            await exec(req.schema,
              'INSERT INTO group_members (group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
              [groupId, guardianId]);
            const guardian = await queryOne(req.schema,
              'SELECT name, display_name FROM users WHERE id=$1', [guardianId]);
            guardianAdded = true;
            guardianName = guardian?.display_name || guardian?.name || null;
          }
        }
      }

      await emitGroupNew(req.schema, io, groupId);
      const group = await queryOne(req.schema, 'SELECT * FROM groups WHERE id=$1', [groupId]);
      return res.json({ group, guardianAdded, guardianName });
    }

    // Check for duplicate private group
    if ((type === 'private' || !type) && !isDirect && memberIds?.length > 0) {
      const allMemberIds = [...new Set([req.user.id, ...memberIds])].sort((a,b) => a-b);
      const candidates = await query(req.schema,
        'SELECT g.id FROM groups g JOIN group_members gm ON gm.group_id=g.id AND gm.user_id=$1 WHERE g.type=\'private\' AND g.is_direct=FALSE',
        [req.user.id]
      );
      for (const c of candidates) {
        const members = (await query(req.schema, 'SELECT user_id FROM group_members WHERE group_id=$1 ORDER BY user_id', [c.id])).map(r => r.user_id);
        if (members.length === allMemberIds.length && members.every((id,i) => id === allMemberIds[i]))
          return res.json({ group: await queryOne(req.schema, 'SELECT * FROM groups WHERE id=$1', [c.id]), duplicate: true });
      }
    }

    const r = await queryResult(req.schema,
      'INSERT INTO groups (name,type,owner_id,is_readonly,is_direct) VALUES ($1,$2,$3,$4,FALSE) RETURNING id',
      [name, type||'private', req.user.id, !!isReadonly]
    );
    const groupId = r.rows[0].id;
    const groupGuardianNames = [];
    if (type === 'public') {
      const allUsers = await query(req.schema, "SELECT id FROM users WHERE status='active'");
      for (const u of allUsers) await exec(req.schema, 'INSERT INTO group_members (group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [groupId, u.id]);
    } else {
      await exec(req.schema, 'INSERT INTO group_members (group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [groupId, req.user.id]);
      if (memberIds?.length > 0) {
        const defaultAdmin = await queryOne(req.schema, 'SELECT id FROM users WHERE is_default_admin=TRUE');
        for (const uid of memberIds) {
          if (defaultAdmin && uid === defaultAdmin.id) continue;
          await exec(req.schema, 'INSERT INTO group_members (group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [groupId, uid]);
        }
      }
      // Generate composite avatar for non-managed private groups with 3+ members
      const totalCount = await queryOne(req.schema, 'SELECT COUNT(*) AS cnt FROM group_members WHERE group_id=$1', [groupId]);
      if (parseInt(totalCount.cnt) >= 3) {
        await computeAndStoreComposite(req.schema, groupId);
      }

      // Mixed Age: auto-add guardians for any minor members (non-minor initiators only)
      const groupLoginType = await getLoginType(req.schema);
      if (groupLoginType === 'mixed_age' && !req.user.is_minor && memberIds?.length > 0) {
        for (const uid of memberIds) {
          const memberInfo = await queryOne(req.schema,
            'SELECT is_minor, guardian_user_id FROM users WHERE id=$1', [uid]);
          if (memberInfo?.is_minor && memberInfo.guardian_user_id && memberInfo.guardian_user_id !== req.user.id) {
            await exec(req.schema,
              'INSERT INTO group_members (group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
              [groupId, memberInfo.guardian_user_id]);
            const g = await queryOne(req.schema,
              'SELECT name,display_name FROM users WHERE id=$1', [memberInfo.guardian_user_id]);
            const gName = g?.display_name || g?.name;
            if (gName && !groupGuardianNames.includes(gName)) groupGuardianNames.push(gName);
          }
        }
      }
    }
    await emitGroupNew(req.schema, io, groupId);
    res.json({
      group: await queryOne(req.schema, 'SELECT * FROM groups WHERE id=$1', [groupId]),
      ...(groupGuardianNames.length ? { guardianAdded: true, guardianName: groupGuardianNames.join(', ') } : {}),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH rename
router.patch('/:id/rename', authMiddleware, async (req, res) => {
  const { name } = req.body;
  try {
    const group = await queryOne(req.schema, 'SELECT * FROM groups WHERE id=$1', [req.params.id]);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.is_default) return res.status(403).json({ error: 'Cannot rename default group' });
    if (group.is_direct)  return res.status(403).json({ error: 'Cannot rename a direct message' });
    if (group.type === 'public' && req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can rename public groups' });
    if (group.type === 'private' && group.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only owner can rename' });
    await exec(req.schema, 'UPDATE groups SET name=$1, updated_at=NOW() WHERE id=$2', [name, group.id]);
    await emitGroupUpdated(req.schema, io, group.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET members
router.get('/:id/members', authMiddleware, async (req, res) => {
  try {
    const members = await query(req.schema,
      'SELECT u.id,u.name,u.display_name,u.avatar,u.role,u.status FROM group_members gm JOIN users u ON gm.user_id=u.id WHERE gm.group_id=$1 ORDER BY u.name ASC',
      [req.params.id]
    );
    res.json({ members });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST add member
router.post('/:id/members', authMiddleware, async (req, res) => {
  const { userId } = req.body;
  try {
    const group = await queryOne(req.schema, 'SELECT * FROM groups WHERE id=$1', [req.params.id]);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.type !== 'private') return res.status(400).json({ error: 'Cannot manually add members to public groups' });
    if (group.is_direct) return res.status(400).json({ error: 'Cannot add members to a direct message' });
    if (group.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only owner can add members' });
    const targetUser = await queryOne(req.schema, 'SELECT is_default_admin FROM users WHERE id=$1', [userId]);
    if (targetUser?.is_default_admin) return res.status(400).json({ error: 'Default admin cannot be added to private groups' });
    // Capture pre-add count to decide if composite should regenerate
    const preAddCount = await queryOne(req.schema, 'SELECT COUNT(*) AS cnt FROM group_members WHERE group_id=$1', [group.id]);
    await exec(req.schema, 'INSERT INTO group_members (group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [group.id, userId]);
    const addedUser = await queryOne(req.schema, 'SELECT name,display_name FROM users WHERE id=$1', [userId]);
    const addedName = addedUser?.display_name || addedUser?.name || 'Unknown';
    const mr = await queryResult(req.schema,
      "INSERT INTO messages (group_id,user_id,content,type) VALUES ($1,$2,$3,'system') RETURNING id",
      [group.id, userId, `${addedName} has joined the conversation.`]
    );
    const sysMsg = await queryOne(req.schema,
      'SELECT m.*,u.name AS user_name,u.display_name AS user_display_name,u.avatar AS user_avatar,u.role AS user_role,u.status AS user_status,u.hide_admin_tag AS user_hide_admin_tag,u.about_me AS user_about_me FROM messages m JOIN users u ON m.user_id=u.id WHERE m.id=$1',
      [mr.rows[0].id]
    );
    sysMsg.reactions = [];
    io.to(R(req.schema,'group',group.id)).emit('message:new', sysMsg);
    // For non-managed private groups, always notify existing members of the updated group,
    // and regenerate composite when pre-add count was ≤3 and new total reaches ≥3.
    if (!group.is_managed && !group.is_direct) {
      const preCount = parseInt(preAddCount.cnt);
      if (preCount <= 3) {
        const newTotal = preCount + 1;
        if (newTotal >= 3) {
          await computeAndStoreComposite(req.schema, group.id);
        }
      }
      await emitGroupUpdated(req.schema, io, group.id);
    }
    io.in(R(req.schema,'user',userId)).socketsJoin(R(req.schema,'group',group.id));
    io.to(R(req.schema,'user',userId)).emit('group:new', { group });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE remove member
router.delete('/:id/members/:userId', authMiddleware, async (req, res) => {
  try {
    const group = await queryOne(req.schema, 'SELECT * FROM groups WHERE id=$1', [req.params.id]);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.type !== 'private') return res.status(400).json({ error: 'Cannot remove members from public groups' });
    if (group.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only owner or admin can remove members' });
    const targetId = parseInt(req.params.userId);
    // Admins can remove the owner only if the owner is a deleted user (orphan cleanup)
    const targetUser = await queryOne(req.schema, 'SELECT status FROM users WHERE id=$1', [targetId]);
    const isDeletedOrphan = targetUser?.status === 'deleted';
    if (targetId === group.owner_id && !isDeletedOrphan && req.user.role !== 'admin') {
      return res.status(400).json({ error: 'Cannot remove the group owner' });
    }
    if (targetId === group.owner_id && !isDeletedOrphan) {
      return res.status(400).json({ error: 'Cannot remove the group owner' });
    }
    const removedUser = await queryOne(req.schema, 'SELECT name,display_name FROM users WHERE id=$1', [targetId]);
    const removedName = removedUser?.display_name || removedUser?.name || 'Unknown';
    await exec(req.schema, 'DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, targetId]);
    const mr = await queryResult(req.schema,
      "INSERT INTO messages (group_id,user_id,content,type) VALUES ($1,$2,$3,'system') RETURNING id",
      [group.id, targetId, `${removedName} has been removed from the conversation.`]
    );
    const sysMsg = await queryOne(req.schema,
      'SELECT m.*,u.name AS user_name,u.display_name AS user_display_name,u.avatar AS user_avatar,u.role AS user_role,u.status AS user_status,u.hide_admin_tag AS user_hide_admin_tag,u.about_me AS user_about_me FROM messages m JOIN users u ON m.user_id=u.id WHERE m.id=$1',
      [mr.rows[0].id]
    );
    sysMsg.reactions = [];
    io.to(R(req.schema,'group',group.id)).emit('message:new', sysMsg);
    io.in(R(req.schema,'user',targetId)).socketsLeave(R(req.schema,'group',group.id));
    io.to(R(req.schema,'user',targetId)).emit('group:deleted', { groupId: group.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE leave
router.delete('/:id/leave', authMiddleware, async (req, res) => {
  try {
    const group = await queryOne(req.schema, 'SELECT * FROM groups WHERE id=$1', [req.params.id]);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.type === 'public') return res.status(400).json({ error: 'Cannot leave public groups' });
    if (group.is_managed && req.user.role !== 'admin') return res.status(403).json({ error: 'This group is managed by an administrator.' });
    const userId = req.user.id;
    const leaverName = req.user.display_name || req.user.name;
    await exec(req.schema, 'DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [group.id, userId]);
    const mr = await queryResult(req.schema,
      "INSERT INTO messages (group_id,user_id,content,type) VALUES ($1,$2,$3,'system') RETURNING id",
      [group.id, userId, `${leaverName} has left the conversation.`]
    );
    const sysMsg = await queryOne(req.schema,
      'SELECT m.*,u.name AS user_name,u.display_name AS user_display_name,u.avatar AS user_avatar,u.role AS user_role,u.status AS user_status,u.hide_admin_tag AS user_hide_admin_tag,u.about_me AS user_about_me FROM messages m JOIN users u ON m.user_id=u.id WHERE m.id=$1',
      [mr.rows[0].id]
    );
    sysMsg.reactions = [];
    io.to(R(req.schema,'group',group.id)).emit('message:new', sysMsg);
    io.in(R(req.schema,'user',userId)).socketsLeave(R(req.schema,'group',group.id));
    io.to(R(req.schema,'user',userId)).emit('group:deleted', { groupId: group.id });
    if (group.is_direct) {
      const remaining = await queryOne(req.schema, 'SELECT user_id FROM group_members WHERE group_id=$1 LIMIT 1', [group.id]);
      if (remaining) await exec(req.schema, 'UPDATE groups SET owner_id=$1, updated_at=NOW() WHERE id=$2', [remaining.user_id, group.id]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST take-ownership
router.post('/:id/take-ownership', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const group = await queryOne(req.schema, 'SELECT * FROM groups WHERE id=$1', [req.params.id]);
    if (group?.is_managed) return res.status(403).json({ error: 'Managed groups are administered via the Group Manager.' });
    await exec(req.schema, 'UPDATE groups SET owner_id=$1, updated_at=NOW() WHERE id=$2', [req.user.id, req.params.id]);
    await exec(req.schema, 'INSERT INTO group_members (group_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE group
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const group = await queryOne(req.schema, 'SELECT * FROM groups WHERE id=$1', [req.params.id]);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (group.is_default) return res.status(403).json({ error: 'Cannot delete default group' });
    if (group.type === 'public' && req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can delete public groups' });
    if (group.type === 'private' && group.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only owner or admin can delete' });
    const members = (await query(req.schema, 'SELECT user_id FROM group_members WHERE group_id=$1', [group.id])).map(m => m.user_id);
    if (group.type === 'public') {
      const all = await query(req.schema, "SELECT id FROM users WHERE status='active'");
      for (const u of all) if (!members.includes(u.id)) members.push(u.id);
    }
    const imageMessages = await query(req.schema, 'SELECT image_url FROM messages WHERE group_id=$1 AND image_url IS NOT NULL', [group.id]);
    await exec(req.schema, 'DELETE FROM groups WHERE id=$1', [group.id]);
    for (const msg of imageMessages) deleteImageFile(msg.image_url);
    for (const uid of members) io.to(R(req.schema,'user',uid)).emit('group:deleted', { groupId: group.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH custom-name
router.patch('/:id/custom-name', authMiddleware, async (req, res) => {
  const { name } = req.body;
  const groupId = parseInt(req.params.id), userId = req.user.id;
  try {
    if (!name?.trim()) {
      await exec(req.schema, 'DELETE FROM user_group_names WHERE user_id=$1 AND group_id=$2', [userId, groupId]);
      return res.json({ success: true, name: null });
    }
    await exec(req.schema,
      'INSERT INTO user_group_names (user_id,group_id,name) VALUES ($1,$2,$3) ON CONFLICT (user_id,group_id) DO UPDATE SET name=EXCLUDED.name',
      [userId, groupId, name.trim()]
    );
    res.json({ success: true, name: name.trim() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

return router;
};
