-- Migration 008: Rebrand — update app_type values from JAMA-* to RosterChirp-*
UPDATE settings SET value = 'RosterChirp-Chat'  WHERE key = 'app_type' AND value = 'JAMA-Chat';
UPDATE settings SET value = 'RosterChirp-Brand' WHERE key = 'app_type' AND value = 'JAMA-Brand';
UPDATE settings SET value = 'RosterChirp-Team'  WHERE key = 'app_type' AND value = 'JAMA-Team';
