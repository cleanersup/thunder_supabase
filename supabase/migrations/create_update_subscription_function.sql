-- Función para actualizar la suscripción del usuario
-- Esta función se ejecuta con privilegios elevados (SECURITY DEFINER)
-- para saltarse las restricciones RLS y permitir que la app actualice los perfiles

CREATE OR REPLACE FUNCTION update_subscription(
    p_user_id UUID,
    p_has_premium BOOLEAN,
    p_plan_tier TEXT DEFAULT NULL,
    p_subscription_status TEXT DEFAULT NULL,
    p_expiry_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSON;
BEGIN
    -- Actualizar o insertar el perfil del usuario
    INSERT INTO profiles (
        id,
        used_subscription,
        plan_tier,
        subscription_status,
        subscription_expiry,
        updated_at
    )
    VALUES (
        p_user_id,
        p_has_premium,
        p_plan_tier,
        p_subscription_status,
        p_expiry_date,
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        used_subscription = EXCLUDED.used_subscription,
        plan_tier = EXCLUDED.plan_tier,
        subscription_status = EXCLUDED.subscription_status,
        subscription_expiry = EXCLUDED.subscription_expiry,
        updated_at = NOW();

    -- Obtener el resultado actualizado
    SELECT json_build_object(
        'id', id,
        'used_subscription', used_subscription,
        'plan_tier', plan_tier,
        'subscription_status', subscription_status,
        'subscription_expiry', subscription_expiry
    )
    INTO v_result
    FROM profiles
    WHERE id = p_user_id;

    RETURN v_result;
END;
$$;

-- Dar permisos de ejecución a usuarios autenticados
GRANT EXECUTE ON FUNCTION update_subscription TO authenticated;

-- Comentario para documentación
COMMENT ON FUNCTION update_subscription IS 'Actualiza el estado de suscripción del usuario. Se ejecuta con privilegios elevados para saltarse RLS.';
