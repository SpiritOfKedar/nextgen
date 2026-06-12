--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10 (Debian 17.10-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: fn_sync_thread_file_state(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_sync_thread_file_state() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
    INSERT INTO public.thread_file_state (
        thread_id, file_path, current_version, current_blob_sha256, is_deleted, updated_at
    ) VALUES (
        NEW.thread_id, NEW.file_path, NEW.version, NEW.blob_sha256, NEW.is_deletion, now()
    )
    ON CONFLICT (thread_id, file_path) DO UPDATE
      SET current_version     = EXCLUDED.current_version,
          current_blob_sha256 = EXCLUDED.current_blob_sha256,
          is_deleted          = EXCLUDED.is_deleted,
          updated_at          = EXCLUDED.updated_at
      WHERE EXCLUDED.current_version > public.thread_file_state.current_version;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: code_blobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.code_blobs (
    sha256 text NOT NULL,
    size_bytes integer NOT NULL,
    storage_path text,
    mime_type text DEFAULT 'text/plain'::text NOT NULL,
    content text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT code_blobs_check CHECK (((storage_path IS NOT NULL) OR (content IS NOT NULL)))
);


--
-- Name: file_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.file_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    message_id uuid NOT NULL,
    file_path text NOT NULL,
    version integer NOT NULL,
    blob_sha256 text NOT NULL,
    is_deletion boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: message_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_chunks (
    id bigint NOT NULL,
    message_id uuid NOT NULL,
    idx integer NOT NULL,
    delta text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: message_chunks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.message_chunks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: message_chunks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.message_chunks_id_seq OWNED BY public.message_chunks.id;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    seq bigint NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    raw_content text,
    model text,
    status text DEFAULT 'complete'::text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    conversation_mode text,
    CONSTRAINT messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text]))),
    CONSTRAINT messages_status_check CHECK ((status = ANY (ARRAY['streaming'::text, 'complete'::text, 'error'::text, 'aborted'::text])))
);


--
-- Name: shell_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shell_commands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    idx integer NOT NULL,
    command text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: terminal_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.terminal_events (
    id bigint NOT NULL,
    thread_id uuid NOT NULL,
    user_id uuid NOT NULL,
    event_type text NOT NULL,
    payload text NOT NULL,
    cwd text,
    exit_code integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: terminal_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.terminal_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: terminal_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.terminal_events_id_seq OWNED BY public.terminal_events.id;


--
-- Name: terminal_recovery_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.terminal_recovery_audits (
    id bigint NOT NULL,
    thread_id uuid NOT NULL,
    user_id uuid NOT NULL,
    trigger_source text NOT NULL,
    issue_code text NOT NULL,
    planned_commands jsonb NOT NULL,
    executed_commands jsonb NOT NULL,
    status text NOT NULL,
    detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: terminal_recovery_audits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.terminal_recovery_audits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: terminal_recovery_audits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.terminal_recovery_audits_id_seq OWNED BY public.terminal_recovery_audits.id;


--
-- Name: thread_collaborators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.thread_collaborators (
    thread_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'editor'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: thread_file_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.thread_file_state (
    thread_id uuid NOT NULL,
    file_path text NOT NULL,
    current_version integer NOT NULL,
    current_blob_sha256 text NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: thread_plan_contexts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.thread_plan_contexts (
    thread_id uuid NOT NULL,
    user_id uuid NOT NULL,
    plan_context text NOT NULL,
    source_message_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_mode text,
    plan_context_updated_at timestamp with time zone
);


--
-- Name: user_figma_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_figma_connections (
    user_id uuid NOT NULL,
    access_token text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clerk_id text NOT NULL,
    email text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: message_chunks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_chunks ALTER COLUMN id SET DEFAULT nextval('public.message_chunks_id_seq'::regclass);


--
-- Name: terminal_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_events ALTER COLUMN id SET DEFAULT nextval('public.terminal_events_id_seq'::regclass);


--
-- Name: terminal_recovery_audits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_recovery_audits ALTER COLUMN id SET DEFAULT nextval('public.terminal_recovery_audits_id_seq'::regclass);


--
-- Name: code_blobs code_blobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.code_blobs
    ADD CONSTRAINT code_blobs_pkey PRIMARY KEY (sha256);


--
-- Name: file_versions file_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_versions
    ADD CONSTRAINT file_versions_pkey PRIMARY KEY (id);


--
-- Name: file_versions file_versions_thread_id_file_path_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_versions
    ADD CONSTRAINT file_versions_thread_id_file_path_version_key UNIQUE (thread_id, file_path, version);


--
-- Name: message_chunks message_chunks_message_id_idx_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_chunks
    ADD CONSTRAINT message_chunks_message_id_idx_key UNIQUE (message_id, idx);


--
-- Name: message_chunks message_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_chunks
    ADD CONSTRAINT message_chunks_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: messages messages_thread_id_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_thread_id_seq_key UNIQUE (thread_id, seq);


--
-- Name: shell_commands shell_commands_message_id_idx_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shell_commands
    ADD CONSTRAINT shell_commands_message_id_idx_key UNIQUE (message_id, idx);


--
-- Name: shell_commands shell_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shell_commands
    ADD CONSTRAINT shell_commands_pkey PRIMARY KEY (id);


--
-- Name: terminal_events terminal_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_events
    ADD CONSTRAINT terminal_events_pkey PRIMARY KEY (id);


--
-- Name: terminal_recovery_audits terminal_recovery_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_recovery_audits
    ADD CONSTRAINT terminal_recovery_audits_pkey PRIMARY KEY (id);


--
-- Name: thread_collaborators thread_collaborators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_collaborators
    ADD CONSTRAINT thread_collaborators_pkey PRIMARY KEY (thread_id, user_id);


--
-- Name: thread_file_state thread_file_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_file_state
    ADD CONSTRAINT thread_file_state_pkey PRIMARY KEY (thread_id, file_path);


--
-- Name: thread_plan_contexts thread_plan_contexts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_plan_contexts
    ADD CONSTRAINT thread_plan_contexts_pkey PRIMARY KEY (thread_id);


--
-- Name: threads threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_pkey PRIMARY KEY (id);


--
-- Name: user_figma_connections user_figma_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_figma_connections
    ADD CONSTRAINT user_figma_connections_pkey PRIMARY KEY (user_id);


--
-- Name: users users_clerk_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_clerk_id_key UNIQUE (clerk_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: file_versions_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX file_versions_message_idx ON public.file_versions USING btree (message_id);


--
-- Name: file_versions_thread_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX file_versions_thread_created_idx ON public.file_versions USING btree (thread_id, created_at DESC);


--
-- Name: file_versions_thread_path_ver_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX file_versions_thread_path_ver_idx ON public.file_versions USING btree (thread_id, file_path, version DESC);


--
-- Name: idx_messages_thread_mode_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_thread_mode_seq ON public.messages USING btree (thread_id, conversation_mode, seq);


--
-- Name: idx_messages_thread_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_thread_seq ON public.messages USING btree (thread_id, seq);


--
-- Name: idx_messages_thread_status_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_thread_status_seq ON public.messages USING btree (thread_id, status, seq DESC);


--
-- Name: idx_terminal_events_thread_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_terminal_events_thread_created ON public.terminal_events USING btree (thread_id, created_at DESC);


--
-- Name: idx_terminal_recovery_thread_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_terminal_recovery_thread_created ON public.terminal_recovery_audits USING btree (thread_id, created_at DESC);


--
-- Name: idx_thread_plan_contexts_user_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_thread_plan_contexts_user_updated ON public.thread_plan_contexts USING btree (user_id, updated_at DESC);


--
-- Name: messages_streaming_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_streaming_idx ON public.messages USING btree (id) WHERE (status = 'streaming'::text);


--
-- Name: messages_thread_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_thread_created_idx ON public.messages USING btree (thread_id, created_at);


--
-- Name: threads_user_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX threads_user_updated_idx ON public.threads USING btree (user_id, updated_at DESC);


--
-- Name: file_versions trg_sync_thread_file_state; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_thread_file_state AFTER INSERT ON public.file_versions FOR EACH ROW EXECUTE FUNCTION public.fn_sync_thread_file_state();


--
-- Name: file_versions file_versions_blob_sha256_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_versions
    ADD CONSTRAINT file_versions_blob_sha256_fkey FOREIGN KEY (blob_sha256) REFERENCES public.code_blobs(sha256);


--
-- Name: file_versions file_versions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_versions
    ADD CONSTRAINT file_versions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: file_versions file_versions_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_versions
    ADD CONSTRAINT file_versions_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE CASCADE;


--
-- Name: message_chunks message_chunks_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_chunks
    ADD CONSTRAINT message_chunks_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: messages messages_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE CASCADE;


--
-- Name: messages messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: shell_commands shell_commands_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shell_commands
    ADD CONSTRAINT shell_commands_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: shell_commands shell_commands_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shell_commands
    ADD CONSTRAINT shell_commands_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE CASCADE;


--
-- Name: terminal_events terminal_events_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_events
    ADD CONSTRAINT terminal_events_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE CASCADE;


--
-- Name: terminal_events terminal_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_events
    ADD CONSTRAINT terminal_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: terminal_recovery_audits terminal_recovery_audits_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_recovery_audits
    ADD CONSTRAINT terminal_recovery_audits_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE CASCADE;


--
-- Name: terminal_recovery_audits terminal_recovery_audits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_recovery_audits
    ADD CONSTRAINT terminal_recovery_audits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: thread_collaborators thread_collaborators_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_collaborators
    ADD CONSTRAINT thread_collaborators_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE CASCADE;


--
-- Name: thread_collaborators thread_collaborators_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_collaborators
    ADD CONSTRAINT thread_collaborators_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: thread_file_state thread_file_state_current_blob_sha256_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_file_state
    ADD CONSTRAINT thread_file_state_current_blob_sha256_fkey FOREIGN KEY (current_blob_sha256) REFERENCES public.code_blobs(sha256);


--
-- Name: thread_file_state thread_file_state_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_file_state
    ADD CONSTRAINT thread_file_state_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE CASCADE;


--
-- Name: thread_plan_contexts thread_plan_contexts_source_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_plan_contexts
    ADD CONSTRAINT thread_plan_contexts_source_message_id_fkey FOREIGN KEY (source_message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: thread_plan_contexts thread_plan_contexts_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_plan_contexts
    ADD CONSTRAINT thread_plan_contexts_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE CASCADE;


--
-- Name: thread_plan_contexts thread_plan_contexts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_plan_contexts
    ADD CONSTRAINT thread_plan_contexts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: threads threads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_figma_connections user_figma_connections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_figma_connections
    ADD CONSTRAINT user_figma_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: code_blobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.code_blobs ENABLE ROW LEVEL SECURITY;

--
-- Name: file_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.file_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: message_chunks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_chunks ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: shell_commands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shell_commands ENABLE ROW LEVEL SECURITY;

--
-- Name: terminal_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.terminal_events ENABLE ROW LEVEL SECURITY;

--
--



--
--



--
-- Name: terminal_recovery_audits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.terminal_recovery_audits ENABLE ROW LEVEL SECURITY;

--
--



--
--



--
-- Name: thread_file_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.thread_file_state ENABLE ROW LEVEL SECURITY;

--
-- Name: threads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.threads ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;



--
-- sandbox_snapshots: inline dependency snapshot payloads (replaces Supabase Storage)
--
CREATE TABLE IF NOT EXISTS public.sandbox_snapshots (
    fingerprint text NOT NULL,
    payload bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.sandbox_snapshots
    ADD CONSTRAINT sandbox_snapshots_pkey PRIMARY KEY (fingerprint);

--
-- PostgreSQL database dump complete
--


