#!/usr/bin/env bash
# Prueba mínima de envío de SMS con la API REST de Twilio.
# Uso: TWILIO_TO_NUMBER=+56912345678 ./scripts/twilio-sms-test.sh ["mensaje"]
# Requiere: TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET,
#           TWILIO_FROM_NUMBER y TWILIO_TO_NUMBER (formato E.164).
set -euo pipefail

for v in TWILIO_ACCOUNT_SID TWILIO_API_KEY_SID TWILIO_API_KEY_SECRET TWILIO_FROM_NUMBER TWILIO_TO_NUMBER; do
  : "${!v:?Falta la variable de entorno $v}"
done

BODY="${1:-Prueba de SMS con Twilio desde personal-website}"

curl -sS -X POST \
  "https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json" \
  --data-urlencode "From=${TWILIO_FROM_NUMBER}" \
  --data-urlencode "To=${TWILIO_TO_NUMBER}" \
  --data-urlencode "Body=${BODY}" \
  -u "${TWILIO_API_KEY_SID}:${TWILIO_API_KEY_SECRET}"
echo
