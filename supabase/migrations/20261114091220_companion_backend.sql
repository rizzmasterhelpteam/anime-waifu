create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '' check (length(display_name)<=60),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.companion_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 settings jsonb not null default '{}' check(jsonb_typeof(settings)='object' and octet_length(settings::text)<=32768),
 updated_at timestamptz not null default now()
);
create table public.conversations (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 character text not null check(character in ('seraphina','gothic_red')),
 created_at timestamptz not null default now(), unique(id,user_id)
);
create index conversations_user_created on public.conversations(user_id,created_at desc);
create table public.messages (
 id bigint generated always as identity primary key,
 conversation_id uuid not null, user_id uuid not null,
 role text not null check(role in ('user','assistant')),
 content text not null check(length(content) between 1 and 8000), created_at timestamptz not null default now(),
 foreign key(conversation_id,user_id) references public.conversations(id,user_id) on delete cascade
);
create index messages_conversation_created on public.messages(conversation_id,created_at desc,id desc);
create index messages_user_id on public.messages(user_id);
create function public.touch_companion_updated() returns trigger language plpgsql security invoker set search_path='' as $$
begin new.updated_at=now();return new;end $$;
revoke execute on function public.touch_companion_updated() from public,anon,authenticated;
create trigger touch_profiles before update on public.profiles for each row execute function public.touch_companion_updated();
create trigger touch_preferences before update on public.companion_preferences for each row execute function public.touch_companion_updated();
alter table public.profiles enable row level security;
alter table public.companion_preferences enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
create policy own_profile on public.profiles for all to authenticated using((select auth.uid())=id) with check((select auth.uid())=id);
create policy own_preferences on public.companion_preferences for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy own_conversations on public.conversations for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy own_messages on public.messages for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
revoke all on public.profiles,public.companion_preferences,public.conversations,public.messages from anon;
grant select,insert,update,delete on public.profiles,public.companion_preferences,public.conversations,public.messages to authenticated;
grant usage,select on sequence public.messages_id_seq to authenticated;
create schema if not exists companion_private;
revoke all on schema companion_private from public,anon,authenticated;
create table companion_private.request_limits(user_id uuid primary key references auth.users(id) on delete cascade,
 minute_start timestamptz not null, minute_count integer not null, day_start date not null, day_count integer not null);
alter table companion_private.request_limits enable row level security;
grant usage on schema companion_private to service_role;
grant all on companion_private.request_limits to service_role;
create function public.consume_companion_quota(p_user_id uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare ok boolean;
begin
 insert into companion_private.request_limits as q values(p_user_id,date_trunc('minute',now()),1,(now() at time zone 'utc')::date,1)
 on conflict(user_id) do update set
 minute_start=date_trunc('minute',now()),
 minute_count=case when q.minute_start=date_trunc('minute',now()) then q.minute_count+1 else 1 end,
 day_start=(now() at time zone 'utc')::date,
 day_count=case when q.day_start=(now() at time zone 'utc')::date then q.day_count+1 else 1 end
 where (q.minute_start<>date_trunc('minute',now()) or q.minute_count<20)
 and (q.day_start<>(now() at time zone 'utc')::date or q.day_count<100)
 returning true into ok;
 return coalesce(ok,false);
end $$;
revoke all on function public.consume_companion_quota(uuid) from public,anon,authenticated;
grant execute on function public.consume_companion_quota(uuid) to service_role;
