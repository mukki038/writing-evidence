-- MVP-A0 · Writing Evidence — funksiyalar (TZ v4 §9, §10, §11, §12)
--
-- Asosiy qoida: save_document'ni brauzer Supabase API orqali to'g'ridan-to'g'ri
-- chaqira oladi (authenticated EXECUTE). Shuning uchun hujjat hajmi, matni,
-- so'z soni va hash shu yerda content_json dan hisoblanadi; clientdan
-- kelgan hech bir hisob-kitobga ishonilmaydi.

-- ---------------------------------------------------------------------------
-- JSON maydonlarini tekshirish yordamchilari
-- ---------------------------------------------------------------------------
create or replace function private.jint(p jsonb, k text)
returns integer
language plpgsql immutable
set search_path = ''
as $$
declare
  v jsonb := p -> k;
  n numeric;
begin
  if v is null or jsonb_typeof(v) <> 'number' then
    raise exception 'invalid_packet: % must be a number', k using errcode = '22023';
  end if;
  n := (v #>> '{}')::numeric;
  if n <> trunc(n) or n < 0 or n > 2147483647 then
    raise exception 'invalid_packet: % must be a non-negative integer', k using errcode = '22023';
  end if;
  return n::integer;
end
$$;

create or replace function private.juuid(p jsonb, k text)
returns uuid
language plpgsql immutable
set search_path = ''
as $$
declare
  v jsonb := p -> k;
begin
  if v is null or jsonb_typeof(v) <> 'string'
     or (v #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_packet: % must be a uuid', k using errcode = '22023';
  end if;
  return (v #>> '{}')::uuid;
end
$$;

create or replace function private.jts(p jsonb, k text)
returns timestamptz
language plpgsql stable
set search_path = ''
as $$
declare
  v jsonb := p -> k;
begin
  if v is null or jsonb_typeof(v) <> 'string'
     or (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
    raise exception 'invalid_packet: % must be an ISO timestamp', k using errcode = '22023';
  end if;
  begin
    return (v #>> '{}')::timestamptz;
  exception when others then
    raise exception 'invalid_packet: % is not a valid timestamp', k using errcode = '22023';
  end;
end
$$;

-- ---------------------------------------------------------------------------
-- ProseMirror hujjatini o'lchash (TZ §9)
-- Hajm ProseMirror qoidasi bo'yicha: matn = UTF-16 birliklar soni,
-- blok tugun = 2 + ichidagilar. content_text = textblock'lar "\n" bilan.
-- ---------------------------------------------------------------------------
create type private.pm_measure as (size integer, txt text);

-- ProseMirror (JavaScript) matn uzunligini UTF-16 birliklarda sanaydi;
-- Postgres char_length esa kod nuqtalarini sanaydi. BMP'dan tashqaridagi
-- har bir belgi (emoji va h.k.) JavaScript'da 2 birlik.
create or replace function private.utf16_length(t text)
returns integer
language sql immutable strict parallel safe
set search_path = ''
as $$
  select char_length(t) + regexp_count(t, '[\U00010000-\U0010FFFF]')
$$;

create or replace function private.pm_node(node jsonb, depth integer)
returns private.pm_measure
language plpgsql immutable
set search_path = ''
as $$
declare
  t        text;
  children jsonb;
  child    jsonb;
  m        jsonb;
  r        private.pm_measure;
  total    integer := 0;
  parts    text[] := '{}';
  i        integer := 0;
  lvl      jsonb;
begin
  if depth > 24 then
    raise exception 'invalid_content: nesting too deep' using errcode = '22023';
  end if;
  if node is null or jsonb_typeof(node) <> 'object' then
    raise exception 'invalid_content: node must be an object' using errcode = '22023';
  end if;

  t := node ->> 'type';
  children := node -> 'content';
  if children is not null and jsonb_typeof(children) <> 'array' then
    raise exception 'invalid_content: content must be an array' using errcode = '22023';
  end if;

  if t in ('paragraph', 'heading') then
    if t = 'heading' then
      lvl := node -> 'attrs' -> 'level';
      if lvl is null or jsonb_typeof(lvl) <> 'number' or (lvl #>> '{}') not in ('1', '2', '3') then
        raise exception 'invalid_content: heading level must be 1-3' using errcode = '22023';
      end if;
    end if;

    for child in select value from jsonb_array_elements(coalesce(children, '[]'::jsonb)) loop
      if child ->> 'type' is distinct from 'text'
         or jsonb_typeof(child -> 'text') is distinct from 'string'
         or child ->> 'text' = '' then
        raise exception 'invalid_content: textblocks may only contain non-empty text' using errcode = '22023';
      end if;
      if child ? 'marks' then
        if jsonb_typeof(child -> 'marks') <> 'array' then
          raise exception 'invalid_content: marks must be an array' using errcode = '22023';
        end if;
        for m in select value from jsonb_array_elements(child -> 'marks') loop
          if m ->> 'type' is null or m ->> 'type' not in ('bold', 'italic', 'origin') then
            raise exception 'invalid_content: mark % not allowed', m ->> 'type' using errcode = '22023';
          end if;
          if m ->> 'type' = 'origin' and coalesce(m -> 'attrs' ->> 'source', '') not in
             ('paste', 'drop', 'replacement', 'bulk_input', 'unknown', 'ai', 'recovered') then
            raise exception 'invalid_content: bad origin source' using errcode = '22023';
          end if;
        end loop;
      end if;
      total := total + private.utf16_length(child ->> 'text');
      parts := parts || (child ->> 'text');
    end loop;
    return row(total + 2, array_to_string(parts, ''))::private.pm_measure;

  elsif t in ('blockquote', 'bulletList', 'orderedList', 'listItem') then
    if children is null or jsonb_array_length(children) = 0 then
      raise exception 'invalid_content: % must not be empty', t using errcode = '22023';
    end if;
    for child in select value from jsonb_array_elements(children) loop
      i := i + 1;
      if t in ('bulletList', 'orderedList') then
        if child ->> 'type' is distinct from 'listItem' then
          raise exception 'invalid_content: lists may only contain listItem' using errcode = '22023';
        end if;
      else
        if child ->> 'type' is null or child ->> 'type' not in
           ('paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList') then
          raise exception 'invalid_content: % may only contain blocks', t using errcode = '22023';
        end if;
        if t = 'listItem' and i = 1 and child ->> 'type' <> 'paragraph' then
          raise exception 'invalid_content: listItem must start with a paragraph' using errcode = '22023';
        end if;
      end if;
      r := private.pm_node(child, depth + 1);
      total := total + r.size;
      parts := parts || r.txt;
    end loop;
    return row(total + 2, array_to_string(parts, E'\n'))::private.pm_measure;

  else
    raise exception 'invalid_content: node type % not allowed', coalesce(t, 'null') using errcode = '22023';
  end if;
end
$$;

-- doc.content.size va content_text (NFC normalizatsiyasi keyin qo'llanadi)
create or replace function private.pm_doc(doc jsonb)
returns private.pm_measure
language plpgsql immutable
set search_path = ''
as $$
declare
  children jsonb;
  child    jsonb;
  r        private.pm_measure;
  total    integer := 0;
  parts    text[] := '{}';
begin
  if doc is null or jsonb_typeof(doc) <> 'object' or doc ->> 'type' is distinct from 'doc' then
    raise exception 'invalid_content: root must be doc' using errcode = '22023';
  end if;
  children := doc -> 'content';
  if children is null or jsonb_typeof(children) <> 'array' or jsonb_array_length(children) = 0 then
    raise exception 'invalid_content: doc must contain blocks' using errcode = '22023';
  end if;
  for child in select value from jsonb_array_elements(children) loop
    if child ->> 'type' is null or child ->> 'type' not in
       ('paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList') then
      raise exception 'invalid_content: doc may only contain blocks' using errcode = '22023';
    end if;
    r := private.pm_node(child, 1);
    total := total + r.size;
    parts := parts || r.txt;
  end loop;
  return row(total, array_to_string(parts, E'\n'))::private.pm_measure;
end
$$;

-- TZ §9: bo'shliq bilan ajratilgan tokenlar soni
create or replace function private.word_count(t text)
returns integer
language sql immutable strict parallel safe
set search_path = ''
as $$
  select count(*)::integer from regexp_split_to_table(t, '\s+') w where w <> ''
$$;

-- ---------------------------------------------------------------------------
-- Vaqt algoritmi (TZ §11 pseudocode)
-- ---------------------------------------------------------------------------
create or replace function private.effective_ts(
  p_session_id uuid,
  p_seq integer,
  p_client_ts timestamptz,
  p_received timestamptz,
  out o_effective_ts timestamptz,
  out o_clock_adjusted boolean,
  out o_offline boolean
)
language plpgsql stable
set search_path = ''
as $$
declare
  v_prev timestamptz;
  v_lo   timestamptz;
  v_hi   timestamptz;
begin
  -- shu session'dagi oldingi yozuv (mutation yoki event, seq bo'yicha)
  select x.ts into v_prev
  from (
    (select m.effective_ts as ts, m.seq as sq from public.mutations m
      where m.session_id = p_session_id and m.seq < p_seq order by m.seq desc limit 1)
    union all
    (select e.effective_ts as ts, e.seq as sq from public.events e
      where e.session_id = p_session_id and e.seq < p_seq order by e.seq desc limit 1)
  ) x
  order by x.sq desc
  limit 1;

  if v_prev is null then
    select s.started_at into v_prev from public.sessions s where s.id = p_session_id;
  end if;

  v_lo := greatest(v_prev, p_received - interval '7 days');
  v_hi := p_received + interval '2 minutes';

  if p_client_ts >= v_lo and p_client_ts <= v_hi then
    o_effective_ts := p_client_ts;
    o_clock_adjusted := false;
  else
    o_effective_ts := least(greatest(p_client_ts, v_lo), p_received);
    o_clock_adjusted := true;
  end if;
  o_offline := (p_received - p_client_ts) > interval '2 minutes';
end
$$;

-- ---------------------------------------------------------------------------
-- Session yordamchilari (session id client'da yaratiladi)
-- ---------------------------------------------------------------------------
create or replace function private.upsert_sessions(p_document_id uuid, p_sessions jsonb, p_now timestamptz)
returns void
language plpgsql
set search_path = ''
as $$
declare
  s       jsonb;
  v_id    uuid;
  v_start timestamptz;
  v_doc   uuid;
begin
  if p_sessions is null then
    return;
  end if;
  if jsonb_typeof(p_sessions) <> 'array' or jsonb_array_length(p_sessions) > 50 then
    raise exception 'invalid_packet: sessions' using errcode = '22023';
  end if;
  for s in select value from jsonb_array_elements(p_sessions) loop
    v_id := private.juuid(s, 'id');
    v_start := private.jts(s, 'started_at');
    -- client soati noto'g'ri bo'lishi mumkin: [now - 7 kun, now] oralig'iga keltiriladi
    v_start := least(greatest(v_start, p_now - interval '7 days'), p_now);
    insert into public.sessions (id, document_id, started_at, last_activity_at)
    values (v_id, p_document_id, v_start, v_start)
    on conflict (id) do nothing;
    select se.document_id into v_doc from public.sessions se where se.id = v_id;
    if v_doc is distinct from p_document_id then
      raise exception 'invalid_packet: unknown session' using errcode = '22023';
    end if;
  end loop;
end
$$;

-- 30 daqiqa faoliyatsizlik → session yopiladi (lazy close, TZ §10.1)
create or replace function private.close_idle_sessions(p_document_id uuid, p_now timestamptz)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  update public.sessions
     set ended_at = last_activity_at, end_reason = 'idle'
   where document_id = p_document_id
     and ended_at is null
     and last_activity_at < p_now - interval '30 minutes';
  get diagnostics n = row_count;
  return n;
end
$$;

create or replace function private.take_snapshot(p_doc public.documents, p_session_id uuid, p_reason text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.snapshots (
    document_id, session_id, document_version, doc_size, content_json,
    content_text, content_hash, word_count, reason)
  values (
    p_doc.id, p_session_id, p_doc.version, p_doc.doc_size, p_doc.content_json,
    p_doc.content_text, encode(sha256(convert_to(p_doc.content_text, 'UTF8')), 'hex'),
    p_doc.word_count, p_reason)
  on conflict (document_id, document_version) do nothing
  returning id into v_id;
  return v_id;
end
$$;

-- ---------------------------------------------------------------------------
-- create_document — hujjat + boshlang'ich snapshot (version 0)
-- ---------------------------------------------------------------------------
create or replace function public.create_document(p_title text default '')
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_doc public.documents;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  p_title := btrim(coalesce(p_title, ''));
  if char_length(p_title) > 200 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;

  -- TipTap bo'sh hujjati aynan shu JSON'ni beradi (hajm = 2)
  insert into public.documents (user_id, title, content_json, content_text, word_count, doc_size, version)
  values (v_uid, p_title, '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb, '', 0, 2, 0)
  returning * into v_doc;

  perform private.take_snapshot(v_doc, null, 'initial');

  return jsonb_build_object(
    'id', v_doc.id, 'title', v_doc.title, 'version', v_doc.version, 'created_at', v_doc.created_at);
end
$$;

-- ---------------------------------------------------------------------------
-- save_document — autosave tranzaksiyasi (TZ §10.9)
-- Bitta tranzaksiyada: versiya → mutation'lar → consistency → hujjat → snapshot.
-- ---------------------------------------------------------------------------
create or replace function public.save_document(
  p_document_id  uuid,
  p_base_version integer,
  p_content      jsonb,
  p_mutations    jsonb,
  p_sessions     jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid          uuid := auth.uid();
  v_now          timestamptz := now();
  v_doc          public.documents;
  v_measure      private.pm_measure;
  v_text         text;
  v_words        integer;
  v_new_version  integer;
  v_first_id     uuid;
  v_applied      integer;
  m              jsonb;
  v_mid          uuid;
  v_session      uuid;
  v_checked      uuid;
  v_last_session uuid;
  v_seq          integer;
  v_from         integer;
  v_to           integer;
  v_del_size     integer;
  v_ins_size     integer;
  v_del_chars    integer;
  v_ins_chars    integer;
  v_src          text;
  v_client_ts    timestamptz;
  v_eff          record;
  v_row_id       bigint;
  v_delta        bigint := 0;
  v_expected     bigint;
  v_external     boolean := false;
  v_unrecorded   boolean := false;
  v_last_snap_v  integer;
  v_last_snap_at timestamptz;
  v_changed      bigint;
  v_snapshot_id  uuid;
  v_closed       integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_mutations is null or jsonb_typeof(p_mutations) <> 'array'
     or jsonb_array_length(p_mutations) = 0 then
    raise exception 'invalid_packet: mutations required' using errcode = '22023';
  end if;
  if jsonb_array_length(p_mutations) > 5000 then
    raise exception 'packet_too_large' using errcode = '54000';
  end if;

  select * into v_doc from public.documents where id = p_document_id for update;
  if not found or v_doc.user_id <> v_uid then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Qayta yuborilgan paket (javob yo'qolgan) — idempotent javob
  v_first_id := private.juuid(p_mutations -> 0, 'client_mutation_id');
  select mu.document_version into v_applied
    from public.mutations mu
   where mu.client_mutation_id = v_first_id and mu.document_id = v_doc.id;
  if found then
    return jsonb_build_object('status', 'duplicate', 'version', v_applied, 'current_version', v_doc.version);
  end if;

  -- Versiya mos kelmasa — 409 (rad etilgan paket ledger'ga yozilmaydi)
  if p_base_version is distinct from v_doc.version then
    return jsonb_build_object(
      'status', 'conflict', 'version', v_doc.version,
      'content_json', v_doc.content_json, 'title', v_doc.title);
  end if;

  -- Hajm, matn va so'z soni — faqat serverda
  v_measure := private.pm_doc(p_content);
  v_text := normalize(v_measure.txt, NFC);
  v_words := private.word_count(v_text);
  if v_words > 30000 then
    raise exception 'document_too_large' using errcode = '54000';
  end if;
  v_new_version := v_doc.version + 1;

  -- Faoliyatsiz session'lar yopiladi; yopilgan bo'lsa, oxirgi holat snapshot qilinadi
  v_closed := private.close_idle_sessions(v_doc.id, v_now);
  if v_closed > 0 then
    select max(sn.document_version) into v_last_snap_v from public.snapshots sn where sn.document_id = v_doc.id;
    if coalesce(v_last_snap_v, -1) < v_doc.version then
      perform private.take_snapshot(v_doc, null, 'session_end');
    end if;
  end if;

  perform private.upsert_sessions(v_doc.id, p_sessions, v_now);

  for m in select value from jsonb_array_elements(p_mutations) loop
    if jsonb_typeof(m) <> 'object' then
      raise exception 'invalid_packet: mutation must be an object' using errcode = '22023';
    end if;
    v_mid       := private.juuid(m, 'client_mutation_id');
    v_session   := private.juuid(m, 'session_id');
    v_seq       := private.jint(m, 'seq');
    v_from      := private.jint(m, 'from');
    v_to        := private.jint(m, 'to');
    v_del_size  := private.jint(m, 'deleted_size');
    v_ins_size  := private.jint(m, 'inserted_size');
    v_del_chars := private.jint(m, 'deleted_chars');
    v_ins_chars := private.jint(m, 'inserted_chars');
    v_client_ts := private.jts(m, 'client_ts');
    v_src       := m ->> 'source';

    if v_seq < 1 or v_to < v_from then
      raise exception 'invalid_packet: seq/from/to' using errcode = '22023';
    end if;
    if v_src is null or v_src not in ('typing', 'paste', 'drop', 'replacement', 'bulk_input', 'unknown',
                                       'history', 'ai', 'recovered', 'moved', 'delete') then
      raise exception 'invalid_packet: source' using errcode = '22023';
    end if;
    if v_session is distinct from v_checked then
      perform 1 from public.sessions se where se.id = v_session and se.document_id = v_doc.id;
      if not found then
        raise exception 'invalid_packet: unknown session' using errcode = '22023';
      end if;
      v_checked := v_session;
    end if;

    select * into v_eff from private.effective_ts(v_session, v_seq, v_client_ts, v_now);

    v_row_id := null;
    insert into public.mutations (
      client_mutation_id, document_id, session_id, document_version, seq,
      from_pos, to_pos, deleted_size, inserted_size, deleted_chars, inserted_chars,
      source, client_ts, received_at, effective_ts, offline, clock_adjusted)
    values (
      v_mid, v_doc.id, v_session, v_new_version, v_seq,
      v_from, v_to, v_del_size, v_ins_size, v_del_chars, v_ins_chars,
      v_src, v_client_ts, v_now, v_eff.o_effective_ts, v_eff.o_offline, v_eff.o_clock_adjusted)
    on conflict (client_mutation_id) do nothing
    returning id into v_row_id;

    if v_row_id is null then
      -- paketning bir qismi allaqachon yozilgan: bunday paket yaxlit emas
      raise exception 'invalid_packet: duplicate mutation id' using errcode = '22023';
    end if;

    v_delta := v_delta + v_ins_size - v_del_size;
    v_last_session := v_session;

    -- Timeline uchun server event'lari (TZ §10.3)
    if v_src in ('paste', 'drop', 'replacement', 'bulk_input', 'unknown', 'ai', 'recovered') and v_ins_chars > 0 then
      insert into public.events (document_id, session_id, seq, type, payload, derived, mutation_id,
                                 client_ts, received_at, effective_ts, offline, clock_adjusted)
      values (v_doc.id, v_session, null, 'text_inserted',
              jsonb_build_object('mutation_id', v_row_id, 'source', v_src, 'inserted_chars', v_ins_chars),
              true, v_row_id, v_client_ts, v_now, v_eff.o_effective_ts, v_eff.o_offline, v_eff.o_clock_adjusted);
      if v_ins_chars >= 40 or v_src = 'ai' then
        v_external := true;
      end if;
    elsif v_src = 'moved' and v_ins_chars > 0 then
      insert into public.events (document_id, session_id, seq, type, payload, derived, mutation_id,
                                 client_ts, received_at, effective_ts, offline, clock_adjusted)
      values (v_doc.id, v_session, null, 'text_moved',
              jsonb_build_object('mutation_id', v_row_id, 'inserted_chars', v_ins_chars),
              true, v_row_id, v_client_ts, v_now, v_eff.o_effective_ts, v_eff.o_offline, v_eff.o_clock_adjusted);
    end if;

    if v_del_chars >= 50 then
      insert into public.events (document_id, session_id, seq, type, payload, derived, mutation_id,
                                 client_ts, received_at, effective_ts, offline, clock_adjusted)
      values (v_doc.id, v_session, null, 'revision',
              jsonb_build_object('mutation_id', v_row_id, 'deleted_chars', v_del_chars, 'inserted_chars', v_ins_chars),
              true, v_row_id, v_client_ts, v_now, v_eff.o_effective_ts, v_eff.o_offline, v_eff.o_clock_adjusted);
    end if;
  end loop;

  -- Session faolligi: effective_ts bo'yicha (offline yozuv uchun ham to'g'ri)
  update public.sessions se
     set last_activity_at = greatest(se.last_activity_at, x.max_ts),
         ended_at   = case when se.ended_at is not null and x.max_ts > se.ended_at then null else se.ended_at end,
         end_reason = case when se.ended_at is not null and x.max_ts > se.ended_at then null else se.end_reason end
    from (select mu.session_id, max(mu.effective_ts) as max_ts
            from public.mutations mu
           where mu.document_id = v_doc.id and mu.document_version = v_new_version
           group by mu.session_id) x
   where se.id = x.session_id;
  -- offline paytda 30+ daqiqa tanaffus bo'lgan session'lar ham yopiladi
  perform private.close_idle_sessions(v_doc.id, v_now);

  -- Consistency check (TZ §10.8): aniq tenglik, tolerantlik 0
  v_expected := v_doc.doc_size + v_delta;
  if v_expected <> v_measure.size then
    v_unrecorded := true;
    insert into public.events (document_id, session_id, type, payload, derived, received_at, effective_ts)
    values (v_doc.id, v_last_session, 'unrecorded_change',
            jsonb_build_object('from_version', v_doc.version, 'to_version', v_new_version,
                               'delta_size', v_measure.size - v_expected),
            true, v_now, v_now);
  end if;

  update public.documents
     set content_json = p_content,
         content_text = v_text,
         word_count   = v_words,
         doc_size     = v_measure.size,
         version      = v_new_version,
         updated_at   = v_now
   where id = v_doc.id
  returning * into v_doc;

  -- Snapshot qoidalari (TZ §10.2)
  select sn.document_version, sn.created_at into v_last_snap_v, v_last_snap_at
    from public.snapshots sn
   where sn.document_id = v_doc.id
   order by sn.document_version desc
   limit 1;
  select coalesce(sum(mu.inserted_size + mu.deleted_size), 0) into v_changed
    from public.mutations mu
   where mu.document_id = v_doc.id and mu.document_version > coalesce(v_last_snap_v, -1);

  if v_unrecorded then
    v_snapshot_id := private.take_snapshot(v_doc, v_last_session, 'unrecorded');
  elsif v_external then
    v_snapshot_id := private.take_snapshot(v_doc, v_last_session, 'external');
  elsif (v_last_snap_at is null or v_now - v_last_snap_at >= interval '30 seconds') and v_changed >= 20 then
    v_snapshot_id := private.take_snapshot(v_doc, v_last_session, 'interval');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'version', v_doc.version,
    'doc_size', v_doc.doc_size,
    'word_count', v_doc.word_count,
    'snapshot', v_snapshot_id is not null,
    'unrecorded_change', v_unrecorded);
end
$$;

-- ---------------------------------------------------------------------------
-- ingest_events — session va telemetriya event'lari (POST /events)
-- ---------------------------------------------------------------------------
create or replace function public.ingest_events(
  p_document_id uuid,
  p_events      jsonb,
  p_sessions    jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_now       timestamptz := now();
  v_doc       public.documents;
  e           jsonb;
  v_type      text;
  v_eid       uuid;
  v_session   uuid;
  v_seq       integer;
  v_ts        timestamptz;
  v_payload   jsonb;
  v_eff       record;
  v_row_id    bigint;
  v_accepted  integer := 0;
  v_last_snap integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array'
     or jsonb_array_length(p_events) = 0 or jsonb_array_length(p_events) > 200 then
    raise exception 'invalid_packet: events' using errcode = '22023';
  end if;

  select * into v_doc from public.documents where id = p_document_id for update;
  if not found or v_doc.user_id <> v_uid then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  perform private.upsert_sessions(v_doc.id, p_sessions, v_now);

  for e in select value from jsonb_array_elements(p_events) loop
    if jsonb_typeof(e) <> 'object' then
      raise exception 'invalid_packet: event must be an object' using errcode = '22023';
    end if;
    v_type := e ->> 'type';
    if v_type is null or v_type not in ('session_start', 'session_end', 'typing_activity') then
      raise exception 'invalid_packet: event type' using errcode = '22023';
    end if;
    v_eid     := private.juuid(e, 'client_event_id');
    v_session := private.juuid(e, 'session_id');
    v_seq     := private.jint(e, 'seq');
    v_ts      := private.jts(e, 'client_ts');
    v_payload := coalesce(e -> 'payload', '{}'::jsonb);
    if v_seq < 1 or jsonb_typeof(v_payload) <> 'object' then
      raise exception 'invalid_packet: seq/payload' using errcode = '22023';
    end if;
    perform 1 from public.sessions se where se.id = v_session and se.document_id = v_doc.id;
    if not found then
      raise exception 'invalid_packet: unknown session' using errcode = '22023';
    end if;

    if v_type = 'typing_activity' then
      v_payload := jsonb_build_object(
        'typed_chars',   private.jint(v_payload, 'typed_chars'),
        'deleted_chars', private.jint(v_payload, 'deleted_chars'),
        'active_sec',    private.jint(v_payload, 'active_sec'));
      if (v_payload ->> 'active_sec')::integer > 10 then
        raise exception 'invalid_packet: active_sec' using errcode = '22023';
      end if;
    elsif v_type = 'session_end' then
      v_payload := jsonb_build_object('reason',
        case when v_payload ->> 'reason' = 'idle' then 'idle' else 'pagehide' end);
    else
      v_payload := '{}'::jsonb;
    end if;

    select * into v_eff from private.effective_ts(v_session, v_seq, v_ts, v_now);

    v_row_id := null;
    insert into public.events (client_event_id, document_id, session_id, seq, type, payload, derived,
                               client_ts, received_at, effective_ts, offline, clock_adjusted)
    values (v_eid, v_doc.id, v_session, v_seq, v_type, v_payload, false,
            v_ts, v_now, v_eff.o_effective_ts, v_eff.o_offline, v_eff.o_clock_adjusted)
    on conflict (client_event_id) do nothing
    returning id into v_row_id;

    continue when v_row_id is null;  -- dublikat jim tashlanadi
    v_accepted := v_accepted + 1;

    if v_type = 'session_end' then
      update public.sessions
         set ended_at = greatest(started_at, v_eff.o_effective_ts),
             end_reason = 'pagehide'
       where id = v_session and ended_at is null;
      select max(sn.document_version) into v_last_snap from public.snapshots sn where sn.document_id = v_doc.id;
      if coalesce(v_last_snap, -1) < v_doc.version then
        perform private.take_snapshot(v_doc, v_session, 'session_end');
      end if;
    else
      update public.sessions
         set last_activity_at = greatest(last_activity_at, v_eff.o_effective_ts)
       where id = v_session;
    end if;
  end loop;

  return jsonb_build_object('accepted', v_accepted);
end
$$;

-- ---------------------------------------------------------------------------
-- document_timeline — talaba uchun basic timeline (SECURITY INVOKER → RLS amal qiladi)
-- ---------------------------------------------------------------------------
create or replace function public.document_timeline(p_document_id uuid)
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  with d as (
    select id, title, created_at, updated_at, word_count, version
      from public.documents where id = p_document_id
  ),
  s as (
    select se.id, se.started_at, se.last_activity_at,
           coalesce(se.ended_at,
                    case when se.last_activity_at < now() - interval '30 minutes'
                         then se.last_activity_at end) as ended_at,
           coalesce((select sum((e.payload ->> 'active_sec')::integer)
                       from public.events e
                      where e.session_id = se.id and e.type = 'typing_activity'), 0) as active_sec,
           (select count(*) from public.mutations mu where mu.session_id = se.id) as mutation_count
      from public.sessions se
     where se.document_id = p_document_id
  ),
  snaps as (
    select sn.document_version, sn.word_count, sn.created_at, sn.reason
      from public.snapshots sn where sn.document_id = p_document_id
  ),
  ev as (
    select e.type, e.effective_ts, e.payload, e.session_id, e.offline, e.clock_adjusted
      from public.events e
     where e.document_id = p_document_id and e.derived
  ),
  mm as (
    select mu.session_id, mu.seq, mu.effective_ts, mu.received_at, mu.offline,
           sum(case when mu.offline then 0 else 1 end)
             over (partition by mu.session_id order by mu.seq) as grp
      from public.mutations mu
     where mu.document_id = p_document_id
  ),
  off_ranges as (
    select mm.session_id, min(mm.effective_ts) as started_at, max(mm.effective_ts) as ended_at,
           max(mm.received_at) as synced_at, count(*) as mutations
      from mm where mm.offline
     group by mm.session_id, mm.grp
  )
  select case when not exists (select 1 from d) then null else jsonb_build_object(
    'document', (select to_jsonb(d) from d),
    'sessions', coalesce((select jsonb_agg(to_jsonb(s) order by s.started_at) from s), '[]'::jsonb),
    'snapshots', coalesce((select jsonb_agg(to_jsonb(snaps) order by snaps.document_version) from snaps), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(ev) order by ev.effective_ts) from ev), '[]'::jsonb),
    'offline_ranges', coalesce((select jsonb_agg(to_jsonb(off_ranges) order by off_ranges.started_at) from off_ranges), '[]'::jsonb),
    'clock_adjusted', (select count(*) from public.mutations mu where mu.document_id = p_document_id and mu.clock_adjusted),
    'mutation_count', (select count(*) from public.mutations mu where mu.document_id = p_document_id)
  ) end
$$;

-- ---------------------------------------------------------------------------
-- Signup: profile yaratish
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
