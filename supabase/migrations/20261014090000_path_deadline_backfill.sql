-- Goals planned before intake answers were saved per path (learner_snapshot is null) showed the
-- learner's *latest* deadline (often none) while their plan note still said "About N weeks to the
-- deadline". Recover each such path's own deadline from the plan it was built with
-- (created_at + weeksLeft weeks) and save it as the path's snapshot deadline. Other answers keep
-- falling back to the learner profile, as before. Idempotent: only touches rows with no snapshot.
update learning_paths
set learner_snapshot = jsonb_build_object(
  'deadline', to_char((created_at + ((plan->>'weeksLeft')::numeric * interval '7 days'))::date, 'YYYY-MM-DD'))
where learner_snapshot is null
  and plan ? 'weeksLeft'
  and jsonb_typeof(plan->'weeksLeft') = 'number'
  and (plan->>'weeksLeft')::numeric > 0;
