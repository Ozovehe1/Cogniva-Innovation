-- ============================================================
-- STEP 1: Extensions
-- ============================================================
create extension if not exists "uuid-ossp";

-- ============================================================
-- STEP 2: Drop existing triggers safely
-- ============================================================
do $$ begin
  drop trigger if exists on_auth_user_created on auth.users;
exception when others then null;
end$$;

do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'project_assignments'
  ) then
    drop trigger if exists on_project_completed on project_assignments;
  end if;
end$$;

-- ============================================================
-- STEP 3: Functions
-- ============================================================
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'student')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================
-- STEP 4: Tables
-- ============================================================
create table if not exists profiles (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade unique not null,
  full_name text not null,
  email text not null,
  role text check (role in ('student', 'tutor')) not null,
  avatar_url text,
  created_at timestamptz default now()
);

create table if not exists intelligence_profiles (
  id uuid default uuid_generate_v4() primary key,
  student_id uuid references profiles(id) on delete cascade unique not null,
  dominant_intelligence text not null,
  intelligence_scores jsonb not null,
  personality_insight text not null,
  learning_path jsonb not null,
  career_suggestions jsonb not null,
  study_tips jsonb not null,
  genius_statement text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists student_growth (
  id uuid default uuid_generate_v4() primary key,
  student_id uuid references profiles(id) on delete cascade unique not null,
  growth_score integer default 0,
  projects_completed integer default 0,
  projects_total integer default 0,
  level text default 'Seed',
  badges jsonb default '[]',
  updated_at timestamptz default now()
);

create table if not exists tutor_students (
  id uuid default uuid_generate_v4() primary key,
  tutor_id uuid references profiles(id) on delete cascade not null,
  student_id uuid references profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(tutor_id, student_id)
);

create table if not exists projects (
  id uuid default uuid_generate_v4() primary key,
  tutor_id uuid references profiles(id) on delete cascade not null,
  title text not null,
  description text not null,
  subject text not null,
  difficulty text check (difficulty in ('beginner', 'intermediate', 'advanced')) not null,
  objectives jsonb not null default '[]',
  steps jsonb not null default '[]',
  deliverables jsonb not null default '[]',
  estimated_hours integer default 1,
  intelligence_activated jsonb default '[]',
  ai_generated boolean default false,
  created_at timestamptz default now()
);

create table if not exists project_assignments (
  id uuid default uuid_generate_v4() primary key,
  project_id uuid references projects(id) on delete cascade not null,
  student_id uuid references profiles(id) on delete cascade not null,
  status text check (status in ('assigned', 'in_progress', 'completed')) default 'assigned',
  submitted_at timestamptz,
  feedback text,
  created_at timestamptz default now(),
  unique(project_id, student_id)
);

-- ============================================================
-- STEP 5: Enable RLS
-- ============================================================
alter table profiles enable row level security;
alter table intelligence_profiles enable row level security;
alter table student_growth enable row level security;
alter table tutor_students enable row level security;
alter table projects enable row level security;
alter table project_assignments enable row level security;

-- ============================================================
-- STEP 6: Drop ALL existing policies
-- ============================================================
do $$ declare r record; begin
  for r in (
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
  ) loop
    execute format(
      'drop policy if exists %I on %I',
      r.policyname, r.tablename
    );
  end loop;
end$$;

-- ============================================================
-- STEP 7: Helper — reads profiles without triggering RLS recursion
-- ============================================================
create or replace function get_my_profile_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from profiles where user_id = auth.uid() limit 1;
$$;

-- ============================================================
-- STEP 8: Helper — creates profile on signup (bypasses RLS)
-- ============================================================
create or replace function ensure_profile_exists(
  p_user_id uuid,
  p_full_name text,
  p_email text,
  p_role text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() != p_user_id then
    raise exception 'Unauthorized';
  end if;
  insert into profiles (user_id, full_name, email, role)
  values (p_user_id, p_full_name, p_email, p_role)
  on conflict (user_id) do nothing;
  select role into v_role from profiles where user_id = p_user_id;
  return v_role;
end;
$$;

-- ============================================================
-- STEP 9: RLS Policies
-- ============================================================

-- profiles
create policy "users_select_own" on profiles
  for select using (auth.uid() = user_id);

create policy "users_insert_own" on profiles
  for insert with check (auth.uid() = user_id);

create policy "users_update_own" on profiles
  for update using (auth.uid() = user_id);

create policy "tutors_select_students" on profiles
  for select using (
    exists (
      select 1 from tutor_students
      where tutor_id = get_my_profile_id()
      and student_id = profiles.id
    )
  );

-- intelligence_profiles
create policy "students_select_own_intel" on intelligence_profiles
  for select using (
    exists (select 1 from profiles p where p.id = student_id and p.user_id = auth.uid())
  );

create policy "students_insert_own_intel" on intelligence_profiles
  for insert with check (
    exists (select 1 from profiles p where p.id = student_id and p.user_id = auth.uid())
  );

create policy "students_update_own_intel" on intelligence_profiles
  for update using (
    exists (select 1 from profiles p where p.id = student_id and p.user_id = auth.uid())
  );

create policy "tutors_select_student_intel" on intelligence_profiles
  for select using (
    exists (
      select 1 from tutor_students ts
      join profiles tp on tp.id = ts.tutor_id
      where tp.user_id = auth.uid()
      and ts.student_id = intelligence_profiles.student_id
    )
  );

-- student_growth
create policy "students_all_own_growth" on student_growth
  for all using (
    exists (select 1 from profiles p where p.id = student_id and p.user_id = auth.uid())
  );

create policy "tutors_select_growth" on student_growth
  for select using (
    exists (
      select 1 from tutor_students ts
      join profiles tp on tp.id = ts.tutor_id
      where tp.user_id = auth.uid()
      and ts.student_id = student_growth.student_id
    )
  );

-- tutor_students
create policy "tutors_all_their_students" on tutor_students
  for all using (
    exists (select 1 from profiles p where p.id = tutor_id and p.user_id = auth.uid())
  );

create policy "students_select_their_tutors" on tutor_students
  for select using (
    exists (select 1 from profiles p where p.id = student_id and p.user_id = auth.uid())
  );

-- projects
create policy "tutors_all_projects" on projects
  for all using (
    exists (select 1 from profiles p where p.id = tutor_id and p.user_id = auth.uid())
  );

create policy "students_select_assigned_projects" on projects
  for select using (
    exists (
      select 1 from project_assignments pa
      where pa.project_id = projects.id
      and exists (select 1 from profiles p where p.id = pa.student_id and p.user_id = auth.uid())
    )
  );

-- project_assignments
create policy "tutors_all_assignments" on project_assignments
  for all using (
    exists (
      select 1 from projects pr
      join profiles p on p.id = pr.tutor_id
      where p.user_id = auth.uid()
      and pr.id = project_assignments.project_id
    )
  );

create policy "students_select_own_assignments" on project_assignments
  for select using (
    exists (select 1 from profiles p where p.id = student_id and p.user_id = auth.uid())
  );

create policy "students_update_own_assignments" on project_assignments
  for update using (
    exists (select 1 from profiles p where p.id = student_id and p.user_id = auth.uid())
  );

-- ============================================================
-- STEP 10: Growth recalculation trigger
-- ============================================================
create or replace function update_student_growth()
returns trigger as $$
declare
  completed_count integer;
  total_count integer;
  new_score integer;
  new_level text;
begin
  if NEW.status = 'completed' and OLD.status != 'completed' then
    select count(*) into completed_count
      from project_assignments
      where student_id = NEW.student_id and status = 'completed';
    select count(*) into total_count
      from project_assignments
      where student_id = NEW.student_id;
    new_score := (completed_count * 100) / greatest(total_count, 1);
    new_level := case
      when completed_count >= 20 then 'Legend'
      when completed_count >= 10 then 'Master'
      when completed_count >= 5  then 'Explorer'
      when completed_count >= 2  then 'Sprout'
      else 'Seed'
    end;
    insert into student_growth
      (student_id, growth_score, projects_completed, projects_total, level, updated_at)
    values
      (NEW.student_id, new_score, completed_count, total_count, new_level, now())
    on conflict (student_id) do update set
      growth_score = new_score,
      projects_completed = completed_count,
      projects_total = total_count,
      level = new_level,
      updated_at = now();
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

create trigger on_project_completed
  after update on project_assignments
  for each row execute function update_student_growth();
