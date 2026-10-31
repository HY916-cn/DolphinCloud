-- Product images are JPEG, PNG or WebP of at most 5 MB, so the public bucket cannot serve HTML or SVG from our origin.
-- The limit columns come from Storage's own migration 0013, which may still be running when ours start: wait for it.
do $$
begin
  for i in 1..120 loop
    exit when exists (select 1 from information_schema.columns
                      where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types');
    perform pg_sleep(0.5);
  end loop;
  update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'], file_size_limit = 5242880
  where id = 'product-images';
end
$$;
