#!/bin/sh
# Este script crea un archivo config.js con las variables de entorno
# para que el frontend pueda usarlas de forma segura.

echo "window.env = { SUPABASE_URL: '${SUPABASE_URL}', SUPABASE_ANON_KEY: '${SUPABASE_ANON_KEY}' };" > config.js