-- Recurring jobs: allow generation when job is linked to a lead (client_id null, lead_id set).

-- generate_recurring_job_instances
CREATE OR REPLACE FUNCTION public.generate_recurring_job_instances (
  p_job_id uuid,
  p_replace_future boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_job public.jobs%ROWTYPE;
  v_frequency text;
  v_start_date date;
  v_cursor date;
  v_end_date date;
  v_duration_int integer;
  v_weekdays int[] := ARRAY[]::int[];
  v_weekday_item text;
  v_should_insert boolean;
  v_created integer := 0;
  v_deleted integer := 0;
  v_target integer := 12;
  v_upper_guard integer := 0;
BEGIN
  SELECT *
  INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;

  IF v_uid IS NOT NULL AND v_job.user_id <> v_uid THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  IF v_job.parent_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'Job % is not a recurring series parent', p_job_id;
  END IF;

  IF v_job.job_type <> 'recurring' THEN
    RAISE EXCEPTION 'Job % is not recurring', p_job_id;
  END IF;

  IF v_job.client_id IS NULL AND v_job.lead_id IS NULL THEN
    RAISE EXCEPTION 'Recurring jobs require client_id or lead_id to generate instances';
  END IF;

  IF v_job.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot generate recurring instances for % jobs', v_job.status;
  END IF;

  v_frequency := public.normalize_job_recurring_frequency(v_job.recurring_frequency);
  IF v_frequency = '' THEN
    RAISE EXCEPTION 'Unsupported recurring_frequency: %', coalesce(v_job.recurring_frequency, 'null');
  END IF;

  v_start_date := v_job.scheduled_date;

  IF p_replace_future THEN
    DELETE FROM public.jobs child
    WHERE child.parent_job_id = p_job_id
      AND child.status = 'scheduled'
      AND child.scheduled_date > v_start_date;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  BEGIN
    v_duration_int := NULLIF(trim(coalesce(v_job.recurring_duration, '')), '')::integer;
  EXCEPTION
    WHEN others THEN
      v_duration_int := NULL;
  END;

  IF v_duration_int IS NOT NULL AND v_duration_int > 0 THEN
    CASE lower(coalesce(v_job.recurring_duration_unit, 'months'))
      WHEN 'day', 'days' THEN
        v_end_date := v_start_date + make_interval(days => v_duration_int);
      WHEN 'week', 'weeks' THEN
        v_end_date := v_start_date + make_interval(days => v_duration_int * 7);
      WHEN 'month', 'months' THEN
        v_end_date := v_start_date + make_interval(months => v_duration_int);
      WHEN 'year', 'years' THEN
        v_end_date := v_start_date + make_interval(years => v_duration_int);
      ELSE
        v_end_date := NULL;
    END CASE;
    v_target := 3660;
  END IF;

  IF jsonb_typeof(v_job.selected_week_days) = 'array' THEN
    FOR v_weekday_item IN
      SELECT jsonb_array_elements_text(v_job.selected_week_days)
    LOOP
      BEGIN
        v_weekdays := array_append(v_weekdays, trim(v_weekday_item)::int);
      EXCEPTION
        WHEN others THEN
          CASE lower(trim(v_weekday_item))
            WHEN 'sun', 'sunday' THEN v_weekdays := array_append(v_weekdays, 0);
            WHEN 'mon', 'monday' THEN v_weekdays := array_append(v_weekdays, 1);
            WHEN 'tue', 'tues', 'tuesday' THEN v_weekdays := array_append(v_weekdays, 2);
            WHEN 'wed', 'wednesday' THEN v_weekdays := array_append(v_weekdays, 3);
            WHEN 'thu', 'thur', 'thurs', 'thursday' THEN v_weekdays := array_append(v_weekdays, 4);
            WHEN 'fri', 'friday' THEN v_weekdays := array_append(v_weekdays, 5);
            WHEN 'sat', 'saturday' THEN v_weekdays := array_append(v_weekdays, 6);
            ELSE NULL;
          END CASE;
      END;
    END LOOP;
  END IF;

  SELECT array_agg(DISTINCT d ORDER BY d)
  INTO v_weekdays
  FROM unnest(v_weekdays) d
  WHERE d BETWEEN 0 AND 6;

  v_cursor := v_start_date + 1;

  WHILE v_created < v_target LOOP
    v_upper_guard := v_upper_guard + 1;
    IF v_upper_guard > 3660 THEN
      EXIT;
    END IF;

    IF v_end_date IS NOT NULL AND v_cursor > v_end_date THEN
      EXIT;
    END IF;

    v_should_insert := false;

    IF v_frequency = 'daily' THEN
      v_should_insert := true;
    ELSIF v_frequency = 'weekly' THEN
      IF coalesce(array_length(v_weekdays, 1), 0) > 0 THEN
        v_should_insert := extract(dow from v_cursor)::int = ANY (v_weekdays);
      ELSE
        v_should_insert := ((v_cursor - v_start_date) % 7 = 0);
      END IF;
    ELSIF v_frequency = 'every_two_weeks' THEN
      IF coalesce(array_length(v_weekdays, 1), 0) > 0 THEN
        v_should_insert := extract(dow from v_cursor)::int = ANY (v_weekdays)
          AND (((v_cursor - v_start_date) / 7) % 2 = 0);
      ELSE
        v_should_insert := ((v_cursor - v_start_date) % 14 = 0);
      END IF;
    ELSIF v_frequency = 'monthly' THEN
      v_should_insert := extract(day from v_cursor) = extract(day from v_start_date);
    END IF;

    IF v_should_insert THEN
      INSERT INTO public.jobs (
        user_id,
        client_id,
        lead_id,
        contact_type,
        client_name,
        client_email,
        client_phone,
        property_street,
        property_apt,
        property_city,
        property_state,
        property_zip,
        assigned_employees,
        service_type,
        job_type,
        recurring_frequency,
        recurring_duration,
        recurring_duration_unit,
        selected_week_days,
        scheduled_date,
        start_time,
        end_time,
        line_items,
        service_details,
        internal_notes,
        subtotal,
        discount_type,
        discount_value,
        tax_type,
        tax_value,
        deposit_required,
        deposit_type,
        deposit_value,
        amount_paid,
        payment_status,
        status,
        route_id,
        parent_job_id,
        estimate_id,
        walkthrough_id,
        deposit_invoice_id,
        invoice_ids
      )
      VALUES (
        v_job.user_id,
        v_job.client_id,
        v_job.lead_id,
        v_job.contact_type,
        v_job.client_name,
        v_job.client_email,
        v_job.client_phone,
        v_job.property_street,
        v_job.property_apt,
        v_job.property_city,
        v_job.property_state,
        v_job.property_zip,
        COALESCE(v_job.assigned_employees, '[]'::jsonb),
        v_job.service_type,
        'one_time',
        NULL,
        NULL,
        NULL,
        '[]'::jsonb,
        v_cursor,
        v_job.start_time,
        v_job.end_time,
        v_job.line_items,
        v_job.service_details,
        v_job.internal_notes,
        v_job.subtotal,
        v_job.discount_type,
        v_job.discount_value,
        v_job.tax_type,
        v_job.tax_value,
        false,
        v_job.deposit_type,
        0,
        0,
        'no_deposit_required',
        'scheduled',
        v_job.route_id,
        p_job_id,
        NULL,
        NULL,
        NULL,
        '{}'::uuid[]
      )
      ON CONFLICT (parent_job_id, scheduled_date)
      DO UPDATE SET
        client_id = EXCLUDED.client_id,
        lead_id = EXCLUDED.lead_id,
        contact_type = EXCLUDED.contact_type,
        client_name = EXCLUDED.client_name,
        client_email = EXCLUDED.client_email,
        client_phone = EXCLUDED.client_phone,
        property_street = EXCLUDED.property_street,
        property_apt = EXCLUDED.property_apt,
        property_city = EXCLUDED.property_city,
        property_state = EXCLUDED.property_state,
        property_zip = EXCLUDED.property_zip,
        assigned_employees = EXCLUDED.assigned_employees,
        service_type = EXCLUDED.service_type,
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        line_items = EXCLUDED.line_items,
        service_details = EXCLUDED.service_details,
        internal_notes = EXCLUDED.internal_notes,
        subtotal = EXCLUDED.subtotal,
        discount_type = EXCLUDED.discount_type,
        discount_value = EXCLUDED.discount_value,
        tax_type = EXCLUDED.tax_type,
        tax_value = EXCLUDED.tax_value,
        route_id = EXCLUDED.route_id,
        status = 'scheduled';

      v_created := v_created + 1;
    END IF;

    v_cursor := v_cursor + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'job_id', p_job_id,
    'frequency', v_frequency,
    'created_or_updated', v_created,
    'deleted_future_before_regenerate', v_deleted,
    'start_date', v_start_date,
    'end_date', v_end_date
  );
END;
$$;

COMMENT ON FUNCTION public.generate_recurring_job_instances (uuid, boolean) IS
  'Creates future jobs rows (status scheduled) for a recurring parent. Parent first occurrence stays on the parent row.';

GRANT EXECUTE ON FUNCTION public.generate_recurring_job_instances (uuid, boolean) TO authenticated;

-- generate_job_recurring_appointments
CREATE OR REPLACE FUNCTION public.generate_job_recurring_appointments (
  p_job_id uuid,
  p_occurrences integer DEFAULT 12,
  p_replace_future boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_job public.jobs%ROWTYPE;
  v_route_id uuid;
  v_frequency text;
  v_start_date date;
  v_cursor date;
  v_end_date date;
  v_duration_int integer;
  v_weekdays int[] := ARRAY[]::int[];
  v_weekday_item text;
  v_should_insert boolean;
  v_created integer := 0;
  v_deleted integer := 0;
  v_target integer := GREATEST(COALESCE(p_occurrences, 12), 1);
  v_upper_guard integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
  INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
    AND user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found or not allowed';
  END IF;

  IF v_job.job_type <> 'recurring' THEN
    RAISE EXCEPTION 'Job % is not recurring', p_job_id;
  END IF;

  IF v_job.client_id IS NULL AND v_job.lead_id IS NULL THEN
    RAISE EXCEPTION 'Recurring jobs require client_id or lead_id to generate appointments';
  END IF;

  IF v_job.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot generate recurring appointments for % jobs', v_job.status;
  END IF;

  v_frequency := public.normalize_job_recurring_frequency(v_job.recurring_frequency);
  IF v_frequency = '' THEN
    RAISE EXCEPTION 'Unsupported recurring_frequency: %', coalesce(v_job.recurring_frequency, 'null');
  END IF;

  v_route_id := public.resolve_job_route_id(v_job.user_id, v_job.route_id);
  v_start_date := v_job.scheduled_date;

  IF p_replace_future THEN
    DELETE FROM public.route_appointments ra
    WHERE ra.source_job_id = p_job_id
      AND ra.scheduled_date >= v_start_date;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  BEGIN
    v_duration_int := NULLIF(trim(coalesce(v_job.recurring_duration, '')), '')::integer;
  EXCEPTION
    WHEN others THEN
      v_duration_int := NULL;
  END;

  IF v_duration_int IS NOT NULL AND v_duration_int > 0 THEN
    CASE lower(coalesce(v_job.recurring_duration_unit, 'months'))
      WHEN 'day', 'days' THEN
        v_end_date := v_start_date + make_interval(days => v_duration_int);
      WHEN 'week', 'weeks' THEN
        v_end_date := v_start_date + make_interval(days => v_duration_int * 7);
      WHEN 'month', 'months' THEN
        v_end_date := v_start_date + make_interval(months => v_duration_int);
      WHEN 'year', 'years' THEN
        v_end_date := v_start_date + make_interval(years => v_duration_int);
      ELSE
        v_end_date := NULL;
    END CASE;
  END IF;

  IF jsonb_typeof(v_job.selected_week_days) = 'array' THEN
    FOR v_weekday_item IN
      SELECT jsonb_array_elements_text(v_job.selected_week_days)
    LOOP
      BEGIN
        v_weekdays := array_append(v_weekdays, trim(v_weekday_item)::int);
      EXCEPTION
        WHEN others THEN
          CASE lower(trim(v_weekday_item))
            WHEN 'sun', 'sunday' THEN v_weekdays := array_append(v_weekdays, 0);
            WHEN 'mon', 'monday' THEN v_weekdays := array_append(v_weekdays, 1);
            WHEN 'tue', 'tues', 'tuesday' THEN v_weekdays := array_append(v_weekdays, 2);
            WHEN 'wed', 'wednesday' THEN v_weekdays := array_append(v_weekdays, 3);
            WHEN 'thu', 'thur', 'thurs', 'thursday' THEN v_weekdays := array_append(v_weekdays, 4);
            WHEN 'fri', 'friday' THEN v_weekdays := array_append(v_weekdays, 5);
            WHEN 'sat', 'saturday' THEN v_weekdays := array_append(v_weekdays, 6);
            ELSE NULL;
          END CASE;
      END;
    END LOOP;
  END IF;
  SELECT array_agg(DISTINCT d ORDER BY d) INTO v_weekdays
  FROM unnest(v_weekdays) d
  WHERE d BETWEEN 0 AND 6;

  v_cursor := v_start_date + 1;

  WHILE v_created < v_target LOOP
    v_upper_guard := v_upper_guard + 1;
    IF v_upper_guard > 3660 THEN
      EXIT;
    END IF;

    IF v_end_date IS NOT NULL AND v_cursor > v_end_date THEN
      EXIT;
    END IF;

    v_should_insert := false;

    IF v_frequency = 'daily' THEN
      v_should_insert := true;
    ELSIF v_frequency = 'weekly' THEN
      IF coalesce(array_length(v_weekdays, 1), 0) > 0 THEN
        v_should_insert := extract(dow from v_cursor)::int = ANY (v_weekdays);
      ELSE
        v_should_insert := ((v_cursor - v_start_date) % 7 = 0);
      END IF;
    ELSIF v_frequency = 'every_two_weeks' THEN
      IF coalesce(array_length(v_weekdays, 1), 0) > 0 THEN
        v_should_insert := extract(dow from v_cursor)::int = ANY (v_weekdays)
          AND (((v_cursor - v_start_date) / 7) % 2 = 0);
      ELSE
        v_should_insert := ((v_cursor - v_start_date) % 14 = 0);
      END IF;
    ELSIF v_frequency = 'monthly' THEN
      v_should_insert := extract(day from v_cursor) = extract(day from v_start_date);
    END IF;

    IF v_should_insert THEN
      INSERT INTO public.route_appointments (
        user_id,
        route_id,
        client_id,
        job_id,
        source_job_id,
        scheduled_date,
        scheduled_time,
        end_time,
        notes,
        status,
        service_type,
        assigned_employees,
        deposit_required,
        deposit_amount,
        recurring_frequency,
        recurring_duration,
        recurring_duration_unit,
        selected_week_days
      )
      VALUES (
        v_job.user_id,
        v_route_id,
        v_job.client_id,
        NULL,
        p_job_id,
        v_cursor,
        v_job.start_time,
        v_job.end_time,
        v_job.internal_notes,
        'scheduled',
        v_job.service_type,
        COALESCE(v_job.assigned_employees, '[]'::jsonb),
        CASE WHEN COALESCE(v_job.deposit_required, false) THEN 'yes' ELSE 'no' END,
        v_job.deposit_amount,
        v_job.recurring_frequency,
        v_job.recurring_duration,
        v_job.recurring_duration_unit,
        COALESCE(v_job.selected_week_days, '[]'::jsonb)
      )
      ON CONFLICT (source_job_id, scheduled_date, scheduled_time) DO UPDATE
      SET
        route_id = EXCLUDED.route_id,
        client_id = EXCLUDED.client_id,
        end_time = EXCLUDED.end_time,
        notes = EXCLUDED.notes,
        status = EXCLUDED.status,
        service_type = EXCLUDED.service_type,
        assigned_employees = EXCLUDED.assigned_employees,
        deposit_required = EXCLUDED.deposit_required,
        deposit_amount = EXCLUDED.deposit_amount,
        recurring_frequency = EXCLUDED.recurring_frequency,
        recurring_duration = EXCLUDED.recurring_duration,
        recurring_duration_unit = EXCLUDED.recurring_duration_unit,
        selected_week_days = EXCLUDED.selected_week_days;

      v_created := v_created + 1;
    END IF;

    v_cursor := v_cursor + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'job_id', p_job_id,
    'frequency', v_frequency,
    'created_or_updated', v_created,
    'deleted_future_before_regenerate', v_deleted,
    'start_date', v_start_date,
    'end_date', v_end_date,
    'occurrences_requested', v_target
  );
END;
$$;
