revoke all privileges on table
  public.connected_accounts,
  public.email_batches,
  public.scheduled_emails,
  public.email_attempts
from anon, authenticated;

grant select on table
  public.connected_accounts,
  public.email_batches,
  public.scheduled_emails,
  public.email_attempts
to authenticated;
grant insert, update, delete on table public.email_batches to authenticated;
grant all privileges on table
  public.connected_accounts,
  public.email_batches,
  public.scheduled_emails,
  public.email_attempts
to service_role;

alter table public.connected_accounts enable row level security;
alter table public.email_batches enable row level security;
alter table public.scheduled_emails enable row level security;
alter table public.email_attempts enable row level security;

create policy "Users can read own connected account metadata"
  on public.connected_accounts for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "Users can read own batches"
  on public.email_batches for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Users can create own draft batches"
  on public.email_batches for insert to authenticated
  with check (owner_id = (select auth.uid()) and status = 'draft');
create policy "Users can update own draft batches"
  on public.email_batches for update to authenticated
  using (owner_id = (select auth.uid()) and status = 'draft')
  with check (owner_id = (select auth.uid()) and status = 'draft');
create policy "Users can delete own batches"
  on public.email_batches for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy "Users can read own scheduled emails"
  on public.scheduled_emails for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Users can read own email attempts"
  on public.email_attempts for select to authenticated
  using (owner_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cv-attachments', 'cv-attachments', false, 10485760, array['application/pdf'])
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "CV attachments: owner read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'cv-attachments'
    and cardinality(storage.foldername(name)) = 2
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[3] is null
    and name = (select auth.uid())::text || '/' || (storage.foldername(name))[2] || '/cv.pdf'
    and exists (
      select 1 from public.email_batches b
      where b.id::text = (storage.foldername(storage.objects.name))[2]
        and b.owner_id = (select auth.uid())
    )
  );
create policy "CV attachments: owner upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'cv-attachments'
    and cardinality(storage.foldername(name)) = 2
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name = (select auth.uid())::text || '/' || (storage.foldername(name))[2] || '/cv.pdf'
    and exists (
      select 1 from public.email_batches b
      where b.id::text = (storage.foldername(storage.objects.name))[2]
        and b.owner_id = (select auth.uid())
    )
  );
create policy "CV attachments: owner delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'cv-attachments'
    and cardinality(storage.foldername(name)) = 2
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name = (select auth.uid())::text || '/' || (storage.foldername(name))[2] || '/cv.pdf'
    and exists (
      select 1 from public.email_batches b
      where b.id::text = (storage.foldername(storage.objects.name))[2]
        and b.owner_id = (select auth.uid())
    )
  );
