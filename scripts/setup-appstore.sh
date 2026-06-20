#!/usr/bin/env bash
# setup-appstore.sh — creates App Store Connect listing + uploads screenshots
# Run ONCE after generating your ASC API key:
#   1. Go to appstoreconnect.apple.com → Users and Access → Keys → App Store Connect API
#   2. Create key with role: Admin
#   3. Download AuthKey_XXXXXXXX.p8
#   4. Then run: ./scripts/setup-appstore.sh KEYID ISSUERID /path/to/AuthKey_KEYID.p8

set -e
KEY_ID="$1"; ISSUER_ID="$2"; KEY_PATH="$3"
[ -z "$KEY_ID" ] && echo "Usage: $0 KEYID ISSUERID /path/to/AuthKey.p8" && exit 1

BUNDLE_ID="no.leieplattform.app"
TEAM_ID="9L8XF547T2"
APP_NAME="Leieplattform"

echo "🔑 Generating JWT..."
HEADER=$(echo -n '{"alg":"ES256","kid":"'"$KEY_ID"'","typ":"JWT"}' | base64 | tr -d '=' | tr '/+' '_-' | tr -d '\n')
PAYLOAD=$(echo -n '{"iss":"'"$ISSUER_ID"'","iat":'"$(date +%s)"',"exp":'"$(($(date +%s)+1200))"',"aud":"appstoreconnect-v1"}' | base64 | tr -d '=' | tr '/+' '_-' | tr -d '\n')
SIGNATURE=$(echo -n "$HEADER.$PAYLOAD" | openssl dgst -sha256 -sign "$KEY_PATH" | base64 | tr -d '=' | tr '/+' '_-' | tr -d '\n')
JWT="$HEADER.$PAYLOAD.$SIGNATURE"

echo "🔍 Checking if app exists in ASC..."
EXISTING=$(curl -sf \
  "https://api.appstoreconnect.apple.com/v1/apps?filter[bundleId]=$BUNDLE_ID" \
  -H "Authorization: Bearer $JWT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data'][0]['id'] if d['data'] else '')" 2>/dev/null || echo "")

if [ -n "$EXISTING" ]; then
  echo "✓ App already exists in ASC: $EXISTING"
  APP_ID="$EXISTING"
else
  echo "📱 Creating app in App Store Connect..."
  APP_ID=$(curl -sf -X POST \
    "https://api.appstoreconnect.apple.com/v1/apps" \
    -H "Authorization: Bearer $JWT" \
    -H "Content-Type: application/json" \
    -d "{
      \"data\": {
        \"type\": \"apps\",
        \"attributes\": {
          \"bundleId\": \"$BUNDLE_ID\",
          \"name\": \"$APP_NAME\",
          \"primaryLocale\": \"nb\",
          \"sku\": \"leieplattform-ios-001\"
        }
      }
    }" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
  echo "✓ App created: $APP_ID"
fi

echo ""
echo "✅ ASC app ID: $APP_ID"
echo ""
echo "Next: Add these 3 secrets to GitHub:"
echo "  gh secret set ASC_KEY_ID --body '$KEY_ID'"
echo "  gh secret set ASC_ISSUER_ID --body '$ISSUER_ID'"
echo "  gh secret set ASC_KEY_CONTENT < '$KEY_PATH'"
echo ""
echo "Then trigger build:"
echo "  gh workflow run ios-deploy.yml"
