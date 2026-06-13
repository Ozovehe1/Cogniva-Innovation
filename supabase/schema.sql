-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Auto-create profile when a new auth user signs up (bypasses RLS timing issue)
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'student')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- Profiles table
create table profiles (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade unique not null,
  full_name text not null,
  email text not null,
  role text check (role in ('student', 'tutor')) not null,
  avatar_url text,
  created_at timestamptz default now()
);

-- Intelligence profiles (one per student)
create table intelligence_profiles (
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

-- Student growth tracking
create table student_growth (
  id uuid default uuid_generate_v4() primary key,
  student_id uuid references profiles(id) on delete cascade unique not null,
  growth_score integer default 0,
  projects_completed integer default 0,
  projects_total integer default 0,
  level text default 'Seed',
  badges jsonb default '[]',
  updated_at timestamptz default now()
);

-- Tutor-student relationships
create table tutor_students (
  id uuid default uuid_generate_v4() primary key,
  tutor_id uuid references profiles(id) on delete cascade not null,
  student_id uuid references profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(tutor_id, student_id)
);

-- Projects created by tutors
create table projects (
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

-- Project assignments (tutor assigns project to student)
create table project_assignments (
  id uuid default uuid_generate_v4() primary key,
  project_id uuid references projects(id) on delete cascade not null,
  student_id uuid references profiles(id) on delete cascade not null,
  status text check (status in ('assigned', 'in_progress', 'completed')) default 'assigned',
  submitted_at timestamptz,
  feedback text,
  created_at timestamptz default now(),
  unique(project_id, student_id)
);

-- RLS Policies
alter table profiles enable row level security;
alter table intelligence_profiles enable row level security;
alter table student_growth enable row level security;
alter table tutor_students enable row level security;
alter table projects enable row level security;
alter table project_assignments enable row level security;

-- Helper: get current user's profile id without triggering RLS recursion
create or replace function get_my_profile_id()
returns uuid language sql security definer stable as $$
  select id from profiles where user_id = auth.uid() limit 1;
$$;

-- Profiles: users can manage own profile, tutors can read their students
create policy "Users can view own profile" on profiles for select using (auth.uid() = user_id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = user_id);
create policy "Users can insert own profile" on profiles for insert with check (auth.uid() = user_id);
create policy "Tutors can view their students profiles" on profiles for select using (
  exists (select 1 from tutor_students where tutor_id = get_my_profile_id() and student_id = profiles.id)
);

-- Intelligence profiles: student sees own, tutor sees their students
create policy "Students view own intelligence profile" on intelligence_profiles for select using (
  exists (select 1 from profiles p where p.id = student_id and p.user_id = auth.uid())
);
create policy "Students insert own intelligence profile" on intelligence_profiles for insert with check (
  exists (select 1 from profiles p where p.id = student_id and p.user_id = auth.uid())
);
create policy "Students update own intelligence profile" on intelligence_profiles for update using (
  exists (select 1 from profiles p where p.id = student_id and p.user_id = auth.uid())
);
create policy "Tutors view their students intelligence" on intelligence_profiles for select using (
  exists (select 1 from tutor_students ts join profiles tp on tp.id = ts.tutor_id where tp.user_id = auth.uid() and ts.student_id = intelligence_profiles.student_id)
);

-- Student growth
create policy "Students view own growth" on student_growth for select using (
  exists (select 1 from profiles p where p.id = student_id and p.user_id = auth.uid())
);
create policy "Students update own growth" on student_growth for all using (
  exists (select 1 from profiles p where p.id = student_id and p.user_id = auth.uid())
);
create policy "Tutors view student growth" on student_growth for select using (
  exists (select 1 from tutor_students ts join profiles tp on tp.id = ts.tutor_id where tp.user_id = auth.uid() and ts.student_id = student_growth.student_id)
);

-- Projects
create policy "Tutors manage their projects" on projects for all using (
  exists (select 1 from profiles p where p.id = tutor_id and p.user_id = auth.uid())
);
create policy "Students view assigned projects" on projects for select using (
  exists (select 1 from project_assignments pa where pa.project_id = projects.id and exists (select 1 from profiles p where p.id = pa.student_id and p.user_id = auth.uid()))
);

-- Project assignments
create policy "Tutors manage assignments" on project_assignments for all using (
  exists (select 1 from projects pr join profiles p on p.id = pr.tutor_id where p.user_id = auth.uid() and pr.id = project_assignments.project_id)
);
create policy "Students view and update own assignments" on project_assignments for select using (
  exists (select 1 from profiles p where p.id = student_id and p.user_id = auth.uid())
);
create policy "Students update own assignment status" on project_assignments for update using (
  exists (select 1 from profiles p where p.id = student_id and p.user_id = auth.uid())
);

-- Tutor-student relationships
create policy "Tutors manage their students" on tutor_students for all using (
  exists (select 1 from profiles p where p.id = tutor_id and p.user_id = auth.uid())
);
create policy "Students view their tutors" on tutor_students for select using (
  exists (select 1 from profiles p where p.id = student_id and p.user_id = auth.uid())
);

-- Function to recalculate student growth when project is completed
create or replace function update_student_growth()
returns trigger as $$
declare
  completed_count integer;
  total_count integer;
  new_score integer;
  new_level text;
begin
  if NEW.status = 'completed' and OLD.status != 'completed' then
    select count(*) into completed_count from project_assignments where student_id = NEW.student_id and status = 'completed';
    select count(*) into total_count from project_assignments where student_id = NEW.student_id;
    new_score := (completed_count * 100) / greatest(total_count, 1);
    new_level := case
      when completed_count >= 20 then 'Legend'
      when completed_count >= 10 then 'Master'
      when completed_count >= 5 then 'Explorer'
      when completed_count >= 2 then 'Sprout'
      else 'Seed'
    end;
    insert into student_growth (student_id, growth_score, projects_completed, projects_total, level, updated_at)
    values (NEW.student_id, new_score, completed_count, total_count, new_level, now())
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
