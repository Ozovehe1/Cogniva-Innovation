-- The chat's persistent board (Ask GeniusMap): the step list that draws it, named groups and a revision counter.
-- Written only by the server (service role) through the agent's board tools; learners read it with their session.
alter table chat_sessions add column if not exists board jsonb;
