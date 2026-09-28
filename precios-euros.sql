-- ============================================================
--  SHANAHAN NAILS · Unificar el símbolo € en todos los precios
--  Pegar en Supabase -> SQL Editor -> Run
--  Deja "3", "25€" y "45" como "3 €", "25 €" y "45 €".
--  Los que ya estan bien ("25 €", "+7 €", "Desde 35 €") no cambian.
--  Se puede ejecutar varias veces sin estropear nada.
-- ============================================================

UPDATE servicios
SET precio = regexp_replace(trim(precio), '[[:space:]]*€[[:space:]]*$', '') || ' €'
WHERE precio IS NOT NULL AND trim(precio) <> '';

-- Comprobacion
SELECT orden_grupo, orden_item, grupo, nombre, precio, dur_txt
FROM servicios ORDER BY orden_grupo, orden_item;
