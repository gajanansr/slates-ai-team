-- Voice notes: let the private attachments bucket hold short, compressed audio clips
-- (Opus in WebM from Android/desktop, AAC in MP4 from iPhone) next to images and PDFs.
-- Skipped where Storage isn't installed, e.g. the test database.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
       set allowed_mime_types = array[
             'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'application/pdf',
             'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/x-m4a'
           ]
     where id = 'attachments';
  end if;
end;
$$;
