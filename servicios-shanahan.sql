-- ============================================================
--  SHANAHAN NAILS · Actualización de servicios y precios
--  Pegar en Supabase → SQL Editor → Run
--  Basado en la lista del 27/08/2026
-- ============================================================

-- PASO 0 · COPIA DE SEGURIDAD (crea una tabla con los datos actuales)
CREATE TABLE IF NOT EXISTS servicios_backup_20260827 AS
SELECT * FROM servicios;

-- ============================================================
--  MANICURA RUSA CON NIVELACIÓN
-- ============================================================
UPDATE servicios SET
  nombre = 'Color liso', precio = '25 €', dur = 75, dur_txt = '1 h 15 min'
WHERE val = 'Mani Rusa Nivelación · Color Liso';

UPDATE servicios SET
  nombre = 'Decoración simple', precio = '29 €', dur = 90, dur_txt = '1 h 30 min'
WHERE val = 'Mani Rusa Nivelación · Decoración Sencilla';

UPDATE servicios SET
  nombre = 'Decoración media', precio = '32 €', dur = 105, dur_txt = '1 h 45 min'
WHERE val = 'Mani Rusa Nivelación · Decoración Elaborada';

INSERT INTO servicios (grupo, is_extras_group, val, nombre, dur, dur_txt, precio, descrip, is_extra_addon, orden_grupo, orden_item)
SELECT 'Manicura Rusa · Nivelación', false, 'Mani Rusa Nivelación · Decoración Elaborada Premium',
       'Decoración elaborada', 120, 'desde 2 h', 'Desde 35 €',
       'Diseños de alta complejidad. Se presupuesta previamente según la dificultad. Es necesario enviar una foto de inspiración antes de la cita.',
       false, 1, 4
WHERE NOT EXISTS (SELECT 1 FROM servicios WHERE val = 'Mani Rusa Nivelación · Decoración Elaborada Premium');

-- ============================================================
--  EXTENSIÓN CON ACRYGEL  (antes figuraba como "Ext. Gel")
-- ============================================================
UPDATE servicios SET grupo = 'Extensión con Acrygel'
WHERE grupo = 'Manicura Rusa · Ext. Gel';

UPDATE servicios SET
  nombre = 'Color liso', precio = '40 €', dur = 135, dur_txt = '2 h 15 min'
WHERE val = 'Mani Rusa Ext. Gel · Color Liso';

UPDATE servicios SET
  nombre = 'Decoración simple', precio = '44 €', dur = 150, dur_txt = '2 h 30 min'
WHERE val = 'Mani Rusa Ext. Gel · Decoración Sencilla';

UPDATE servicios SET
  nombre = 'Decoración media', precio = '47 €', dur = 165, dur_txt = '2 h 45 min'
WHERE val = 'Mani Rusa Ext. Gel · Decoración Elaborada';

INSERT INTO servicios (grupo, is_extras_group, val, nombre, dur, dur_txt, precio, descrip, is_extra_addon, orden_grupo, orden_item)
SELECT 'Extensión con Acrygel', false, 'Acrygel · Decoración Elaborada Premium',
       'Decoración elaborada', 180, 'desde 3 h', 'Desde 50 €',
       'Diseños de alta complejidad. Se presupuesta previamente según la dificultad. Es necesario enviar una foto de inspiración antes de la cita.',
       false, 2, 4
WHERE NOT EXISTS (SELECT 1 FROM servicios WHERE val = 'Acrygel · Decoración Elaborada Premium');

-- ============================================================
--  DECORACIONES  (grupo nuevo)
-- ============================================================
INSERT INTO servicios (grupo, is_extras_group, val, nombre, dur, dur_txt, precio, descrip, is_extra_addon, orden_grupo, orden_item)
SELECT 'Decoraciones', true, 'Flor 3D', 'Flor 3D', 10, '+10 min', '+3 €',
       'Precio por flor.', true, 6, 1
WHERE NOT EXISTS (SELECT 1 FROM servicios WHERE val = 'Flor 3D');

-- ============================================================
--  RETIRADAS
-- ============================================================
UPDATE servicios SET
  nombre = 'Retirada completa + limpieza de cutícula', precio = '12 €', dur = 45, dur_txt = '45 min'
WHERE val = 'Retirada + Limpieza de Cutícula';

UPDATE servicios SET
  nombre = 'Retirada de producto de otro centro', precio = '+7 €', dur = 30, dur_txt = '+30 min'
WHERE val = 'Suplemento retirada (de otro centro)';

-- ============================================================
--  EXTRAS (solo añadir a combos)
-- ============================================================
UPDATE servicios SET
  nombre = 'Decoración simple', precio = '+4 €', dur = 15, dur_txt = '+15 min'
WHERE val = 'Decoración Sencilla' AND is_extras_group = true;

UPDATE servicios SET
  nombre = 'Decoración media', precio = '+7 €', dur = 30, dur_txt = '+30 min'
WHERE val = 'Decoración Elaborada' AND is_extras_group = true;

INSERT INTO servicios (grupo, is_extras_group, val, nombre, dur, dur_txt, precio, descrip, is_extra_addon, orden_grupo, orden_item)
SELECT 'Extras (solo añadir a combos)', true, 'Decoración Elaborada Premium',
       'Decoración elaborada', 45, 'desde +45 min', 'Desde +10 €',
       'Se presupuesta previamente según la complejidad. Es necesario enviar una foto de inspiración antes de la cita.',
       true, 7, 3
WHERE NOT EXISTS (SELECT 1 FROM servicios WHERE val = 'Decoración Elaborada Premium');

-- ============================================================
--  TODOS LOS PRECIOS CON €  (quita un € final si lo hay y lo vuelve a poner
--  con espacio: deja "25", "25€" y "+7€" como "25 €" y "+7 €")
-- ============================================================
UPDATE servicios
SET precio = regexp_replace(trim(precio), '[[:space:]]*€[[:space:]]*$', '') || ' €'
WHERE precio IS NOT NULL AND trim(precio) <> '';

-- ============================================================
--  COMPROBACIÓN
-- ============================================================
SELECT orden_grupo, orden_item, grupo, nombre, precio, dur, dur_txt
FROM servicios ORDER BY orden_grupo, orden_item;

-- ============================================================
--  DESHACER (solo si algo sale mal)
-- ============================================================
-- DELETE FROM servicios;
-- INSERT INTO servicios SELECT * FROM servicios_backup_20260827;
