const { getDatabase, transaction } = require('./connection');
const { backupDatabase } = require('./backup');

const defaultAccountLinks = [
  {
    primaryDiscordId: '1276439186513203234',
    linkedDiscordId: '1276439186513203234',
    label: 'Tmaiusculo'
  },
  {
    primaryDiscordId: '1276439186513203234',
    linkedDiscordId: '1436716667894759475',
    label: 'Tmaiusculo'
  }
];

const migrations = [
  {
    version: 1,
    name: 'initial_schema',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS users (
          discord_id TEXT PRIMARY KEY,
          discord_name TEXT,
          albion_name TEXT UNIQUE,
          registration_status TEXT NOT NULL DEFAULT 'unregistered',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS registrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          discord_id TEXT NOT NULL,
          albion_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          reviewed_by TEXT,
          review_note TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          reviewed_at TEXT,
          FOREIGN KEY (discord_id) REFERENCES users(discord_id)
        );

        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_code TEXT UNIQUE NOT NULL,
          creator_id TEXT NOT NULL,
          takeover_by TEXT,
          title TEXT NOT NULL,
          description TEXT,
          location TEXT,
          scheduled_time TEXT,
          tank_slots INTEGER NOT NULL DEFAULT 0,
          healer_slots INTEGER NOT NULL DEFAULT 0,
          support_slots INTEGER NOT NULL DEFAULT 0,
          dps_slots INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'created',
          message_id TEXT,
          voice_channel_id TEXT,
          review_required INTEGER NOT NULL DEFAULT 0,
          cancel_reason TEXT,
          started_at TEXT,
          ended_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS event_participants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER NOT NULL,
          discord_id TEXT NOT NULL,
          role TEXT NOT NULL,
          is_spectator INTEGER NOT NULL DEFAULT 0,
          manual_seconds INTEGER,
          calculated_seconds INTEGER NOT NULL DEFAULT 0,
          payout_amount INTEGER NOT NULL DEFAULT 0,
          joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(event_id, discord_id),
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS event_voice_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER NOT NULL,
          discord_id TEXT NOT NULL,
          joined_at TEXT NOT NULL,
          left_at TEXT,
          seconds INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS event_reviews (
          event_id INTEGER PRIMARY KEY,
          loot_total INTEGER NOT NULL DEFAULT 0,
          repair INTEGER NOT NULL DEFAULT 0,
          silver_bags INTEGER NOT NULL DEFAULT 0,
          tax_percent INTEGER NOT NULL DEFAULT 0,
          net_loot INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'draft',
          submitted_by TEXT,
          approved_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          submitted_at TEXT,
          approved_at TEXT,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS balances (
          discord_id TEXT PRIMARY KEY,
          balance INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS balance_transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          user_id TEXT NOT NULL,
          amount INTEGER NOT NULL,
          before_balance INTEGER NOT NULL,
          after_balance INTEGER NOT NULL,
          reason TEXT NOT NULL,
          reference_type TEXT,
          reference_id TEXT,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS withdraw_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          amount INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'requested',
          note TEXT,
          reviewed_by TEXT,
          paid_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          reviewed_at TEXT,
          paid_at TEXT
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          actor_id TEXT,
          target_id TEXT,
          before_value TEXT,
          after_value TEXT,
          reason TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS setup_messages (
          channel_id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL,
          panel_type TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS csv_imports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_by TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'preview',
          summary TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          applied_at TEXT
        );
      `);
    }
  },
  {
    version: 2,
    name: 'event_warning_role',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(events)').all().map((column) => column.name);
      if (!columns.includes('warning_role_id')) {
        db.exec('ALTER TABLE events ADD COLUMN warning_role_id TEXT');
      }
      if (!columns.includes('warning_sent')) {
        db.exec('ALTER TABLE events ADD COLUMN warning_sent INTEGER NOT NULL DEFAULT 0');
      }
    }
  },
  {
    version: 3,
    name: 'event_warning_message',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(events)').all().map((column) => column.name);
      if (!columns.includes('warning_message_id')) {
        db.exec('ALTER TABLE events ADD COLUMN warning_message_id TEXT');
      }
    }
  },
  {
    version: 4,
    name: 'polls',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS polls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          creator_id TEXT NOT NULL,
          question TEXT NOT NULL,
          options_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          channel_id TEXT,
          message_id TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          closed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS poll_votes (
          poll_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          options_json TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (poll_id, user_id),
          FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
        );
      `);
    }
  },
  {
    version: 5,
    name: 'auctions',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS auctions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_name TEXT NOT NULL,
          item_details TEXT,
          image_url TEXT,
          pickup_info TEXT,
          starting_bid INTEGER NOT NULL DEFAULT 0,
          min_increment INTEGER NOT NULL DEFAULT 0,
          current_bid INTEGER NOT NULL DEFAULT 0,
          current_winner_id TEXT,
          ends_at TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          channel_id TEXT,
          message_id TEXT,
          created_by TEXT NOT NULL,
          closed_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          closed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS auction_bids (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          auction_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          amount INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE
        );
      `);
    }
  },
  {
    version: 6,
    name: 'auction_pickup_info',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(auctions)').all().map((column) => column.name);
      if (!columns.includes('pickup_info')) {
        db.exec('ALTER TABLE auctions ADD COLUMN pickup_info TEXT');
      }
    }
  },
  {
    version: 7,
    name: 'auction_ends_at',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(auctions)').all().map((column) => column.name);
      if (!columns.includes('ends_at')) {
        db.exec('ALTER TABLE auctions ADD COLUMN ends_at TEXT');
      }
      db.exec("UPDATE auctions SET ends_at = datetime(created_at, '+24 hours') WHERE ends_at IS NULL");
    }
  },
  {
    version: 8,
    name: 'voice_sessions',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS voice_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          discord_id TEXT NOT NULL,
          discord_name TEXT,
          channel_id TEXT NOT NULL,
          channel_name TEXT,
          category_id TEXT,
          category_name TEXT,
          joined_at TEXT NOT NULL,
          left_at TEXT,
          seconds INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_voice_sessions_discord_id_joined_at
          ON voice_sessions (discord_id, joined_at);

        CREATE INDEX IF NOT EXISTS idx_voice_sessions_channel_id_joined_at
          ON voice_sessions (channel_id, joined_at);
      `);
    }
  },
  {
    version: 9,
    name: 'event_review_channels',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(event_reviews)').all().map((column) => column.name);
      if (!columns.includes('evidence_notes')) {
        db.exec('ALTER TABLE event_reviews ADD COLUMN evidence_notes TEXT');
      }
      if (!columns.includes('review_channel_id')) {
        db.exec('ALTER TABLE event_reviews ADD COLUMN review_channel_id TEXT');
      }
      if (!columns.includes('dps_message_id')) {
        db.exec('ALTER TABLE event_reviews ADD COLUMN dps_message_id TEXT');
      }
      if (!columns.includes('review_channel_delete_after')) {
        db.exec('ALTER TABLE event_reviews ADD COLUMN review_channel_delete_after TEXT');
      }
    }
  },
  {
    version: 10,
    name: 'guild_verification_csv',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS guild_verifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          created_by TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'reported',
          source_names_json TEXT NOT NULL,
          matches_json TEXT NOT NULL,
          missing_json TEXT NOT NULL,
          issues_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          applied_at TEXT
        );

        CREATE TABLE IF NOT EXISTS guild_verification_pending_replies (
          discord_id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          verification_id INTEGER NOT NULL,
          source_names_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          answered_at TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          FOREIGN KEY (verification_id) REFERENCES guild_verifications(id)
        );
      `);
    }
  },
  {
    version: 11,
    name: 'notag_pet_fruits',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pet_members (
          discord_id TEXT PRIMARY KEY,
          base_display_name TEXT,
          total_fruits INTEGER NOT NULL DEFAULT 0,
          total_points_earned INTEGER NOT NULL DEFAULT 0,
          current_points INTEGER NOT NULL DEFAULT 0,
          star_count INTEGER NOT NULL DEFAULT 0,
          first_fruit_at TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS pet_feed_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER,
          discord_id TEXT NOT NULL,
          fruit_type TEXT NOT NULL,
          points INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS pet_event_rewards (
          event_id INTEGER PRIMARY KEY,
          rewarded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS pet_daily_raffles (
          raffle_date TEXT PRIMARY KEY,
          winner_id TEXT,
          chest_number INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    version: 12,
    name: 'raid_avalon_registrations',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS raid_avalon_registrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nick TEXT NOT NULL UNIQUE,
          horarios_json TEXT NOT NULL,
          armas_json TEXT NOT NULL,
          builds_json TEXT NOT NULL,
          casa_ho_loch INTEGER NOT NULL DEFAULT 0,
          portal_martlock INTEGER NOT NULL DEFAULT 0,
          warnings_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS raid_avalon_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    version: 13,
    name: 'server_usage_analytics',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS server_usage_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          event_name TEXT NOT NULL,
          detail TEXT,
          user_id TEXT,
          channel_id TEXT,
          channel_name TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_server_usage_events_created_at
          ON server_usage_events (created_at);

        CREATE INDEX IF NOT EXISTS idx_server_usage_events_type_name
          ON server_usage_events (event_type, event_name);
      `);
    }
  },
  {
    version: 14,
    name: 'member_snapshots',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS member_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_by TEXT NOT NULL,
          source_name TEXT,
          member_count INTEGER NOT NULL DEFAULT 0,
          online_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS member_snapshot_rows (
          snapshot_id INTEGER NOT NULL,
          member_key TEXT NOT NULL,
          character_name TEXT NOT NULL,
          last_seen TEXT,
          roles_json TEXT NOT NULL DEFAULT '[]',
          is_online INTEGER NOT NULL DEFAULT 0,
          last_seen_iso TEXT,
          PRIMARY KEY (snapshot_id, member_key),
          FOREIGN KEY (snapshot_id) REFERENCES member_snapshots(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_member_snapshots_created_at
          ON member_snapshots (created_at);
      `);
    }
  },
  {
    version: 15,
    name: 'event_templates',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS event_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          creator_id TEXT NOT NULL,
          name TEXT NOT NULL,
          title TEXT NOT NULL,
          location TEXT,
          requirements TEXT,
          composition TEXT,
          tank_slots INTEGER NOT NULL DEFAULT 0,
          healer_slots INTEGER NOT NULL DEFAULT 0,
          support_slots INTEGER NOT NULL DEFAULT 0,
          dps_slots INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(creator_id, name)
        );
      `);
    }
  },
  {
    version: 16,
    name: 'balance_csv_backups',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS balance_csv_backups (
          backup_key TEXT PRIMARY KEY,
          trigger_type TEXT NOT NULL,
          reference_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          message_id TEXT,
          channel_id TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          sent_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_balance_csv_backups_sent_at
          ON balance_csv_backups (sent_at);
      `);
    }
  },
  {
    version: 17,
    name: 'raid_avalon_full_events',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS raid_avalon_events (
          event_id INTEGER PRIMARY KEY,
          dungeon_tier TEXT,
          build_tier TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS raid_avalon_event_participants (
          event_id INTEGER NOT NULL,
          discord_id TEXT NOT NULL,
          weapon_key TEXT,
          weapon_name TEXT,
          item_power INTEGER,
          helper_role TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (event_id, discord_id),
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS raid_avalon_weapon_career (
          discord_id TEXT NOT NULL,
          weapon_key TEXT NOT NULL,
          weapon_name TEXT NOT NULL,
          points INTEGER NOT NULL DEFAULT 0,
          role_id TEXT,
          first_tag_at TEXT,
          last_point_at TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (discord_id, weapon_key)
        );
      `);
    }
  },
  {
    version: 18,
    name: 'daily_black_poll_and_event_reminders',
    up(db) {
      const pollColumns = db.prepare('PRAGMA table_info(polls)').all().map((column) => column.name);
      if (!pollColumns.includes('poll_key')) {
        db.exec('ALTER TABLE polls ADD COLUMN poll_key TEXT');
      }
      if (!pollColumns.includes('staff_alerted_at')) {
        db.exec('ALTER TABLE polls ADD COLUMN staff_alerted_at TEXT');
      }
      if (!pollColumns.includes('auto_event_id')) {
        db.exec('ALTER TABLE polls ADD COLUMN auto_event_id INTEGER');
      }
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_polls_poll_key ON polls (poll_key)');

      const eventColumns = db.prepare('PRAGMA table_info(events)').all().map((column) => column.name);
      if (!eventColumns.includes('reminder_10_sent')) {
        db.exec('ALTER TABLE events ADD COLUMN reminder_10_sent INTEGER NOT NULL DEFAULT 0');
      }
      if (!eventColumns.includes('reminder_start_sent')) {
        db.exec('ALTER TABLE events ADD COLUMN reminder_start_sent INTEGER NOT NULL DEFAULT 0');
      }
      if (!eventColumns.includes('temp_role_delete_after')) {
        db.exec('ALTER TABLE events ADD COLUMN temp_role_delete_after TEXT');
      }
      if (!eventColumns.includes('auto_started')) {
        db.exec('ALTER TABLE events ADD COLUMN auto_started INTEGER NOT NULL DEFAULT 0');
      }
    }
  },
  {
    version: 19,
    name: 'operation_reminders',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS operation_reminders (
          reminder_key TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          message_id TEXT,
          channel_id TEXT,
          sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    version: 20,
    name: 'persistent_bot_messages',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS persistent_bot_messages (
          message_key TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    version: 21,
    name: 'career_point_transactions',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS career_point_transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER NOT NULL,
          discord_id TEXT NOT NULL,
          point_type TEXT NOT NULL,
          role TEXT,
          weapon_key TEXT NOT NULL,
          weapon_name TEXT NOT NULL,
          seconds INTEGER NOT NULL DEFAULT 0,
          points INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT 'event_approval',
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(event_id, discord_id, point_type, weapon_key),
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_career_point_transactions_event
          ON career_point_transactions (event_id);

        CREATE INDEX IF NOT EXISTS idx_career_point_transactions_member
          ON career_point_transactions (discord_id);
      `);
    }
  },
  {
    version: 22,
    name: 'albion_weekly_imports',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS albion_imports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          import_type TEXT NOT NULL,
          week_key TEXT NOT NULL,
          source_name TEXT,
          rows_count INTEGER NOT NULL DEFAULT 0,
          summary_json TEXT,
          imported_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(import_type, week_key)
        );

        CREATE TABLE IF NOT EXISTS albion_pve_rankings (
          import_id INTEGER NOT NULL,
          week_key TEXT NOT NULL,
          rank INTEGER NOT NULL,
          albion_name TEXT NOT NULL,
          guild_role TEXT,
          amount INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (import_id, albion_name),
          FOREIGN KEY (import_id) REFERENCES albion_imports(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_albion_pve_rankings_week
          ON albion_pve_rankings (week_key, rank);

        CREATE TABLE IF NOT EXISTS albion_guild_logs (
          import_id INTEGER NOT NULL,
          week_key TEXT NOT NULL,
          event_date TEXT NOT NULL,
          actor_name TEXT NOT NULL,
          action_type TEXT NOT NULL,
          raw_reason TEXT NOT NULL,
          target_hint TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (import_id, event_date, actor_name, raw_reason),
          FOREIGN KEY (import_id) REFERENCES albion_imports(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_albion_guild_logs_week
          ON albion_guild_logs (week_key, action_type);
      `);
    }
  },
  {
    version: 23,
    name: 'event_message_channel',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(events)').all().map((column) => column.name);
      if (!columns.includes('message_channel_id')) {
        db.exec('ALTER TABLE events ADD COLUMN message_channel_id TEXT');
      }
    }
  },
  {
    version: 24,
    name: 'campaign_900m',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS campaigns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT UNIQUE NOT NULL,
          title TEXT NOT NULL,
          goal_amount INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          role_name TEXT NOT NULL DEFAULT '900m',
          progress_channel_id TEXT,
          progress_message_id TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          closed_at TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS campaign_event_payouts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER NOT NULL,
          event_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          amount INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          decision TEXT,
          dm_message_id TEXT,
          expires_at TEXT NOT NULL,
          created_by TEXT NOT NULL,
          processed_by TEXT,
          decided_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(campaign_id, event_id, user_id),
          FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS campaign_contributions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          amount INTEGER NOT NULL,
          source_type TEXT NOT NULL,
          source_id TEXT,
          status TEXT NOT NULL DEFAULT 'approved',
          created_by TEXT NOT NULL,
          approved_by TEXT,
          note TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_campaign_event_payouts_pending
          ON campaign_event_payouts (status, expires_at);

        CREATE INDEX IF NOT EXISTS idx_campaign_contributions_campaign
          ON campaign_contributions (campaign_id, created_at);

        INSERT OR IGNORE INTO campaigns
          (code, title, goal_amount, status, role_name, progress_channel_id, created_by)
        VALUES
          ('900m', 'Meta 900m NOTAG', 900000000, 'open', '900m', '1484312044772655154', 'system');
      `);
    }
  },
  {
    version: 25,
    name: 'payment_requests',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS payment_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          amount INTEGER NOT NULL,
          service TEXT NOT NULL,
          description TEXT NOT NULL,
          evidence TEXT,
          status TEXT NOT NULL DEFAULT 'requested',
          reviewed_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          reviewed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_payment_requests_status
          ON payment_requests (status, created_at);
      `);
    }
  },
  {
    version: 26,
    name: 'albion_stats_ocr_submissions',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS albion_stats_ocr_submissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          submitted_by TEXT NOT NULL,
          target_discord_id TEXT NOT NULL,
          channel_id TEXT,
          message_id TEXT,
          image_url TEXT NOT NULL,
          character_name TEXT,
          guild_name TEXT,
          total_fame TEXT,
          is_notag_member INTEGER,
          ocr_text TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          applied_role TEXT,
          reviewed_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          reviewed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_albion_stats_ocr_submissions_status
          ON albion_stats_ocr_submissions (status, created_at);

        CREATE INDEX IF NOT EXISTS idx_albion_stats_ocr_submissions_target
          ON albion_stats_ocr_submissions (target_discord_id, created_at);
      `);
    }
  },
  {
    version: 27,
    name: 'guild_member_events',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS guild_member_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          discord_id TEXT NOT NULL,
          discord_name TEXT,
          display_name TEXT,
          albion_name TEXT,
          registration_status TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_guild_member_events_type_created_at
          ON guild_member_events (event_type, created_at);

        CREATE INDEX IF NOT EXISTS idx_guild_member_events_discord_id_created_at
          ON guild_member_events (discord_id, created_at);
      `);
    }
  },
  {
    version: 28,
    name: 'albion_fame_totals',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS albion_fame_imports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_name TEXT,
          rows_count INTEGER NOT NULL DEFAULT 0,
          summary_json TEXT,
          imported_by TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS albion_fame_totals (
          albion_key TEXT PRIMARY KEY,
          albion_name TEXT NOT NULL,
          total_fame INTEGER NOT NULL DEFAULT 0,
          pve_fame INTEGER NOT NULL DEFAULT 0,
          pvp_fame INTEGER NOT NULL DEFAULT 0,
          gathering_fame INTEGER NOT NULL DEFAULT 0,
          crafting_fame INTEGER NOT NULL DEFAULT 0,
          import_id INTEGER,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (import_id) REFERENCES albion_fame_imports(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_albion_fame_totals_pve
          ON albion_fame_totals (pve_fame DESC);

        CREATE INDEX IF NOT EXISTS idx_albion_fame_totals_pvp
          ON albion_fame_totals (pvp_fame DESC);

        CREATE INDEX IF NOT EXISTS idx_albion_fame_totals_gathering
          ON albion_fame_totals (gathering_fame DESC);

        CREATE INDEX IF NOT EXISTS idx_albion_fame_totals_crafting
          ON albion_fame_totals (crafting_fame DESC);
      `);
    }
  },
  {
    version: 29,
    name: 'linked_discord_accounts',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS linked_discord_accounts (
          linked_discord_id TEXT PRIMARY KEY,
          primary_discord_id TEXT NOT NULL,
          label TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_linked_discord_accounts_primary
          ON linked_discord_accounts (primary_discord_id);
      `);

      const linkStmt = db.prepare(`
        INSERT INTO linked_discord_accounts (linked_discord_id, primary_discord_id, label)
        VALUES (@linkedDiscordId, @primaryDiscordId, @label)
        ON CONFLICT(linked_discord_id) DO UPDATE SET
          primary_discord_id = excluded.primary_discord_id,
          label = excluded.label,
          updated_at = CURRENT_TIMESTAMP
      `);

      for (const link of defaultAccountLinks) {
        linkStmt.run(link);
      }

      for (const link of defaultAccountLinks.filter((item) => item.linkedDiscordId !== item.primaryDiscordId)) {
        const secondaryBalance = db.prepare('SELECT balance FROM balances WHERE discord_id = ?').get(link.linkedDiscordId);
        if (secondaryBalance) {
          db.prepare(`
            INSERT INTO balances (discord_id, balance, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(discord_id) DO UPDATE SET
              balance = balance + excluded.balance,
              updated_at = CURRENT_TIMESTAMP
          `).run(link.primaryDiscordId, Number(secondaryBalance.balance || 0));
          db.prepare('DELETE FROM balances WHERE discord_id = ?').run(link.linkedDiscordId);
        }

        db.prepare('UPDATE balance_transactions SET user_id = ? WHERE user_id = ?').run(link.primaryDiscordId, link.linkedDiscordId);
        db.prepare('UPDATE withdraw_requests SET user_id = ? WHERE user_id = ?').run(link.primaryDiscordId, link.linkedDiscordId);
        db.prepare('UPDATE payment_requests SET user_id = ? WHERE user_id = ?').run(link.primaryDiscordId, link.linkedDiscordId);
        mergeCampaignEventPayouts(db, link.primaryDiscordId, link.linkedDiscordId);
        db.prepare('UPDATE campaign_event_payouts SET user_id = ? WHERE user_id = ?').run(link.primaryDiscordId, link.linkedDiscordId);
        db.prepare('UPDATE campaign_contributions SET user_id = ? WHERE user_id = ?').run(link.primaryDiscordId, link.linkedDiscordId);
      }
    }
  },
  {
    version: 30,
    name: 'member_role_notice_queue',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS member_role_notice_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          verification_id INTEGER,
          discord_id TEXT NOT NULL,
          reason TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          message_id TEXT,
          thread_id TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          sent_at TEXT,
          archive_at TEXT,
          archived_at TEXT,
          UNIQUE(verification_id, discord_id, reason)
        );

        CREATE INDEX IF NOT EXISTS idx_member_role_notice_queue_status
          ON member_role_notice_queue (status, id);

        CREATE INDEX IF NOT EXISTS idx_member_role_notice_queue_archive
          ON member_role_notice_queue (archived_at, archive_at);
      `);
    }
  },
  {
    version: 31,
    name: 'weekly_voice_core_awards',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS weekly_voice_core_awards (
          week_start TEXT PRIMARY KEY,
          week_end TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          message_id TEXT,
          qualified_count INTEGER NOT NULL DEFAULT 0,
          awarded_count INTEGER NOT NULL DEFAULT 0,
          qualified_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    version: 32,
    name: 'albion_fame_daily_snapshots',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS albion_fame_daily_snapshots (
          snapshot_date TEXT NOT NULL,
          albion_key TEXT NOT NULL,
          albion_name TEXT NOT NULL,
          pve_fame INTEGER NOT NULL DEFAULT 0,
          pvp_fame INTEGER NOT NULL DEFAULT 0,
          crafting_fame INTEGER NOT NULL DEFAULT 0,
          gathering_fame INTEGER NOT NULL DEFAULT 0,
          total_fame INTEGER NOT NULL DEFAULT 0,
          captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (snapshot_date, albion_key)
        );

        CREATE INDEX IF NOT EXISTS idx_albion_fame_snapshots_player
          ON albion_fame_daily_snapshots (albion_key, snapshot_date);
      `);
    }
  },
  {
    version: 33,
    name: 'albion_killfeed_events',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS albion_killfeed_events (
          event_id INTEGER PRIMARY KEY,
          event_type TEXT NOT NULL,
          event_at TEXT,
          discord_message_id TEXT,
          posted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_albion_killfeed_posted_at
          ON albion_killfeed_events (posted_at);
      `);
    }
  },
  {
    version: 34,
    name: 'albion_vengeance_rewards',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS albion_vengeance_deaths (
          original_event_id INTEGER PRIMARY KEY,
          victim_discord_id TEXT NOT NULL,
          victim_albion_name TEXT NOT NULL,
          enemy_player_id TEXT NOT NULL,
          enemy_player_name TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          avenged_event_id INTEGER,
          avenger_discord_id TEXT,
          avenged_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_vengeance_pending_enemy
          ON albion_vengeance_deaths (enemy_player_id, avenged_event_id, occurred_at);

        CREATE TABLE IF NOT EXISTS albion_vengeance_rewards (
          vengeance_event_id INTEGER PRIMARY KEY,
          avenger_discord_id TEXT NOT NULL,
          amount INTEGER NOT NULL,
          original_events_json TEXT NOT NULL,
          rewarded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_vengeance_rewards_user_date
          ON albion_vengeance_rewards (avenger_discord_id, rewarded_at);
      `);
    }
  },
  {
    version: 35,
    name: 'silent_idle_game',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS idle_game_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          voice_channel_id TEXT NOT NULL,
          voice_channel_name TEXT,
          host_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          discord_message_id TEXT,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_idle_sessions_status ON idle_game_sessions(status, started_at);

        CREATE TABLE IF NOT EXISTS idle_game_players (
          discord_id TEXT PRIMARY KEY,
          discord_name TEXT,
          total_points REAL NOT NULL DEFAULT 0,
          total_focus_seconds INTEGER NOT NULL DEFAULT 0,
          total_speeches INTEGER NOT NULL DEFAULT 0,
          sessions_joined INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS idle_game_participation (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL,
          discord_id TEXT NOT NULL,
          discord_name TEXT,
          points REAL NOT NULL DEFAULT 0,
          focus_seconds INTEGER NOT NULL DEFAULT 0,
          speech_count INTEGER NOT NULL DEFAULT 0,
          penalty_until TEXT,
          joined_at TEXT NOT NULL,
          left_at TEXT,
          event_bonus INTEGER NOT NULL DEFAULT 0,
          UNIQUE(session_id, discord_id),
          FOREIGN KEY(session_id) REFERENCES idle_game_sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_idle_participation_session ON idle_game_participation(session_id, points DESC);

        CREATE TABLE IF NOT EXISTS idle_game_speech_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL,
          discord_id TEXT NOT NULL,
          penalty_seconds INTEGER NOT NULL,
          occurred_at TEXT NOT NULL,
          FOREIGN KEY(session_id) REFERENCES idle_game_sessions(id) ON DELETE CASCADE
        );
      `);
    }
  },
  {
    version: 36,
    name: 'idle_discord_dashboard',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(idle_game_sessions)').all().map((column) => column.name);
      if (!columns.includes('topic_message_id')) {
        db.exec('ALTER TABLE idle_game_sessions ADD COLUMN topic_message_id TEXT');
      }
    }
  },
  {
    version: 37,
    name: 'albion_killfeed_cursor',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS albion_killfeed_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    version: 38,
    name: 'world_boss_events',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS world_boss_events (
          event_id INTEGER PRIMARY KEY,
          massing TEXT NOT NULL DEFAULT 'Frostspring Volcano Smuggler',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS world_boss_assignments (
          event_id INTEGER NOT NULL,
          slot_key TEXT NOT NULL,
          discord_id TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (event_id, slot_key),
          UNIQUE (event_id, discord_id),
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );
      `);
    }
  },
  {
    version: 39,
    name: 'guild_reverification_campaign',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS guild_reverification_campaigns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          announcement_channel_id TEXT NOT NULL,
          verified_role_id TEXT NOT NULL,
          voice_channel_ids_json TEXT NOT NULL,
          starts_at TEXT NOT NULL,
          deadline_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_by TEXT NOT NULL,
          last_reminder_date TEXT,
          final_posted_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS guild_reverification_members (
          campaign_id INTEGER NOT NULL,
          albion_name TEXT NOT NULL,
          normalized_name TEXT NOT NULL,
          discord_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          qualification_seconds INTEGER NOT NULL DEFAULT 0,
          verified_by TEXT,
          verified_at TEXT,
          PRIMARY KEY (campaign_id, normalized_name),
          FOREIGN KEY (campaign_id) REFERENCES guild_reverification_campaigns(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_guild_reverification_members_status
          ON guild_reverification_members (campaign_id, status);
      `);
    }
  },
  {
    version: 40,
    name: 'world_boss_multiple_assignments',
    up(db) {
      db.exec(`
        CREATE TABLE world_boss_assignments_v2 (
          event_id INTEGER NOT NULL,
          slot_key TEXT NOT NULL,
          discord_id TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (event_id, slot_key),
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        INSERT INTO world_boss_assignments_v2 (event_id, slot_key, discord_id, created_at)
        SELECT event_id, slot_key, discord_id, created_at
        FROM world_boss_assignments;

        UPDATE world_boss_assignments_v2 SET slot_key = 'lightcaller' WHERE slot_key = 'bastion';
        UPDATE world_boss_assignments_v2 SET slot_key = 'mistpiercer_3' WHERE slot_key = 'mist_or_lizard';

        DROP TABLE world_boss_assignments;
        ALTER TABLE world_boss_assignments_v2 RENAME TO world_boss_assignments;

        CREATE INDEX idx_world_boss_assignments_member
          ON world_boss_assignments (event_id, discord_id);
      `);
    }
  },
  {
    version: 41,
    name: 'loch_market_announcement_feedback',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS loch_announcement_feedback (
          user_id TEXT NOT NULL,
          feedback_type TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, feedback_type),
          CHECK (feedback_type IN ('liked', 'read'))
        );

        CREATE TABLE IF NOT EXISTS loch_market_suggestions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          author_id TEXT NOT NULL,
          suggestion TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          staff_channel_id TEXT,
          staff_message_id TEXT,
          answered_by TEXT,
          answer TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          answered_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_loch_market_suggestions_status
          ON loch_market_suggestions (status, created_at);
      `);
    }
  },
  {
    version: 42,
    name: 'announcement_acknowledgements',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS announcement_acknowledgements (
          announcement_key TEXT NOT NULL,
          user_id TEXT NOT NULL,
          acknowledged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (announcement_key, user_id)
        );

        CREATE INDEX IF NOT EXISTS idx_announcement_acknowledgements_key
          ON announcement_acknowledgements (announcement_key, acknowledged_at);
      `);
    }
  },
  {
    version: 43,
    name: 'member_giveaways',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS giveaways (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          creator_id TEXT NOT NULL,
          payer_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          prize_name TEXT NOT NULL,
          estimated_value INTEGER,
          starts_at TEXT NOT NULL,
          ends_at TEXT NOT NULL,
          winner_count INTEGER NOT NULL,
          notes TEXT,
          status TEXT NOT NULL DEFAULT 'pending_payer',
          requires_staff_approval INTEGER NOT NULL DEFAULT 0,
          payer_approved_at TEXT,
          staff_approved_at TEXT,
          staff_approved_by TEXT,
          channel_id TEXT,
          message_id TEXT,
          cancel_reason TEXT,
          cancelled_by TEXT,
          ended_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS giveaway_participants (
          giveaway_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (giveaway_id, user_id),
          FOREIGN KEY (giveaway_id) REFERENCES giveaways(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS giveaway_winners (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          giveaway_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'selected',
          drawn_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          invalidated_by TEXT,
          invalidated_at TEXT,
          invalid_reason TEXT,
          FOREIGN KEY (giveaway_id) REFERENCES giveaways(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_giveaways_status_time ON giveaways (status, starts_at, ends_at);
        CREATE INDEX IF NOT EXISTS idx_giveaways_creator_active ON giveaways (creator_id, status, created_at);
        CREATE INDEX IF NOT EXISTS idx_giveaway_winners_giveaway ON giveaway_winners (giveaway_id, status);
      `);
    }
  },
  {
    version: 44,
    name: 'announcement_participations',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS announcement_participations (
          announcement_key TEXT NOT NULL,
          user_id TEXT NOT NULL,
          participating_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (announcement_key, user_id)
        );

        CREATE INDEX IF NOT EXISTS idx_announcement_participations_key
          ON announcement_participations (announcement_key, participating_at);
      `);
    }
  },
  {
    version: 45,
    name: 'hideout_fighters_imply_acknowledgement',
    up(db) {
      db.exec(`
        DELETE FROM announcement_acknowledgements
        WHERE announcement_key = 'hideout-defense:sunstrand-shoal:2026-07-22'
          AND EXISTS (
          SELECT 1
          FROM announcement_participations
          WHERE announcement_participations.announcement_key = announcement_acknowledgements.announcement_key
            AND announcement_participations.user_id = announcement_acknowledgements.user_id
        );
      `);
    }
  },
  {
    version: 46,
    name: 'hideout_defense_runtime_state',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS hideout_defense_state (
          announcement_key TEXT PRIMARY KEY,
          role_id TEXT,
          voice_channel_id TEXT,
          reminder_sent_at TEXT,
          admin_prompt_sent_at TEXT,
          started_at TEXT,
          cleaned_at TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }
  },
  {
    version: 47,
    name: 'hideout_defense_rewards',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(hideout_defense_state)').all().map((column) => column.name);
      if (!columns.includes('rewards_processed_at')) {
        db.exec('ALTER TABLE hideout_defense_state ADD COLUMN rewards_processed_at TEXT');
      }
      if (!columns.includes('congratulations_sent_at')) {
        db.exec('ALTER TABLE hideout_defense_state ADD COLUMN congratulations_sent_at TEXT');
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS hideout_defense_rewards (
          announcement_key TEXT NOT NULL,
          user_id TEXT NOT NULL,
          amount INTEGER NOT NULL,
          before_balance INTEGER NOT NULL,
          after_balance INTEGER NOT NULL,
          rewarded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          notification_sent_at TEXT,
          PRIMARY KEY (announcement_key, user_id)
        );
      `);
    }
  },
  {
    version: 48,
    name: 'custom_events',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS custom_events (
          event_id INTEGER PRIMARY KEY,
          event_day TEXT NOT NULL,
          time_range TEXT NOT NULL,
          loot_rules TEXT,
          consumables TEXT,
          mount_requirement TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS custom_event_slots (
          event_id INTEGER NOT NULL,
          role TEXT NOT NULL,
          slot_index INTEGER NOT NULL,
          slot_label TEXT,
          PRIMARY KEY (event_id, role, slot_index),
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_custom_event_slots_event_role
          ON custom_event_slots (event_id, role, slot_index);
      `);
    }
  },
  {
    version: 49,
    name: 'retire_sunstrand_hideout_defense',
    up(db) {
      db.prepare('DELETE FROM operation_reminders WHERE reminder_key = ?')
        .run('hideout-defense:sunstrand-shoal:2026-07-22');
    }
  },
  {
    version: 50,
    name: 'custom_event_participant_slots',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(event_participants)').all().map((column) => column.name);
      if (!columns.includes('custom_slot_index')) {
        db.exec('ALTER TABLE event_participants ADD COLUMN custom_slot_index INTEGER');
      }
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_event_participants_custom_slot
          ON event_participants (event_id, role, custom_slot_index)
          WHERE custom_slot_index IS NOT NULL AND is_spectator = 0;
      `);
    }
  },
  {
    version: 51,
    name: 'albion_fame_category_imports',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS albion_fame_category_imports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          source_name TEXT,
          rows_count INTEGER NOT NULL DEFAULT 0,
          linked_count INTEGER NOT NULL DEFAULT 0,
          unmatched_count INTEGER NOT NULL DEFAULT 0,
          missing_count INTEGER NOT NULL DEFAULT 0,
          reductions_count INTEGER NOT NULL DEFAULT 0,
          imported_by TEXT,
          summary_json TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          undone_at TEXT,
          undone_by TEXT,
          CHECK (category IN ('pve', 'pvp', 'gathering', 'crafting'))
        );

        CREATE TABLE IF NOT EXISTS albion_fame_category_rows (
          import_id INTEGER NOT NULL,
          albion_key TEXT NOT NULL,
          albion_name TEXT NOT NULL,
          guild_role TEXT,
          source_rank INTEGER,
          amount INTEGER NOT NULL DEFAULT 0,
          previous_amount INTEGER NOT NULL DEFAULT 0,
          discord_id TEXT,
          PRIMARY KEY (import_id, albion_key),
          FOREIGN KEY (import_id) REFERENCES albion_fame_category_imports(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_albion_category_imports_active
          ON albion_fame_category_imports (category, undone_at, id DESC);

        CREATE INDEX IF NOT EXISTS idx_albion_category_rows_player
          ON albion_fame_category_rows (albion_key, import_id DESC);
      `);
    }
  },
  {
    version: 52,
    name: 'withdraw_request_portal_management',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(withdraw_requests)').all().map((column) => column.name);
      if (!columns.includes('staff_channel_id')) db.exec('ALTER TABLE withdraw_requests ADD COLUMN staff_channel_id TEXT');
      if (!columns.includes('staff_message_id')) db.exec('ALTER TABLE withdraw_requests ADD COLUMN staff_message_id TEXT');
      if (!columns.includes('cancelled_by')) db.exec('ALTER TABLE withdraw_requests ADD COLUMN cancelled_by TEXT');
      if (!columns.includes('cancelled_at')) db.exec('ALTER TABLE withdraw_requests ADD COLUMN cancelled_at TEXT');
      if (!columns.includes('updated_at')) db.exec('ALTER TABLE withdraw_requests ADD COLUMN updated_at TEXT');
      db.exec(`
        UPDATE withdraw_requests
        SET updated_at = COALESCE(updated_at, created_at)
        WHERE updated_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_withdraw_requests_status_created
          ON withdraw_requests (status, created_at DESC);
      `);
    }
  },
  {
    version: 53,
    name: 'event_web_management',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(events)').all().map((column) => column.name);
      if (!columns.includes('audience')) db.exec("ALTER TABLE events ADD COLUMN audience TEXT NOT NULL DEFAULT 'public'");
      if (!columns.includes('finalized_by')) db.exec('ALTER TABLE events ADD COLUMN finalized_by TEXT');
      if (!columns.includes('cancelled_by')) db.exec('ALTER TABLE events ADD COLUMN cancelled_by TEXT');
      db.exec(`
        UPDATE events
        SET audience = 'public'
        WHERE audience IS NULL OR audience NOT IN ('public', 'member', 'staff');

        CREATE INDEX IF NOT EXISTS idx_events_audience_status
          ON events (audience, status, id DESC);
      `);
    }
  },
  {
    version: 54,
    name: 'registration_staff_alerts',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS registration_staff_alerts (
          discord_id TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          resolved_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_registration_alerts_open
          ON registration_staff_alerts (resolved_at, updated_at DESC);
      `);
    }
  },
  {
    version: 55,
    name: 'guild_roster_link_proposals',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS guild_roster_link_proposals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          snapshot_id INTEGER NOT NULL,
          discord_id TEXT NOT NULL,
          albion_name TEXT NOT NULL,
          matched_name TEXT,
          match_score REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending',
          created_by TEXT,
          message_id TEXT,
          resolved_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(snapshot_id, discord_id, albion_name),
          FOREIGN KEY (snapshot_id) REFERENCES member_snapshots(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_roster_link_proposals_pending
          ON guild_roster_link_proposals (status, snapshot_id DESC, id DESC);

        CREATE INDEX IF NOT EXISTS idx_roster_link_proposals_discord
          ON guild_roster_link_proposals (discord_id, status, id DESC);
      `);
    }
  },
  {
    version: 56,
    name: 'event_workflow_message_tracking',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(event_reviews)').all().map((column) => column.name);
      if (!columns.includes('review_message_id')) {
        db.exec('ALTER TABLE event_reviews ADD COLUMN review_message_id TEXT');
      }
      if (!columns.includes('finance_message_id')) {
        db.exec('ALTER TABLE event_reviews ADD COLUMN finance_message_id TEXT');
      }
    }
  },
  {
    version: 57,
    name: 'albion_battle_reports',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS albion_battles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          status TEXT NOT NULL DEFAULT 'active',
          started_at TEXT NOT NULL,
          last_event_at TEXT NOT NULL,
          closed_at TEXT,
          report_channel_id TEXT,
          report_message_id TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (status IN ('active', 'reported', 'discarded'))
        );

        CREATE TABLE IF NOT EXISTS albion_battle_events (
          event_id INTEGER PRIMARY KEY,
          battle_id INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          event_at TEXT NOT NULL,
          victim_name TEXT NOT NULL,
          victim_guild TEXT,
          victim_build_value INTEGER NOT NULL DEFAULT 0,
          priced_items INTEGER NOT NULL DEFAULT 0,
          total_items INTEGER NOT NULL DEFAULT 0,
          notag_members_json TEXT NOT NULL DEFAULT '[]',
          player_keys_json TEXT NOT NULL DEFAULT '[]',
          enemy_guilds_json TEXT NOT NULL DEFAULT '[]',
          enemy_alliances_json TEXT NOT NULL DEFAULT '[]',
          raw_event_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (battle_id) REFERENCES albion_battles(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS albion_battle_backfill (
          event_id INTEGER PRIMARY KEY,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          retry_after TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_albion_battles_active
          ON albion_battles (status, last_event_at DESC);
        CREATE INDEX IF NOT EXISTS idx_albion_battle_events_battle
          ON albion_battle_events (battle_id, event_at, event_id);
      `);
    }
  },
  {
    version: 58,
    name: 'event_participant_pause_state',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(event_participants)').all().map((column) => column.name);
      if (!columns.includes('is_paused')) {
        db.exec('ALTER TABLE event_participants ADD COLUMN is_paused INTEGER NOT NULL DEFAULT 0');
      }
    }
  },
  {
    version: 59,
    name: 'albion_battle_report_details_button',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(albion_battles)').all().map((column) => column.name);
      if (!columns.includes('details_button_synced_at')) {
        db.exec('ALTER TABLE albion_battles ADD COLUMN details_button_synced_at TEXT');
      }
    }
  },
  {
    version: 60,
    name: 'guild_service_missions',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS guild_service_missions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          source_message_id TEXT NOT NULL UNIQUE,
          message_id TEXT UNIQUE,
          creator_id TEXT NOT NULL,
          title TEXT NOT NULL,
          objective TEXT NOT NULL,
          description TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'available',
          assignee_id TEXT,
          claimed_at TEXT,
          reminder_due_at TEXT,
          reminder_claimed_at TEXT,
          reminded_at TEXT,
          completed_at TEXT,
          cancelled_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (status IN ('available', 'claimed', 'completed', 'cancelled'))
        );

        CREATE INDEX IF NOT EXISTS idx_guild_service_missions_status
          ON guild_service_missions (status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_guild_service_missions_reminders
          ON guild_service_missions (status, reminded_at, reminder_due_at);
      `);
    }
  },
  {
    version: 61,
    name: 'guild_service_mission_image',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(guild_service_missions)').all().map((column) => column.name);
      if (!columns.includes('image_attachment_name')) {
        db.exec('ALTER TABLE guild_service_missions ADD COLUMN image_attachment_name TEXT');
      }
    }
  },
  {
    version: 62,
    name: 'guild_service_mission_threads',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(guild_service_missions)').all().map((column) => column.name);
      if (!columns.includes('thread_id')) {
        db.exec('ALTER TABLE guild_service_missions ADD COLUMN thread_id TEXT');
      }
    }
  },
  {
    version: 63,
    name: 'daily_content_previews',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS daily_content_previews (
          preview_date TEXT PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'open',
          channel_id TEXT,
          message_id TEXT,
          summary_message_id TEXT,
          posted_at TEXT,
          closed_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (status IN ('open', 'closed'))
        );

        CREATE TABLE IF NOT EXISTS daily_content_interests (
          preview_date TEXT NOT NULL,
          time_slot TEXT NOT NULL,
          user_id TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (preview_date, time_slot, user_id),
          FOREIGN KEY (preview_date) REFERENCES daily_content_previews(preview_date) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS daily_content_proposals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          preview_date TEXT NOT NULL,
          time_slot TEXT NOT NULL,
          caller_id TEXT NOT NULL,
          content_name TEXT NOT NULL,
          target_players INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (preview_date, time_slot, caller_id),
          FOREIGN KEY (preview_date) REFERENCES daily_content_previews(preview_date) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_daily_content_interests_preview
          ON daily_content_interests (preview_date, time_slot);
        CREATE INDEX IF NOT EXISTS idx_daily_content_proposals_preview
          ON daily_content_proposals (preview_date, time_slot, id);
      `);
    }
  },
  {
    version: 64,
    name: 'custom_event_build_catalog',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(custom_event_slots)').all().map((column) => column.name);
      if (!columns.includes('build_key')) db.exec('ALTER TABLE custom_event_slots ADD COLUMN build_key TEXT');
      if (!columns.includes('build_url')) db.exec('ALTER TABLE custom_event_slots ADD COLUMN build_url TEXT');
      if (!columns.includes('emoji_name')) db.exec('ALTER TABLE custom_event_slots ADD COLUMN emoji_name TEXT');
      if (!columns.includes('emoji_id')) db.exec('ALTER TABLE custom_event_slots ADD COLUMN emoji_id TEXT');
    }
  },
  {
    version: 65,
    name: 'mass_raffle_official_results',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS mass_raffles (
          raffle_key TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          scheduled_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'scheduled',
          started_by TEXT,
          started_at TEXT,
          completed_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (status IN ('scheduled', 'live', 'completed'))
        );

        CREATE TABLE IF NOT EXISTS mass_raffle_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          raffle_key TEXT NOT NULL,
          prize_id TEXT NOT NULL,
          image_number INTEGER NOT NULL,
          slot_number INTEGER NOT NULL,
          winner_name TEXT NOT NULL,
          drawn_by TEXT NOT NULL,
          drawn_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (raffle_key, prize_id),
          FOREIGN KEY (raffle_key) REFERENCES mass_raffles(raffle_key) ON DELETE RESTRICT
        );

        CREATE TABLE IF NOT EXISTS mass_raffle_notifications (
          raffle_key TEXT NOT NULL,
          notification_key TEXT NOT NULL,
          channel_id TEXT,
          message_id TEXT,
          sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (raffle_key, notification_key),
          FOREIGN KEY (raffle_key) REFERENCES mass_raffles(raffle_key) ON DELETE RESTRICT
        );

        CREATE INDEX IF NOT EXISTS idx_mass_raffle_results_raffle
          ON mass_raffle_results (raffle_key, id);
      `);
    }
  },
  {
    version: 66,
    name: 'mass_raffle_qualified_participants',
    up(db) {
      const raffleColumns = db.prepare('PRAGMA table_info(mass_raffles)').all().map((column) => column.name);
      if (!raffleColumns.includes('participants_refreshed_at')) {
        db.exec('ALTER TABLE mass_raffles ADD COLUMN participants_refreshed_at TEXT');
      }
      if (!raffleColumns.includes('participants_frozen_at')) {
        db.exec('ALTER TABLE mass_raffles ADD COLUMN participants_frozen_at TEXT');
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS mass_raffle_participants (
          raffle_key TEXT NOT NULL,
          discord_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          seconds INTEGER NOT NULL DEFAULT 0,
          event_count INTEGER NOT NULL DEFAULT 0,
          qualified_at TEXT NOT NULL,
          PRIMARY KEY (raffle_key, discord_id),
          FOREIGN KEY (raffle_key) REFERENCES mass_raffles(raffle_key) ON DELETE RESTRICT
        );

        CREATE INDEX IF NOT EXISTS idx_mass_raffle_participants_order
          ON mass_raffle_participants (raffle_key, seconds DESC, event_count DESC, display_name);
      `);
    }
  },
  {
    version: 67,
    name: 'wtb_buy_orders',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS wtb_buy_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          source_message_id TEXT NOT NULL UNIQUE,
          message_id TEXT UNIQUE,
          thread_id TEXT,
          buyer_id TEXT NOT NULL,
          title TEXT NOT NULL,
          items TEXT NOT NULL,
          terms TEXT NOT NULL,
          image_attachment_name TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          closed_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (status IN ('open', 'closed'))
        );

        CREATE TABLE IF NOT EXISTS wtb_offers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id INTEGER NOT NULL,
          seller_id TEXT NOT NULL,
          items TEXT NOT NULL,
          note TEXT,
          status TEXT NOT NULL DEFAULT 'offered',
          confirmed_at TEXT,
          withdrawn_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (status IN ('offered', 'confirmed', 'withdrawn')),
          FOREIGN KEY (order_id) REFERENCES wtb_buy_orders(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_wtb_buy_orders_status
          ON wtb_buy_orders (status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_wtb_offers_order
          ON wtb_offers (order_id, status, id);
      `);
    }
  },
  {
    version: 68,
    name: 'event_notification_preferences_and_dispatches',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS event_notification_preferences (
          discord_id TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 1,
          event_types_json TEXT NOT NULL DEFAULT '["common","cta","raid_full","world_boss"]',
          phases_json TEXT NOT NULL DEFAULT '["15","0"]',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS event_reminder_dispatches (
          event_id INTEGER NOT NULL,
          phase TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          message_id TEXT,
          sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (event_id, phase, channel_id),
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS event_notification_dm_dispatches (
          event_id INTEGER NOT NULL,
          phase TEXT NOT NULL,
          discord_id TEXT NOT NULL,
          sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (event_id, phase, discord_id),
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_event_notification_preferences_enabled
          ON event_notification_preferences (enabled, discord_id);
      `);
    }
  },
  {
    version: 69,
    name: 'albion_guild_killboard',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS albion_guild_encounters (
          event_id INTEGER PRIMARY KEY,
          event_type TEXT NOT NULL,
          event_at TEXT NOT NULL,
          opponent_guild TEXT NOT NULL,
          opponent_guild_key TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (event_type IN ('kill', 'death'))
        );

        CREATE INDEX IF NOT EXISTS idx_albion_guild_encounters_period
          ON albion_guild_encounters (event_at DESC, event_type, opponent_guild_key);
      `);

      const insert = db.prepare(`
        INSERT OR IGNORE INTO albion_guild_encounters
          (event_id, event_type, event_at, opponent_guild, opponent_guild_key)
        VALUES (?, ?, ?, ?, ?)
      `);
      const historical = db.prepare(`
        SELECT event_id, event_type, event_at, raw_event_json
        FROM albion_battle_events
        ORDER BY event_at
      `).all();
      for (const row of historical) {
        try {
          const event = JSON.parse(row.raw_event_json || '{}');
          const guild = row.event_type === 'kill' ? event?.Victim?.GuildName : event?.Killer?.GuildName;
          const label = String(guild || '').trim();
          if (label) insert.run(row.event_id, row.event_type, row.event_at, label, label.toLocaleLowerCase('en-US'));
        } catch {
          // Um evento histórico malformado não deve impedir a atualização do banco.
        }
      }
    }
  },
  {
    version: 70,
    name: 'albion_guild_killboard_ids',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(albion_guild_encounters)').all().map((column) => column.name);
      if (!columns.includes('opponent_guild_id')) {
        db.exec('ALTER TABLE albion_guild_encounters ADD COLUMN opponent_guild_id TEXT');
      }

      const update = db.prepare(`
        UPDATE albion_guild_encounters
        SET opponent_guild_id = ?
        WHERE event_id = ? AND (opponent_guild_id IS NULL OR opponent_guild_id = '')
      `);
      const historical = db.prepare(`
        SELECT event_id, event_type, raw_event_json
        FROM albion_battle_events
        ORDER BY event_at
      `).all();
      for (const row of historical) {
        try {
          const event = JSON.parse(row.raw_event_json || '{}');
          const player = row.event_type === 'kill' ? event?.Victim : event?.Killer;
          const guildId = String(player?.GuildId || '').trim();
          if (guildId) update.run(guildId, row.event_id);
        } catch {
          // Mantém o ranking disponível mesmo quando um evento antigo está malformado.
        }
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_albion_guild_encounters_guild_id
          ON albion_guild_encounters (opponent_guild_id, event_at DESC);
      `);
    }
  },
  {
    version: 71,
    name: 'marketplace_buy_and_sell_listings',
    up(db) {
      const orderColumns = db.prepare('PRAGMA table_info(wtb_buy_orders)').all().map((column) => column.name);
      if (!orderColumns.includes('listing_type')) {
        // Todos os anuncios anteriores vieram do canal WTS, que estava ligado ao fluxo WTB por engano.
        db.exec("ALTER TABLE wtb_buy_orders ADD COLUMN listing_type TEXT NOT NULL DEFAULT 'sell'");
      }
      if (!orderColumns.includes('owner_id')) {
        db.exec('ALTER TABLE wtb_buy_orders ADD COLUMN owner_id TEXT');
      }
      db.exec(`
        UPDATE wtb_buy_orders
        SET owner_id = buyer_id
        WHERE owner_id IS NULL OR owner_id = '';
      `);

      const offerColumns = db.prepare('PRAGMA table_info(wtb_offers)').all().map((column) => column.name);
      if (!offerColumns.includes('offerer_id')) {
        db.exec('ALTER TABLE wtb_offers ADD COLUMN offerer_id TEXT');
      }
      db.exec(`
        UPDATE wtb_offers
        SET offerer_id = seller_id
        WHERE offerer_id IS NULL OR offerer_id = '';

        CREATE INDEX IF NOT EXISTS idx_marketplace_orders_type_status
          ON wtb_buy_orders (listing_type, status, created_at DESC);
      `);
    }
  },
  {
    version: 72,
    name: 'academy_learning_progress',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS academy_progress (
          discord_id TEXT NOT NULL,
          track_key TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'in_progress',
          question_index INTEGER NOT NULL DEFAULT 0,
          correct_answers INTEGER NOT NULL DEFAULT 0,
          attempts INTEGER NOT NULL DEFAULT 0,
          started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (discord_id, track_key)
        );

        CREATE TABLE IF NOT EXISTS academy_answers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          discord_id TEXT NOT NULL,
          track_key TEXT NOT NULL,
          question_index INTEGER NOT NULL,
          selected_option INTEGER NOT NULL,
          correct INTEGER NOT NULL DEFAULT 0,
          answered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_academy_progress_status
          ON academy_progress (track_key, status, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_academy_answers_member
          ON academy_answers (discord_id, track_key, answered_at DESC);
      `);
    }
  },
  {
    version: 73,
    name: 'custom_event_dynamic_dps_weapon_pool',
    up(db) {
      const participantColumns = db.prepare('PRAGMA table_info(event_participants)').all().map((column) => column.name);
      if (!participantColumns.includes('custom_weapon_key')) {
        db.exec('ALTER TABLE event_participants ADD COLUMN custom_weapon_key TEXT');
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS custom_event_dps_weapons (
          event_id INTEGER NOT NULL,
          weapon_key TEXT NOT NULL,
          weapon_label TEXT NOT NULL,
          max_quantity INTEGER NOT NULL,
          mandatory INTEGER NOT NULL DEFAULT 0,
          build_url TEXT,
          image_url TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (event_id, weapon_key),
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
          CHECK (max_quantity > 0)
        );

        CREATE INDEX IF NOT EXISTS idx_custom_event_dps_weapons_event_order
          ON custom_event_dps_weapons (event_id, sort_order, weapon_label);
      `);
    }
  },
  {
    version: 74,
    name: 'mandatory_rules_acknowledgement',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS mandatory_rule_campaigns (
          rule_key TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          announcement_channel_id TEXT NOT NULL,
          announcement_message_id TEXT NOT NULL,
          help_voice_channel_id TEXT NOT NULL,
          member_role_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'waiting_voice',
          created_by TEXT NOT NULL,
          published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          enforced_at TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (status IN ('waiting_voice', 'enforced', 'acknowledgement_only'))
        );

        CREATE TABLE IF NOT EXISTS mandatory_rule_members (
          rule_key TEXT NOT NULL,
          user_id TEXT NOT NULL,
          had_member_role INTEGER NOT NULL DEFAULT 0,
          acknowledged_at TEXT,
          role_removed_at TEXT,
          role_restored_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (rule_key, user_id),
          FOREIGN KEY (rule_key) REFERENCES mandatory_rule_campaigns(rule_key) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_mandatory_rule_members_pending
          ON mandatory_rule_members (rule_key, acknowledged_at, user_id);
      `);
    }
  },
  {
    version: 75,
    name: 'event_content_type',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(events)').all().map((column) => column.name);
      if (!columns.includes('content_type')) {
        db.exec("ALTER TABLE events ADD COLUMN content_type TEXT NOT NULL DEFAULT 'other'");
      }
      db.exec(`
        UPDATE events SET content_type = CASE
          WHEN EXISTS (SELECT 1 FROM world_boss_events wb WHERE wb.event_id = events.id) THEN 'world_boss'
          WHEN EXISTS (SELECT 1 FROM raid_avalon_events ra WHERE ra.event_id = events.id) THEN 'raid_avalon'
          WHEN EXISTS (SELECT 1 FROM custom_events ce WHERE ce.event_id = events.id) THEN 'cta'
          WHEN lower(COALESCE(title, '') || ' ' || COALESCE(description, '')) LIKE '%transport%' THEN 'transport'
          WHEN lower(COALESCE(title, '') || ' ' || COALESCE(description, '')) LIKE '%facção%'
            OR lower(COALESCE(title, '') || ' ' || COALESCE(description, '')) LIKE '%faccao%' THEN 'faction_red_zone'
          WHEN lower(COALESCE(title, '') || ' ' || COALESCE(description, '')) LIKE '%estrada%avalon%'
            OR lower(COALESCE(title, '') || ' ' || COALESCE(description, '')) LIKE '%avalon%road%' THEN 'avalon_roads'
          WHEN lower(COALESCE(title, '') || ' ' || COALESCE(description, '')) LIKE '%dragão%'
            OR lower(COALESCE(title, '') || ' ' || COALESCE(description, '')) LIKE '%dragao%'
            OR lower(COALESCE(title, '') || ' ' || COALESCE(description, '')) LIKE '%dragon%' THEN 'dragons'
          WHEN lower(COALESCE(title, '') || ' ' || COALESCE(description, '')) LIKE '%dg%grupo%'
            OR lower(COALESCE(title, '') || ' ' || COALESCE(description, '')) LIKE '%group%dungeon%' THEN 'group_dungeon'
          WHEN lower(COALESCE(title, '') || ' ' || COALESCE(description, '')) LIKE '%roaming%' THEN 'roaming'
          WHEN lower(COALESCE(title, '') || ' ' || COALESCE(description, '')) LIKE '%for fun%'
            OR lower(COALESCE(title, '') || ' ' || COALESCE(description, '')) LIKE '%treino%' THEN 'for_fun'
          ELSE content_type
        END;

        CREATE INDEX IF NOT EXISTS idx_events_content_type_created
          ON events (content_type, created_at DESC);
      `);
    }
  },
  {
    version: 76,
    name: 'custom_event_dps_weapon_policy_and_emojis',
    up(db) {
      const customColumns = db.prepare('PRAGMA table_info(custom_events)').all().map((column) => column.name);
      if (!customColumns.includes('dps_policy')) {
        db.exec("ALTER TABLE custom_events ADD COLUMN dps_policy TEXT NOT NULL DEFAULT 'caller'");
      }
      const weaponColumns = db.prepare('PRAGMA table_info(custom_event_dps_weapons)').all().map((column) => column.name);
      if (!weaponColumns.includes('emoji_name')) db.exec('ALTER TABLE custom_event_dps_weapons ADD COLUMN emoji_name TEXT');
      if (!weaponColumns.includes('emoji_id')) db.exec('ALTER TABLE custom_event_dps_weapons ADD COLUMN emoji_id TEXT');
    }
  },
  {
    version: 77,
    name: 'group_dungeon_visual_builds',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS group_dungeon_builds (
          event_id INTEGER PRIMARY KEY,
          builds_channel_id TEXT NOT NULL,
          builds_channel_name TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );
      `);
    }
  },
  {
    version: 78,
    name: 'visual_event_builds',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS visual_event_builds (
          event_id INTEGER PRIMARY KEY,
          builds_channel_id TEXT NOT NULL,
          builds_channel_name TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );

        INSERT OR IGNORE INTO visual_event_builds
          (event_id, builds_channel_id, builds_channel_name, created_at, updated_at)
        SELECT event_id, builds_channel_id, builds_channel_name, created_at, updated_at
        FROM group_dungeon_builds;
      `);
    }
  },
  {
    version: 79,
    name: 'visual_event_composition_mode_and_rule_snapshot',
    up(db) {
      const columns = db.prepare('PRAGMA table_info(visual_event_builds)').all().map((column) => column.name);
      if (!columns.includes('composition_mode')) {
        db.exec("ALTER TABLE visual_event_builds ADD COLUMN composition_mode TEXT NOT NULL DEFAULT 'predefined'");
      }
      if (!columns.includes('rules_json')) db.exec('ALTER TABLE visual_event_builds ADD COLUMN rules_json TEXT');
      if (!columns.includes('sheet_url')) db.exec('ALTER TABLE visual_event_builds ADD COLUMN sheet_url TEXT');
    }
  },
  {
    version: 80,
    name: 'albion_operational_history',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS albion_operational_imports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL CHECK (kind IN ('food', 'guild_history', 'bank')),
          source_name TEXT,
          source_hash TEXT NOT NULL,
          rows_count INTEGER NOT NULL DEFAULT 0,
          inserted_count INTEGER NOT NULL DEFAULT 0,
          duplicate_count INTEGER NOT NULL DEFAULT 0,
          imported_by TEXT,
          first_event_at TEXT,
          last_event_at TEXT,
          summary_json TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (kind, source_hash)
        );

        CREATE TABLE IF NOT EXISTS albion_food_contribution_rows (
          import_id INTEGER NOT NULL,
          albion_key TEXT NOT NULL,
          albion_name TEXT NOT NULL,
          guild_role TEXT,
          source_rank INTEGER,
          amount INTEGER NOT NULL DEFAULT 0,
          previous_amount INTEGER NOT NULL DEFAULT 0,
          discord_id TEXT,
          PRIMARY KEY (import_id, albion_key),
          FOREIGN KEY (import_id) REFERENCES albion_operational_imports(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS albion_guild_history_events (
          event_key TEXT PRIMARY KEY,
          event_at TEXT NOT NULL,
          actor_name TEXT NOT NULL,
          action_type TEXT NOT NULL,
          raw_reason TEXT NOT NULL,
          role_name TEXT,
          target_name TEXT,
          target_missing INTEGER NOT NULL DEFAULT 0,
          first_import_id INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (first_import_id) REFERENCES albion_operational_imports(id) ON DELETE RESTRICT
        );

        CREATE TABLE IF NOT EXISTS albion_guild_bank_events (
          event_key TEXT PRIMARY KEY,
          event_at TEXT NOT NULL,
          player_name TEXT NOT NULL,
          action_type TEXT NOT NULL,
          reason TEXT NOT NULL,
          amount INTEGER NOT NULL,
          first_import_id INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (first_import_id) REFERENCES albion_operational_imports(id) ON DELETE RESTRICT
        );

        CREATE INDEX IF NOT EXISTS idx_albion_operational_imports_kind
          ON albion_operational_imports (kind, id DESC);
        CREATE INDEX IF NOT EXISTS idx_albion_food_rows_amount
          ON albion_food_contribution_rows (import_id, amount DESC);
        CREATE INDEX IF NOT EXISTS idx_albion_history_events_date
          ON albion_guild_history_events (event_at DESC, action_type);
        CREATE INDEX IF NOT EXISTS idx_albion_bank_events_date
          ON albion_guild_bank_events (event_at DESC, action_type);
      `);
    }
  },
  {
    version: 81,
    name: 'mandatory_rules_acknowledgement_only_status',
    foreignKeysOff: true,
    up(db) {
      db.exec(`
        CREATE TABLE mandatory_rule_campaigns_new (
          rule_key TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          announcement_channel_id TEXT NOT NULL,
          announcement_message_id TEXT NOT NULL,
          help_voice_channel_id TEXT NOT NULL,
          member_role_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'waiting_voice',
          created_by TEXT NOT NULL,
          published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          enforced_at TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (status IN ('waiting_voice', 'enforced', 'acknowledgement_only'))
        );

        INSERT INTO mandatory_rule_campaigns_new (
          rule_key,
          guild_id,
          announcement_channel_id,
          announcement_message_id,
          help_voice_channel_id,
          member_role_id,
          status,
          created_by,
          published_at,
          enforced_at,
          updated_at
        )
        SELECT
          rule_key,
          guild_id,
          announcement_channel_id,
          announcement_message_id,
          help_voice_channel_id,
          member_role_id,
          status,
          created_by,
          published_at,
          enforced_at,
          updated_at
        FROM mandatory_rule_campaigns;

        DROP TABLE mandatory_rule_campaigns;
        ALTER TABLE mandatory_rule_campaigns_new RENAME TO mandatory_rule_campaigns;
      `);

      const violations = db.pragma('foreign_key_check');
      if (violations.length > 0) {
        throw new Error(`Falha de integridade apos migrar campanhas de regras: ${JSON.stringify(violations)}`);
      }
    }
  },
  {
    version: 82,
    name: 'spring_hideout_announcement_feedback',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS spring_hideout_announcement_feedback (
          user_id TEXT NOT NULL,
          feedback_type TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, feedback_type),
          CHECK (feedback_type IN ('liked', 'read'))
        );

        CREATE TABLE IF NOT EXISTS spring_hideout_suggestions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          author_id TEXT NOT NULL,
          suggestion TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          staff_channel_id TEXT,
          staff_message_id TEXT,
          answered_by TEXT,
          answer TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          answered_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_spring_hideout_suggestions_status
          ON spring_hideout_suggestions (status, created_at);
      `);
    }
  },
  {
    version: 83,
    name: 'caller_content_schedules',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS caller_content_schedules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          message_id TEXT,
          schedule_date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          closed_at TEXT,
          CHECK (status IN ('open', 'closed'))
        );

        CREATE TABLE IF NOT EXISTS caller_content_assignments (
          schedule_id INTEGER NOT NULL,
          slot_key TEXT NOT NULL,
          caller_id TEXT NOT NULL,
          content_key TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (schedule_id, slot_key),
          FOREIGN KEY (schedule_id) REFERENCES caller_content_schedules(id) ON DELETE CASCADE,
          CHECK (content_key IN ('group_dungeon', 'roaming', 'world_boss'))
        );

        CREATE INDEX IF NOT EXISTS idx_caller_content_schedules_open
          ON caller_content_schedules (guild_id, status, id DESC);
        CREATE INDEX IF NOT EXISTS idx_caller_content_assignments_caller
          ON caller_content_assignments (schedule_id, caller_id);
      `);
    }
  },
  {
    version: 84,
    name: 'event_templates_saved_configuration_snapshots',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS event_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          creator_id TEXT NOT NULL,
          name TEXT NOT NULL,
          title TEXT NOT NULL,
          location TEXT,
          requirements TEXT,
          composition TEXT,
          tank_slots INTEGER NOT NULL DEFAULT 0,
          healer_slots INTEGER NOT NULL DEFAULT 0,
          support_slots INTEGER NOT NULL DEFAULT 0,
          dps_slots INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(creator_id, name)
        );
      `);
      const columns = db.prepare('PRAGMA table_info(event_templates)').all().map((column) => column.name);
      if (!columns.includes('kind')) db.exec("ALTER TABLE event_templates ADD COLUMN kind TEXT NOT NULL DEFAULT 'common'");
      if (!columns.includes('content_type')) db.exec("ALTER TABLE event_templates ADD COLUMN content_type TEXT NOT NULL DEFAULT 'other'");
      if (!columns.includes('source_event_id')) db.exec('ALTER TABLE event_templates ADD COLUMN source_event_id INTEGER');
      if (!columns.includes('config_json')) db.exec("ALTER TABLE event_templates ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}'");
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_event_templates_creator_type
          ON event_templates (creator_id, kind, content_type, updated_at DESC);
      `);
    }
  },
  {
    version: 85,
    name: 'albion_regear_workflow',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS albion_regear_requests (
          event_id INTEGER PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'pending',
          reviewed_by TEXT,
          approved_at TEXT,
          paid_at TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (event_id) REFERENCES albion_battle_events(event_id) ON DELETE CASCADE,
          CHECK (status IN ('pending', 'approved', 'paid'))
        );

        CREATE INDEX IF NOT EXISTS idx_albion_regear_requests_status_updated
          ON albion_regear_requests (status, updated_at DESC);

        PRAGMA optimize;
      `);
    }
  },
  {
    version: 86,
    name: 'constant_players_raffle',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS constant_raffles (
          raffle_key TEXT PRIMARY KEY,
          scheduled_at TEXT,
          status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'scheduled', 'completed')),
          unresolved_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS constant_raffle_participants (
          raffle_key TEXT NOT NULL,
          discord_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          PRIMARY KEY (raffle_key, discord_id)
        );

        CREATE TABLE IF NOT EXISTS constant_raffle_results (
          raffle_key TEXT NOT NULL,
          slot_number INTEGER NOT NULL,
          winner_discord_id TEXT NOT NULL,
          winner_name TEXT NOT NULL,
          confirmed_at TEXT,
          PRIMARY KEY (raffle_key, slot_number)
        );

        CREATE TABLE IF NOT EXISTS constant_raffle_notifications (
          raffle_key TEXT NOT NULL,
          notification_key TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (raffle_key, notification_key)
        );

        CREATE TABLE IF NOT EXISTS constant_raffle_dm_notifications (
          raffle_key TEXT NOT NULL,
          discord_id TEXT NOT NULL,
          sent_at TEXT,
          last_attempt_at TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (raffle_key, discord_id)
        );
      `);
    }
  }
];

function mergeCampaignEventPayouts(db, primaryDiscordId, linkedDiscordId) {
  const conflicts = db.prepare(`
    SELECT
      linked.id AS linked_id,
      primary_row.id AS primary_id,
      linked.amount AS linked_amount
    FROM campaign_event_payouts linked
    JOIN campaign_event_payouts primary_row
      ON primary_row.campaign_id = linked.campaign_id
     AND primary_row.event_id = linked.event_id
     AND primary_row.user_id = ?
    WHERE linked.user_id = ?
  `).all(primaryDiscordId, linkedDiscordId);

  for (const row of conflicts) {
    db.prepare(`
      UPDATE campaign_event_payouts
      SET amount = amount + ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(Number(row.linked_amount || 0), row.primary_id);
    db.prepare('DELETE FROM campaign_event_payouts WHERE id = ?').run(row.linked_id);
  }
}

function getAppliedVersions(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  return new Set(db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version));
}

function migrate() {
  const db = getDatabase();
  const applied = getAppliedVersions(db);
  const pending = migrations.filter((migration) => !applied.has(migration.version));

  if (pending.length > 0) {
    backupDatabase('before_migration');
  }

  const runMigration = transaction((migration) => {
    migration.up(db);
    db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
  });

  for (const migration of pending) {
    if (!migration.foreignKeysOff) {
      runMigration(migration);
      continue;
    }

    db.pragma('foreign_keys = OFF');
    try {
      runMigration(migration);
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
}

module.exports = {
  migrate
};
