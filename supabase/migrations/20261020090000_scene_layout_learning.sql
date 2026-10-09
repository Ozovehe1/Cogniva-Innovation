-- Scene engine layout learning (additive; idempotent). Every render's layout outcome rides on manim_jobs.verdict.layout
-- (added with the correctness migration). Recurring failure PATTERNS (general, never learner content) tune the label
-- solver's weights within bounds and add avoid-notes for the scene writer (correctness_blocklist kind 'clip_spec', topic
-- 'scene-layout'). See src/lib/correctness/layout-learning.ts. Server only (service role); no learner data is stored here.

create table if not exists scene_layout_patterns (
  pattern text primary key,
  hits integer not null default 0,           -- renders that showed it (a confirmed learner report counts more)
  adjusted_hits integer not null default 0,  -- hits at its last adjustment
  adjustments integer not null default 0,
  last_seen timestamptz,
  last_adjusted timestamptz
);
alter table scene_layout_patterns enable row level security;

create table if not exists scene_layout_weights (
  key text primary key,
  value real not null,
  default_value real not null,
  lo real not null,
  hi real not null,
  note text,
  updated_at timestamptz not null default now(),
  check (lo <= hi)
);
alter table scene_layout_weights enable row level security;

-- The engine's defaults and bounds (modal_app/gm_stage.py LAYOUT_DEFAULTS / LAYOUT_BOUNDS; the engine clamps again).
insert into scene_layout_weights (key, value, default_value, lo, hi) values
  ('clear', 0.5, 0.5, 0.25, 1.0),
  ('clear_w', 3.0, 3.0, 1.0, 12.0),
  ('stroke_in', 4.0, 4.0, 2.0, 12.0),
  ('anchor', 0.6, 0.6, 0.2, 3.0),
  ('reach', 2.0, 2.0, 1.0, 4.0),
  ('own', 6.0, 6.0, 2.0, 20.0),
  ('tick_clear', 0.25, 0.25, 0.1, 0.8),
  ('min_xh_px', 6.0, 6.0, 5.5, 8.0)
on conflict (key) do nothing;
