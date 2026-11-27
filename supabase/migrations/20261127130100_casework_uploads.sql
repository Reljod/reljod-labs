-- Casework: the bucket takes only what the desk accepts, and an upload is
-- recorded once.
--
-- * The `casework` bucket allowed any type up to 15 MB while the code takes
--   PDF, CSV, JPEG and PNG up to 10 MB (UPLOADS in domain/uploads.ts). Storage
--   now refuses anything else at upload time, before the app sees it. The
--   seeded Cabinet (scripts/seed-casework.mts) uploads only PDF, CSV and JPEG.
-- * A finished upload's Storage path is unique among Desk uploads, so a ticket
--   finished twice at the same moment records one Document. The app also
--   refuses a ticket whose path is already recorded.
--
-- Additive: the deployed code sends only these types, and fresh paths.

update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf', 'text/csv', 'image/jpeg', 'image/png']
where id = 'casework';

-- If a ticket was already finished twice, the index cannot be built over the
-- duplicate rows; it is then skipped with a notice (the app-side check still
-- holds) rather than failing the migration or deleting anyone's Documents.
do $$
begin
  create unique index documents_upload_storage_path_key
    on casework.documents (storage_path)
    where session_id is not null;
exception when unique_violation then
  raise notice 'casework.documents has duplicate upload paths; unique index skipped';
end;
$$;
