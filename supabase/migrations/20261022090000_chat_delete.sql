-- Ask chats are kept until the learner deletes them. Learners may delete their OWN chat sessions and messages
-- (additive: the select-only policies from 20261016090000_agent.sql stay). Deleting a session cascades to its
-- messages (chat_messages.session_id ... on delete cascade); referential actions are not subject to RLS.
drop policy if exists own_chat_sessions_delete on chat_sessions;
create policy own_chat_sessions_delete on chat_sessions for delete using (student_id = get_my_profile_id());
drop policy if exists own_chat_messages_delete on chat_messages;
create policy own_chat_messages_delete on chat_messages for delete using (student_id = get_my_profile_id());
grant delete on chat_sessions to authenticated;
grant delete on chat_messages to authenticated;
-- The history list is read newest first per learner (chat_sessions_student_idx covers it).
