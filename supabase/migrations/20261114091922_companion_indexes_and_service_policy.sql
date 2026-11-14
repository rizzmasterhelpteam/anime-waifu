create index messages_conversation_owner on public.messages(conversation_id,user_id);
create policy service_only_limits on companion_private.request_limits for all to service_role using(true) with check(true);
