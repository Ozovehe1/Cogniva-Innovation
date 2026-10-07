-- Live Tutor: lessons, progress, Manim render jobs, clip storage.
-- Idempotent: safe to re-run.

create or replace function is_tutor()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from profiles where user_id = auth.uid() and role = 'tutor');
$$;

create table if not exists lessons (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid references profiles(id) on delete cascade, -- null = platform sample lesson
  title text not null,
  subject text not null default '',
  objectives text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'approved')),
  script jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lessons_tutor_idx on lessons(tutor_id);
create index if not exists lessons_status_idx on lessons(status);

create table if not exists lesson_progress (
  student_id uuid not null references profiles(id) on delete cascade,
  lesson_id uuid not null references lessons(id) on delete cascade,
  step_index integer not null default 0,
  events jsonb not null default '[]'::jsonb,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (student_id, lesson_id)
);

create table if not exists manim_jobs (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid references lessons(id) on delete set null,
  requested_by uuid not null references profiles(id) on delete cascade,
  prompt text not null,
  code text,
  scene_name text not null default 'GeneratedScene',
  status text not null default 'queued' check (status in ('queued', 'rendering', 'done', 'failed', 'approved')),
  attempts integer not null default 0,
  video_path text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists manim_jobs_lesson_idx on manim_jobs(lesson_id);
create index if not exists manim_jobs_requested_by_idx on manim_jobs(requested_by);

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists lessons_touch on lessons;
create trigger lessons_touch before update on lessons for each row execute procedure touch_updated_at();
drop trigger if exists lesson_progress_touch on lesson_progress;
create trigger lesson_progress_touch before update on lesson_progress for each row execute procedure touch_updated_at();
drop trigger if exists manim_jobs_touch on manim_jobs;
create trigger manim_jobs_touch before update on manim_jobs for each row execute procedure touch_updated_at();

alter table lessons enable row level security;
alter table lesson_progress enable row level security;
alter table manim_jobs enable row level security;

-- lessons: tutors manage their own; any signed-in user reads approved lessons.
drop policy if exists "tutors_manage_own_lessons" on lessons;
create policy "tutors_manage_own_lessons" on lessons
  for all using (tutor_id = get_my_profile_id() and is_tutor())
  with check (tutor_id = get_my_profile_id() and is_tutor());
drop policy if exists "read_approved_lessons" on lessons;
create policy "read_approved_lessons" on lessons
  for select using (status = 'approved' and auth.uid() is not null);

-- lesson_progress: students own theirs; tutors read progress on their lessons.
drop policy if exists "students_manage_own_progress" on lesson_progress;
create policy "students_manage_own_progress" on lesson_progress
  for all using (student_id = get_my_profile_id())
  with check (student_id = get_my_profile_id());
drop policy if exists "tutors_read_progress_on_their_lessons" on lesson_progress;
create policy "tutors_read_progress_on_their_lessons" on lesson_progress
  for select using (exists (select 1 from lessons l where l.id = lesson_progress.lesson_id and l.tutor_id = get_my_profile_id()));

-- manim_jobs: only tutors, only their own jobs. The render callback uses the service role.
drop policy if exists "tutors_manage_own_jobs" on manim_jobs;
create policy "tutors_manage_own_jobs" on manim_jobs
  for all using (requested_by = get_my_profile_id() and is_tutor())
  with check (requested_by = get_my_profile_id() and is_tutor());

-- Storage bucket for rendered clips (public read; writes only via service-role signed upload URLs).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('manim-clips', 'manim-clips', true, 104857600, array['video/mp4'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Seed: one generic sample lesson (demo only; tutors write the real syllabus).
insert into lessons (id, tutor_id, title, subject, objectives, status, script)
values (
  '00000000-0000-4000-8000-00000000d001',
  null,
  'What is a derivative?',
  'Mathematics',
  array['Describe the derivative as the slope of a curve at a single point', 'See the tangent line as the limit of secant lines', 'Compute the slope of y = x² at a point']::text[],
  'approved',
  '[{"type":"write","id":"title","text":"What is a derivative?","x":40,"y":30,"size":"lg","say":"A derivative answers one question: how fast is something changing at a single instant?"},{"type":"write","id":"sub","text":"How steep is a curve at one point?","x":42,"y":84,"size":"sm","color":"muted","font":"sans"},{"type":"draw","id":"ax","shape":{"kind":"axes","frame":{"x":70,"y":130,"w":380,"h":320},"xRange":[-0.5,3],"yRange":[-0.6,6],"xLabel":"x","yLabel":"y","xStep":1,"yStep":2},"say":"Let’s take a simple curve and look closely."},{"type":"draw","id":"curve","on":"ax","shape":{"kind":"function","expr":"x^2"},"color":"accent","width":3},{"type":"math","id":"eq","tex":"y = x^2","x":490,"y":136,"size":"lg","color":"accent","say":"This is the curve $y = x^2$: square any number $x$ and you get its height."},{"type":"draw","id":"p","on":"ax","shape":{"kind":"point","at":[1,1],"label":"P","labelPos":"nw"},"say":"Pick a point P on the curve, at $x = 1$. How steep is the curve right there?"},{"type":"draw","id":"q","on":"ax","shape":{"kind":"point","at":[2,4],"label":"Q"},"color":"clay","say":"A straight line has one slope. A curve doesn’t, so we start with something we can measure: a second point Q."},{"type":"draw","id":"sec","on":"ax","shape":{"kind":"line","from":[0.4,-0.8],"to":[2.6,5.8]},"color":"clay","dashed":true,"say":"Join P and Q with a straight line. A line that cuts a curve like this is called a secant."},{"type":"math","id":"slope","tex":"\\text{slope} = \\frac{4 - 1}{2 - 1} = 3","x":490,"y":210,"size":"md","say":"The line through P and Q rises 3 for every 1 across. Its slope is 3, but that is an average between P and Q."},{"type":"pause","ms":600},{"type":"clear","targets":["q","sec"]},{"type":"draw","id":"q","on":"ax","shape":{"kind":"point","at":[1.5,2.25],"label":"Q"},"color":"clay","say":"Slide Q closer to P."},{"type":"draw","id":"sec","on":"ax","shape":{"kind":"line","from":[0.3,-0.75],"to":[2.7,5.25]},"color":"clay","dashed":true},{"type":"transform","target":"slope","tex":"\\text{slope} = \\frac{2.25 - 1}{1.5 - 1} = 2.5","say":"Now the slope is $2.5$. The closer Q gets, the more the line hugs the curve near P."},{"type":"pause","ms":500},{"type":"transform","target":"slope","tex":"\\text{slope} = \\frac{(1+h)^2 - 1}{h} = 2 + h","say":"Call the gap between them $h$. The algebra simplifies to $2 + h$."},{"type":"clear","targets":["q","sec"]},{"type":"draw","id":"tan","on":"ax","shape":{"kind":"line","from":[0.2,-0.6],"to":[3,5]},"color":"navy","width":3,"say":"Now let $h$ shrink to zero. The secant settles into one line that just touches the curve at P: the tangent."},{"type":"transform","target":"slope","tex":"\\lim_{h \\to 0}\\,(2 + h) = 2","say":"And the slope $2 + h$ becomes exactly $2$."},{"type":"highlight","target":"slope","color":"amber"},{"type":"math","id":"fp","tex":"f''(1) = 2","x":490,"y":300,"size":"lg","color":"navy","say":"That limiting slope is the derivative. At $x = 1$, the curve is climbing at a rate of $2$: we write $f''(1) = 2$."},{"type":"write","id":"def","text":"The derivative is the slope of the tangent line.","x":490,"y":370,"size":"sm","font":"sans","color":"ink","maxWidth":280,"say":"So, in one sentence: the derivative is the slope of the tangent line."},{"type":"check","id":"c1","kind":"understand","prompt":"Does it make sense why the tangent’s slope is the limit of the secant slopes?","reteach":[{"type":"clear","targets":["slope","fp","def"]},{"type":"write","id":"zoom","text":"Zoom in on P far enough and the curve looks straight.","x":490,"y":200,"size":"sm","font":"sans","maxWidth":280,"say":"Here is another way to see it. Zoom in on any smooth curve and it starts to look like a straight line."},{"type":"math","id":"table","tex":"\\begin{array}{c|c} h & \\text{slope} \\\\ \\hline 1 & 3 \\\\ 0.5 & 2.5 \\\\ 0.1 & 2.1 \\\\ 0.01 & 2.01 \\end{array}","x":520,"y":270,"size":"md","say":"Measure the slope with smaller and smaller gaps $h$. The numbers close in on $2$."},{"type":"highlight","target":"tan","style":"box","color":"navy","say":"That straight line you see when you zoom in is the tangent, and its slope, 2, is the derivative."}]},{"type":"clear"},{"type":"write","id":"gen","text":"The same idea works at any point","x":40,"y":34,"size":"md","say":"Do the same algebra at any point x and you get a formula for the slope everywhere."},{"type":"math","id":"rule","tex":"\\frac{d}{dx}\\, x^2 = \\lim_{h \\to 0} \\frac{(x+h)^2 - x^2}{h}","x":400,"y":150,"size":"lg","align":"center","say":"Here is the slope at a general point $x$, written as a limit."},{"type":"transform","target":"rule","tex":"\\frac{d}{dx}\\, x^2 = \\lim_{h \\to 0}\\, (2x + h) = 2x","say":"Expand, cancel, and let $h$ go to zero. The slope of $x^2$ at any point $x$ is $2x$."},{"type":"highlight","target":"rule","style":"underline","color":"accent"},{"type":"check","id":"c2","kind":"choice","prompt":"What is the slope of $y = x^2$ at $x = 3$?","options":["$3$","$6$","$9$","$2$"],"answer":1,"explanation":"The slope is $2x$, so at $x = 3$ it is $2 \\cdot 3 = 6$.","reteach":[{"type":"math","id":"plug","tex":"f''(x) = 2x \\;\\Rightarrow\\; f''(3) = 2 \\cdot 3","x":400,"y":280,"size":"md","align":"center","say":"Careful: $9$ is the height of the curve at $x = 3$, not its slope. The slope comes from the formula $2x$."},{"type":"transform","target":"plug","tex":"f''(3) = 6","say":"So at $x = 3$ the curve is climbing $6$ units up for every $1$ across."}]},{"type":"write","id":"end","text":"Derivative = instantaneous rate of change.","x":400,"y":380,"size":"md","align":"center","color":"accent","say":"That is the whole idea: a derivative is the rate of change at a single instant."}]'::jsonb
)
on conflict (id) do update set title = excluded.title, subject = excluded.subject, objectives = excluded.objectives, script = excluded.script, status = 'approved';
